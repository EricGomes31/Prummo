import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, idParam, prisma, quantidadeTexto, texto, type Transacao } from '../lib.js'

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
// Crédito sem venda de origem (depósito a maior, crédito avulso) é só da própria pessoa.
type Ref = { id: number; nome: string }
function elegiveis(credito: { pessoa: Ref; devolucao: { pedido: { cliente: Ref; medico: Ref | null; vendedor: Ref | null; paciente: Ref | null } } | null }) {
  const venda = credito.devolucao?.pedido
  const todas = venda ? [venda.cliente, venda.medico, venda.vendedor, venda.paciente] : [credito.pessoa]
  return todas.filter((p): p is Ref => !!p).filter((p, i, lista) => lista.findIndex((x) => x.id === p.id) === i)
}

const comVenda = {
  pessoa,
  devolucao: { select: { id: true, pedido: { select: { id: true, numero: true, cliente: pessoa, medico: pessoa, vendedor: pessoa, paciente: pessoa } } } },
} as const
// O crédito como a tela mostra: com a venda de origem e onde já foi usado.
const completo = {
  ...comVenda,
  usos: { include: { pessoa, usuario: pessoa, contaReceber: { select: { id: true, descricao: true } } }, orderBy: { id: 'desc' } },
} as const
const paraTela = async (db: Transacao | typeof prisma, id: number) => {
  const credito = await db.credito.findUniqueOrThrow({ where: { id }, include: completo })
  return { ...credito, elegiveis: elegiveis(credito) }
}

// Devoluções que valem: as estornadas não devolveram nada.
const validas = { where: { devolucao: { estornada: false } }, select: { quantidade: true } } as const

// Usa parte do crédito para baixar uma conta a receber de uma das pessoas elegíveis.
export async function aplicarCredito(
  tx: Transacao,
  dados: { creditoId: number; contaReceberId: number; pessoaId: number; valor: number; usuarioId: number },
) {
  const credito = await tx.credito.findUnique({ where: { id: dados.creditoId }, include: comVenda })
  if (!credito) throw new AppError(404, 'Crédito não encontrado.')
  if (credito.status !== 'DISPONIVEL' || dados.valor > credito.saldo) throw new AppError(400, `O valor é maior que o saldo do crédito nº ${credito.id}.`)
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
    where: { id: credito.id, saldo: credito.saldo, status: 'DISPONIVEL' },
    data: { saldo: credito.saldo - dados.valor, status: credito.saldo === dados.valor ? 'ESGOTADO' : 'DISPONIVEL' },
  })
  if (baixou.count === 0 || consumiu.count === 0) throw new AppError(409, 'Os saldos mudaram enquanto o crédito era aplicado. Tente de novo.')
  await tx.creditoUso.create({
    data: { creditoId: credito.id, contaReceberId: conta.id, pessoaId: dados.pessoaId, valor: dados.valor, usuarioId: dados.usuarioId },
  })
}

export async function rotasDevolucoes(app: FastifyInstance) {
  app.get('/devolucoes', async () =>
    prisma.devolucao.findMany({
      include: {
        pedido: { select: { id: true, numero: true, cliente: pessoa } },
        usuario: pessoa,
        credito: { select: { id: true, saldo: true, valorOriginal: true, status: true } },
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
      include: { itens: { include: { produto: { select: { sku: true, nome: true, unidade: true } }, devolucoes: validas } } },
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
        include: { itens: { include: { produto: true, devolucoes: validas } } },
      })
      if (!pedido) throw new AppError(404, 'Pedido não encontrado.')
      if (pedido.status !== 'FATURADO' || pedido.natureza !== 'VENDA') throw new AppError(409, 'Só vendas faturadas aceitam devolução.')

      const itens = dados.itens.map((d) => {
        const item = pedido.itens.find((i) => i.id === d.pedidoItemId)
        if (!item) throw new AppError(400, 'Um dos itens não pertence a esta venda.')
        const disponivel = item.quantidade - item.devolucoes.reduce((s, x) => s + x.quantidade, 0)
        if (d.quantidade > disponivel) {
          throw new AppError(400, `"${item.produto.nome}": só ${disponivel} ${item.unidade ?? item.produto.unidade} ainda ${disponivel === 1 ? 'pode ser devolvido' : 'podem ser devolvidos'}.`)
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
        await tx.credito.create({
          data: { pessoaId: pedido.clienteId, origem: 'DEVOLUCAO', devolucaoId: criada.id, valorOriginal: valorCredito, saldo: valorCredito, usuarioId: req.usuario.id },
        })
      }
      return tx.devolucao.findUniqueOrThrow({ where: { id: criada.id }, include: { itens: true, credito: true } })
    })
    return reply.status(201).send(devolucao)
  })

  // Estornar a devolução: os itens voltam a sair do estoque e o crédito gerado é cancelado. Só enquanto
  // o crédito não tiver sido usado; se foi, os usos são estornados antes.
  app.post('/devolucoes/:id/estornar', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.$transaction(async (tx) => {
      const devolucao = await tx.devolucao.findUnique({
        where: { id },
        include: { credito: true, itens: { include: { pedidoItem: { include: { produto: true } } } } },
      })
      if (!devolucao) throw new AppError(404, 'Devolução não encontrada.')
      if (devolucao.estornada) throw new AppError(409, 'Esta devolução já foi estornada.')
      const credito = devolucao.credito
      if (credito && (credito.status === 'CANCELADO' || credito.saldo !== credito.valorOriginal)) {
        throw new AppError(409, `O crédito nº ${credito.id}, gerado por esta devolução, já foi usado. Estorne os usos antes de estornar a devolução.`)
      }

      // O estoque precisa ter o que volta a sair; a mercadoria devolvida pode já ter sido vendida de novo.
      const porProduto = new Map<number, { produto: (typeof devolucao.itens)[number]['pedidoItem']['produto']; partes: number }>()
      for (const i of devolucao.itens.filter((x) => x.pedidoItem.produto.controlaEstoque)) {
        const { produto } = i.pedidoItem
        const atual = porProduto.get(produto.id) ?? { produto, partes: 0 }
        atual.partes += Math.round((i.quantidade * produto.divisor) / i.pedidoItem.fator)
        porProduto.set(produto.id, atual)
      }
      for (const { produto, partes } of porProduto.values()) {
        if (produto.saldo < partes) {
          const naBase = (n: number) => `${quantidadeTexto(n / produto.divisor)} ${produto.unidade}`
          throw new AppError(409, `Estoque insuficiente de "${produto.nome}" para estornar a devolução: saldo ${naBase(produto.saldo)}, necessário ${naBase(partes)}.`)
        }
        const atualizado = await tx.produto.update({ where: { id: produto.id }, data: { saldo: { decrement: partes } } })
        await tx.movimentoEstoque.create({
          data: { produtoId: produto.id, tipo: 'SAIDA', quantidade: partes, saldoApos: atualizado.saldo, origem: 'ESTORNO_DEVOLUCAO', origemId: id },
        })
      }
      if (credito) {
        const { count } = await tx.credito.updateMany({
          where: { id: credito.id, saldo: credito.valorOriginal, status: credito.status },
          data: { status: 'CANCELADO', saldo: 0 },
        })
        if (count === 0) throw new AppError(409, 'O crédito mudou enquanto a devolução era estornada. Tente de novo.')
      }
      await tx.devolucao.update({ where: { id }, data: { estornada: true, estornadaEm: new Date() } })
      return tx.devolucao.findUniqueOrThrow({ where: { id }, include: { itens: true, credito: true } })
    })
  })

  // Créditos, com filtro por situação e pela pessoa que pode usá-los.
  app.get('/creditos', async (req) => {
    const q = z
      .object({
        status: z.enum(['DISPONIVEL', 'ESGOTADO', 'CANCELADO']).optional(),
        pessoaId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query)
    const creditos = await prisma.credito.findMany({
      where: q.status ? { status: q.status } : {},
      include: completo,
      orderBy: { id: 'desc' },
      take: 500,
    })
    return creditos.map((c) => ({ ...c, elegiveis: elegiveis(c) })).filter((c) => !q.pessoaId || c.elegiveis.some((p) => p.id === q.pessoaId))
  })

  // Crédito avulso, lançado à mão para uma pessoa (acordo comercial, bonificação em dinheiro...).
  app.post('/creditos', async (req, reply) => {
    const dados = z
      .object({
        pessoaId: z.number().int().positive('Selecione a pessoa'),
        valor: z.number().int().positive('Informe um valor maior que zero'),
        descricao: z.string().trim().min(2, 'Informe o motivo do crédito').max(200),
      })
      .parse(req.body)
    const dono = await prisma.pessoa.findUnique({ where: { id: dados.pessoaId } })
    if (!dono) throw new AppError(400, 'Pessoa não encontrada.')
    const credito = await prisma.credito.create({
      data: { pessoaId: dados.pessoaId, origem: 'AVULSO', descricao: dados.descricao, valorOriginal: dados.valor, saldo: dados.valor, usuarioId: req.usuario.id },
    })
    return reply.status(201).send(await paraTela(prisma, credito.id))
  })

  // Cancela um crédito avulso que ainda não foi usado. Os demais se desfazem pela origem (devolução ou conciliação).
  app.post('/creditos/:id/cancelar', async (req) => {
    const { id } = idParam.parse(req.params)
    const credito = await prisma.credito.findUnique({ where: { id } })
    if (!credito) throw new AppError(404, 'Crédito não encontrado.')
    if (credito.origem !== 'AVULSO') throw new AppError(409, 'Só o crédito avulso é cancelado por aqui. O de devolução se desfaz estornando a devolução; o de depósito, desfazendo a conciliação.')
    const { count } = await prisma.credito.updateMany({
      where: { id, status: 'DISPONIVEL', saldo: credito.valorOriginal },
      data: { status: 'CANCELADO', saldo: 0 },
    })
    if (count === 0) throw new AppError(409, 'O crédito já foi usado ou cancelado. Estorne os usos antes de cancelar.')
    return paraTela(prisma, id)
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
      await aplicarCredito(tx, { ...dados, creditoId: id, usuarioId: req.usuario.id })
      return paraTela(tx, id)
    })
  })

  // Estorna um uso do crédito: o valor volta ao saldo do crédito e a conta a receber volta a ter saldo.
  app.post('/creditos/usos/:id/estornar', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.$transaction(async (tx) => {
      const uso = await tx.creditoUso.findUnique({ where: { id }, include: { credito: true, contaReceber: true } })
      if (!uso) throw new AppError(404, 'Uso de crédito não encontrado.')
      if (uso.credito.status === 'CANCELADO') throw new AppError(409, 'O crédito foi cancelado.')
      const { count } = await tx.creditoUso.updateMany({ where: { id, estornado: false }, data: { estornado: true, estornadoEm: new Date() } })
      if (count === 0) throw new AppError(409, 'Este uso já foi estornado.')
      await tx.credito.update({ where: { id: uso.creditoId }, data: { saldo: { increment: uso.valor }, status: 'DISPONIVEL' } })
      const conta = uso.contaReceber
      await tx.contaReceber.update({
        where: { id: conta.id },
        data: { valorPago: { decrement: uso.valor }, status: conta.status === 'CANCELADA' ? 'CANCELADA' : 'ABERTA', pagoEm: null },
      })
      return paraTela(tx, uso.creditoId)
    })
  })
}
