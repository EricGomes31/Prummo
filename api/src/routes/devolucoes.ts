import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, idParam, prisma, texto } from '../lib.js'

const pessoa = { select: { id: true, nome: true } } as const

// Valor líquido de uma unidade do item na venda: o preço menos o desconto do item, com o desconto no
// total e o da campanha rateados entre os itens. O frete não entra, porque não é devolvido.
function liquidoPorUnidade(
  pedido: { subtotal: number; descontoItens: number; desconto: number; descontoPromocao: number },
  item: { precoUnitario: number; desconto: number },
) {
  const base = pedido.subtotal - pedido.descontoItens
  const fator = base > 0 ? (base - pedido.desconto - pedido.descontoPromocao) / base : 0
  return (item.precoUnitario - item.desconto) * fator
}

const corpo = z
  .object({
    pedidoId: z.number().int().positive('Selecione a venda'),
    itens: z
      .array(z.object({ pedidoItemId: z.number().int().positive(), quantidade: z.number().int().positive('Quantidade deve ser maior que zero') }))
      .min(1, 'Informe a quantidade de pelo menos um item'),
    observacao: texto.opcional,
  })
  .refine((d) => new Set(d.itens.map((i) => i.pedidoItemId)).size === d.itens.length, { message: 'O mesmo item aparece mais de uma vez.' })

// Pessoas que podem usar o crédito: o cliente, o médico, o vendedor e o paciente da venda que o originou.
type Ref = { id: number; nome: string }
function elegiveis(credito: { pessoa: Ref; devolucao: { pedido: { cliente: Ref; medico: Ref | null; vendedor: Ref | null; paciente: Ref | null } } | null }) {
  const venda = credito.devolucao?.pedido
  const todas = venda ? [venda.cliente, venda.medico, venda.vendedor, venda.paciente] : [credito.pessoa]
  return todas.filter((p): p is Ref => !!p).filter((p, i, lista) => lista.findIndex((x) => x.id === p.id) === i)
}

const comVenda = {
  pessoa,
  devolucao: { select: { id: true, pedido: { select: { id: true, cliente: pessoa, medico: pessoa, vendedor: pessoa, paciente: pessoa } } } },
} as const

export async function rotasDevolucoes(app: FastifyInstance) {
  app.get('/devolucoes', async () =>
    prisma.devolucao.findMany({
      include: {
        pedido: { select: { id: true, cliente: pessoa } },
        usuario: pessoa,
        credito: { select: { id: true, saldo: true, status: true } },
        itens: { include: { pedidoItem: { select: { unidade: true, produto: { select: { sku: true, nome: true, unidade: true } } } } } },
      },
      orderBy: { id: 'desc' },
      take: 300,
    }),
  )

  // Itens de uma venda com o que ainda pode ser devolvido e o valor líquido de cada unidade.
  app.get('/devolucoes/pedido/:id/saldos', async (req) => {
    const { id } = idParam.parse(req.params)
    const pedido = await prisma.pedido.findUnique({
      where: { id },
      include: { itens: { include: { produto: { select: { sku: true, nome: true, unidade: true } }, devolucoes: { select: { quantidade: true } } } } },
    })
    if (!pedido) throw new AppError(404, 'Pedido não encontrado.')
    return pedido.itens.map((i) => {
      const devolvido = i.devolucoes.reduce((s, d) => s + d.quantidade, 0)
      return {
        pedidoItemId: i.id,
        produto: i.produto,
        unidade: i.unidade ?? i.produto.unidade,
        quantidade: i.quantidade,
        devolvido,
        disponivel: i.quantidade - devolvido,
        valorUnitario: Math.round(liquidoPorUnidade(pedido, i)),
      }
    })
  })

  // Registrar a devolução devolve o estoque dos itens e gera o crédito do cliente.
  app.post('/devolucoes', async (req, reply) => {
    const dados = corpo.parse(req.body)
    const devolucao = await prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id: dados.pedidoId },
        include: { itens: { include: { produto: true, devolucoes: { select: { quantidade: true } } } } },
      })
      if (!pedido) throw new AppError(404, 'Pedido não encontrado.')
      if (pedido.status !== 'FATURADO' || pedido.natureza !== 'VENDA') throw new AppError(409, 'Só vendas faturadas aceitam devolução.')

      const itens = dados.itens.map((d) => {
        const item = pedido.itens.find((i) => i.id === d.pedidoItemId)
        if (!item) throw new AppError(400, 'Um dos itens não pertence a esta venda.')
        const disponivel = item.quantidade - item.devolucoes.reduce((s, x) => s + x.quantidade, 0)
        if (d.quantidade > disponivel) {
          throw new AppError(400, `"${item.produto.nome}": só ${disponivel} ${item.unidade ?? item.produto.unidade} ainda pode(m) ser devolvido(s).`)
        }
        const liquido = liquidoPorUnidade(pedido, item)
        return { item, quantidade: d.quantidade, valorUnitario: Math.round(liquido), credito: Math.round(d.quantidade * liquido) }
      })
      const valorCredito = itens.reduce((s, i) => s + i.credito, 0)

      const criada = await tx.devolucao.create({
        data: {
          pedidoId: pedido.id,
          observacao: dados.observacao,
          valorCredito,
          usuarioId: req.usuario.id,
          itens: { create: itens.map((i) => ({ pedidoItemId: i.item.id, quantidade: i.quantidade, valorUnitario: i.valorUnitario })) },
        },
      })
      for (const { item, quantidade } of itens.filter((i) => i.item.produto.controlaEstoque)) {
        const partes = Math.round((quantidade * item.produto.divisor) / item.fator)
        const produto = await tx.produto.update({ where: { id: item.produtoId }, data: { saldo: { increment: partes } } })
        await tx.movimentoEstoque.create({
          data: { produtoId: item.produtoId, tipo: 'ENTRADA', quantidade: partes, saldoApos: produto.saldo, origem: 'DEVOLUCAO', origemId: criada.id },
        })
      }
      if (valorCredito > 0) {
        await tx.credito.create({ data: { pessoaId: pedido.clienteId, devolucaoId: criada.id, valorOriginal: valorCredito, saldo: valorCredito } })
      }
      return tx.devolucao.findUniqueOrThrow({ where: { id: criada.id }, include: { itens: true, credito: true } })
    })
    return reply.status(201).send(devolucao)
  })

  app.get('/creditos', async (req) => {
    const q = z.object({ status: z.enum(['DISPONIVEL', 'ESGOTADO']).optional() }).parse(req.query)
    const creditos = await prisma.credito.findMany({
      where: q.status ? { status: q.status } : {},
      include: {
        ...comVenda,
        usos: { include: { pessoa, usuario: pessoa, contaReceber: { select: { id: true, descricao: true } } }, orderBy: { id: 'desc' } },
      },
      orderBy: { id: 'desc' },
      take: 500,
    })
    return creditos.map((c) => ({ ...c, elegiveis: elegiveis(c) }))
  })

  // Usa o crédito para baixar, no todo ou em parte, uma conta a receber de uma das pessoas elegíveis.
  app.post('/creditos/:id/utilizar', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = z
      .object({
        contaReceberId: z.number().int().positive('Selecione a conta a receber'),
        pessoaId: z.number().int().positive('Escolha uma das pessoas elegíveis'),
        valor: z.number().int().positive('Informe um valor maior que zero'),
      })
      .parse(req.body)
    return prisma.$transaction(async (tx) => {
      const credito = await tx.credito.findUnique({ where: { id }, include: comVenda })
      if (!credito) throw new AppError(404, 'Crédito não encontrado.')
      if (credito.status !== 'DISPONIVEL' || dados.valor > credito.saldo) throw new AppError(400, 'O valor é maior que o saldo do crédito.')
      if (!elegiveis(credito).some((p) => p.id === dados.pessoaId)) throw new AppError(400, 'Esta pessoa não pode usar este crédito.')

      const conta = await tx.contaReceber.findUnique({ where: { id: dados.contaReceberId } })
      if (!conta) throw new AppError(404, 'Conta a receber não encontrada.')
      if (conta.status !== 'ABERTA') throw new AppError(409, 'A conta a receber não está em aberto.')
      if (conta.pessoaId !== dados.pessoaId) throw new AppError(400, 'A conta a receber precisa ser da pessoa escolhida.')
      const saldoConta = conta.valor - conta.valorPago
      if (dados.valor > saldoConta) throw new AppError(400, 'O valor é maior que o saldo da conta a receber.')

      const quitada = dados.valor === saldoConta
      // As condições nos saldos evitam que dois usos simultâneos passem do limite.
      const baixou = await tx.contaReceber.updateMany({
        where: { id: conta.id, status: 'ABERTA', valorPago: conta.valorPago },
        data: { valorPago: conta.valorPago + dados.valor, status: quitada ? 'PAGA' : 'ABERTA', pagoEm: quitada ? new Date() : null },
      })
      const consumiu = await tx.credito.updateMany({
        where: { id, saldo: credito.saldo },
        data: { saldo: credito.saldo - dados.valor, status: credito.saldo === dados.valor ? 'ESGOTADO' : 'DISPONIVEL' },
      })
      if (baixou.count === 0 || consumiu.count === 0) throw new AppError(409, 'Os saldos mudaram enquanto o crédito era aplicado. Tente de novo.')
      await tx.creditoUso.create({
        data: { creditoId: id, contaReceberId: conta.id, pessoaId: dados.pessoaId, valor: dados.valor, usuarioId: req.usuario.id },
      })
      const atualizado = await tx.credito.findUniqueOrThrow({ where: { id }, include: comVenda })
      return { ...atualizado, elegiveis: elegiveis(atualizado) }
    })
  })
}
