import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, centavos, dataIso, idParam, prisma, quantidadeTexto, somarMeses, texto } from '../lib.js'
import { calcularDescontoPromocao } from '../promocao.js'
import { resolverUnidade } from './produtos.js'
import { carregarVigente } from './promocoes.js'

export const NATUREZAS = ['VENDA', 'BONIFICACAO', 'PERDA'] as const
export const MOTIVOS_PERDA = ['AVARIA', 'VENCIMENTO', 'QUEBRA', 'EXTRAVIO', 'OUTROS'] as const

const pessoaOpcional = z.number().int().positive().nullish()

const corpo = z
  .object({
    clienteId: z.number().int().positive('Selecione o cliente'),
    vendedorId: pessoaOpcional,
    medicoId: pessoaOpcional,
    pacienteId: pessoaOpcional,
    natureza: z.enum(NATUREZAS).default('VENDA'),
    motivoPerda: z.enum(MOTIVOS_PERDA).nullish(),
    promocaoId: z.number().int().positive().nullish(),
    desconto: centavos.default(0),
    frete: centavos.default(0),
    observacao: texto.opcional,
    itens: z
      .array(
        z.object({
          produtoId: z.number().int().positive(),
          // Unidade do lançamento; quantidade e preço são nela. Vazia = unidade base do produto.
          unidade: z.string().trim().max(6).nullish(),
          quantidade: z.number().int().positive('Quantidade deve ser maior que zero'),
          precoUnitario: centavos,
          // Desconto por unidade do lançamento.
          desconto: centavos.default(0),
        }),
      )
      .min(1, 'Inclua ao menos um item'),
  })
  .refine((d) => new Set(d.itens.map((i) => `${i.produtoId}:${i.unidade ?? ''}`)).size === d.itens.length, {
    message: 'O mesmo produto aparece em mais de um item na mesma unidade.',
  })
  .superRefine((d, ctx) => {
    const erro = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (d.natureza === 'PERDA' && !d.motivoPerda) erro('Selecione o motivo da perda.')
    if (d.natureza === 'PERDA' && d.motivoPerda === 'OUTROS' && !d.observacao) erro('Descreva o motivo da perda na observação.')
    if (d.natureza !== 'VENDA' && d.promocaoId) erro('Só vendas aceitam campanha.')
    if (d.itens.some((i) => i.desconto > i.precoUnitario)) erro('O desconto de um item não pode ser maior que o preço dele.')
  })

// Vendedor, médico e paciente são opcionais e precisam ter a classificação correspondente no cadastro.
async function pessoasDoPedido(dados: z.infer<typeof corpo>) {
  const papeis = [
    ['vendedorId', 'vendedor', 'vendedor'],
    ['medicoId', 'medico', 'médico'],
    ['pacienteId', 'paciente', 'paciente'],
  ] as const
  for (const [campo, classificacao, rotulo] of papeis) {
    const id = dados[campo]
    if (!id) continue
    const pessoa = await prisma.pessoa.findUnique({ where: { id } })
    if (!pessoa?.[classificacao]) throw new AppError(400, `Selecione um ${rotulo} do cadastro de pessoas.`)
  }
  return { vendedorId: dados.vendedorId ?? null, medicoId: dados.medicoId ?? null, pacienteId: dados.pacienteId ?? null }
}

// Itens e valores do pedido. A campanha é conferida aqui, a cada gravação: precisa estar vigente e o
// pedido precisa cumprir as condições; o desconto dela é sempre calculado pelo servidor.
async function valores(dados: z.infer<typeof corpo>) {
  const venda = dados.natureza === 'VENDA'
  const perda = dados.natureza === 'PERDA'
  const produtos = await prisma.produto.findMany({
    where: { id: { in: dados.itens.map((i) => i.produtoId) } },
    include: { unidades: true },
  })
  const itens = dados.itens.map((item) => {
    const produto = produtos.find((p) => p.id === item.produtoId)
    if (!produto) throw new AppError(400, `Produto ${item.produtoId} não encontrado.`)
    const unidade = resolverUnidade(produto, item.unidade)
    // A perda só baixa o estoque: não tem preço, desconto nem frete.
    return { ...item, ...(perda ? { precoUnitario: 0, desconto: 0 } : {}), unidade: unidade.sigla, fator: unidade.fator }
  })

  const subtotal = itens.reduce((soma, i) => soma + i.quantidade * i.precoUnitario, 0)
  const descontoItens = itens.reduce((soma, i) => soma + i.quantidade * i.desconto, 0)
  const desconto = perda ? 0 : dados.desconto
  const frete = venda ? dados.frete : 0
  if (desconto > subtotal - descontoItens) throw new AppError(400, 'O desconto não pode ser maior que o subtotal.')
  let descontoPromocao = 0
  if (dados.promocaoId) {
    if (desconto > 0 || descontoItens > 0) throw new AppError(400, 'Pedido com campanha não aceita desconto manual.')
    descontoPromocao = Math.min(subtotal, calcularDescontoPromocao(await carregarVigente(dados.promocaoId), itens))
  }
  return {
    natureza: dados.natureza,
    motivoPerda: perda ? dados.motivoPerda : null,
    subtotal,
    descontoItens,
    desconto,
    frete,
    promocaoId: dados.promocaoId ?? null,
    descontoPromocao,
    total: subtotal - descontoItens - desconto - descontoPromocao + frete,
    itens: { create: itens },
  }
}

// Quantidade do item em partes do estoque. O fator de um lançamento sempre divide o divisor do produto,
// porque o divisor só cresce; o arredondamento é só uma proteção.
const emPartes = (item: { quantidade: number; fator: number; produto: { divisor: number } }) =>
  Math.round((item.quantidade * item.produto.divisor) / item.fator)

export const FORMAS_PAGAMENTO =['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA'] as const

const comDetalhes = {
  cliente: { select: { id: true, nome: true } },
  usuario: { select: { id: true, nome: true } },
  vendedor: { select: { id: true, nome: true } },
  medico: { select: { id: true, nome: true } },
  paciente: { select: { id: true, nome: true } },
  promocao: { select: { id: true, nome: true } },
  itens: { include: { produto: { select: { id: true, sku: true, nome: true, unidade: true } } } },
} as const

export async function rotasPedidos(app: FastifyInstance) {
  app.get('/pedidos', async (req) => {
    const q = z.object({ status: z.enum(['ABERTO', 'FATURADO', 'CANCELADO']).optional() }).parse(req.query)
    return prisma.pedido.findMany({
      where: q.status ? { status: q.status } : {},
      include: comDetalhes,
      orderBy: { id: 'desc' },
      take: 300,
    })
  })

  app.get('/pedidos/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const pedido = await prisma.pedido.findUnique({
      where: { id },
      include: { ...comDetalhes, contasReceber: { orderBy: { vencimento: 'asc' } } },
    })
    if (!pedido) throw new AppError(404, 'Pedido não encontrado.')
    return pedido
  })

  app.post('/pedidos', async (req, reply) => {
    const dados = corpo.parse(req.body)
    const pedido = await prisma.pedido.create({
      data: {
        clienteId: dados.clienteId,
        usuarioId: req.usuario.id,
        observacao: dados.observacao,
        ...(await pessoasDoPedido(dados)),
        ...(await valores(dados)),
      },
      include: comDetalhes,
    })
    return reply.status(201).send(pedido)
  })

  app.put('/pedidos/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = corpo.parse(req.body)
    return prisma.$transaction(async (tx) => {
      const atual = await tx.pedido.findUnique({ where: { id } })
      if (!atual) throw new AppError(404, 'Pedido não encontrado.')
      if (atual.status !== 'ABERTO') throw new AppError(409, 'Só pedidos em aberto podem ser alterados.')
      await tx.pedidoItem.deleteMany({ where: { pedidoId: id } })
      return tx.pedido.update({
        where: { id },
        data: {
          clienteId: dados.clienteId,
          observacao: dados.observacao,
          ...(await pessoasDoPedido(dados)),
          ...(await valores(dados)),
        },
        include: comDetalhes,
      })
    })
  })

  // Faturar baixa o estoque e, na venda, gera as parcelas a receber. Bonificação e perda só baixam o estoque.
  app.post('/pedidos/:id/faturar', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = z
      .object({
        parcelas: z.number().int().min(1).max(24).default(1),
        primeiroVencimento: dataIso.optional(),
        formaPagamento: z.enum(FORMAS_PAGAMENTO, 'Selecione a forma de pagamento').optional(),
      })
      .parse(req.body ?? {})

    return prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.findUnique({ where: { id }, include: { itens: { include: { produto: true } } } })
      if (!pedido) throw new AppError(404, 'Pedido não encontrado.')
      if (pedido.status !== 'ABERTO') throw new AppError(409, 'Este pedido não está em aberto.')
      const venda = pedido.natureza === 'VENDA'
      if (venda && !dados.formaPagamento) throw new AppError(400, 'Selecione a forma de pagamento')
      if (venda && !dados.primeiroVencimento) throw new AppError(400, 'Informe o primeiro vencimento.')

      // O mesmo produto pode vir em mais de uma unidade; o saldo é conferido pela soma, em partes.
      const necessario = new Map<number, number>()
      for (const item of pedido.itens.filter((i) => i.produto.controlaEstoque)) {
        necessario.set(item.produtoId, (necessario.get(item.produtoId) ?? 0) + emPartes(item))
      }
      for (const [produtoId, partes] of necessario) {
        const { produto } = pedido.itens.find((i) => i.produtoId === produtoId)!
        if (produto.saldo < partes) {
          const naBase = (n: number) => `${quantidadeTexto(n / produto.divisor)} ${produto.unidade}`
          throw new AppError(409, `Estoque insuficiente de "${produto.nome}": saldo ${naBase(produto.saldo)}, pedido ${naBase(partes)}.`)
        }
      }
      for (const item of pedido.itens) {
        // O custo guardado é o da unidade do lançamento, como o preço.
        await tx.pedidoItem.update({
          where: { id: item.id },
          data: { custoUnitario: Math.round(item.produto.precoCusto / item.fator) },
        })
        if (!item.produto.controlaEstoque) continue
        const produto = await tx.produto.update({
          where: { id: item.produtoId },
          data: { saldo: { decrement: emPartes(item) } },
        })
        await tx.movimentoEstoque.create({
          data: {
            produtoId: item.produtoId,
            tipo: 'SAIDA',
            quantidade: emPartes(item),
            saldoApos: produto.saldo,
            origem: 'PEDIDO',
            origemId: id,
          },
        })
      }

      if (venda && pedido.total > 0) {
        const base = Math.floor(pedido.total / dados.parcelas)
        const resto = pedido.total - base * dados.parcelas
        for (let n = 0; n < dados.parcelas; n++) {
          await tx.contaReceber.create({
            data: {
              pessoaId: pedido.clienteId,
              pedidoId: id,
              descricao: `Pedido nº ${id} — parcela ${n + 1}/${dados.parcelas}`,
              valor: base + (n === 0 ? resto : 0),
              vencimento: somarMeses(dados.primeiroVencimento!, n),
            },
          })
        }
      }
      return tx.pedido.update({
        where: { id },
        data: { status: 'FATURADO', faturadoEm: new Date(), formaPagamento: venda ? dados.formaPagamento : null },
        include: comDetalhes,
      })
    })
  })

  // Cancelar um pedido faturado devolve o estoque e cancela as parcelas ainda abertas.
  app.post('/pedidos/:id/cancelar', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id },
        include: {
          itens: { include: { produto: { select: { divisor: true } } } },
          contasReceber: true,
          entregas: true,
          _count: { select: { devolucoes: true } },
        },
      })
      if (!pedido) throw new AppError(404, 'Pedido não encontrado.')
      if (pedido.status === 'CANCELADO') throw new AppError(409, 'Pedido já cancelado.')
      // A devolução já devolveu estoque e gerou crédito; cancelar por cima contaria tudo duas vezes.
      if (pedido._count.devolucoes > 0) throw new AppError(409, 'O pedido tem devolução registrada e não pode ser cancelado.')

      if (pedido.status === 'FATURADO') {
        if (pedido.entregas.some((e) => e.status === 'ENTREGUE')) {
          throw new AppError(409, 'O pedido já foi entregue e não pode ser cancelado.')
        }
        if (pedido.entregas.some((e) => e.status === 'EM_ROTA')) {
          throw new AppError(409, 'Há uma entrega em rota. Registre a conclusão ou a falha antes de cancelar.')
        }
        await tx.entrega.updateMany({
          where: { pedidoId: id, status: { in: ['PENDENTE', 'FALHOU'] } },
          data: { status: 'CANCELADA' },
        })
        if (pedido.contasReceber.some((c) => c.status === 'PAGA' || c.valorPago > 0)) {
          throw new AppError(409, 'Há parcelas já recebidas. Estorne os recebimentos antes de cancelar.')
        }
        // Só volta ao estoque o que saiu dele no faturamento, mesmo que o cadastro do produto tenha mudado depois.
        const saidas = await tx.movimentoEstoque.findMany({
          where: { origem: 'PEDIDO', origemId: id, tipo: 'SAIDA' },
          select: { produtoId: true },
        })
        const baixados = new Set(saidas.map((m) => m.produtoId))
        for (const item of pedido.itens.filter((i) => baixados.has(i.produtoId))) {
          const produto = await tx.produto.update({
            where: { id: item.produtoId },
            data: { saldo: { increment: emPartes(item) } },
          })
          await tx.movimentoEstoque.create({
            data: {
              produtoId: item.produtoId,
              tipo: 'ENTRADA',
              quantidade: emPartes(item),
              saldoApos: produto.saldo,
              origem: 'CANCELAMENTO',
              origemId: id,
            },
          })
        }
        await tx.contaReceber.updateMany({ where: { pedidoId: id, status: 'ABERTA' }, data: { status: 'CANCELADA' } })
      }
      return tx.pedido.update({ where: { id }, data: { status: 'CANCELADO' }, include: comDetalhes })
    })
  })
}
