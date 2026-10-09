import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, centavos, dataIso, dia, idParam, intervalo, prisma, quantidadeTexto, somarMeses, texto, type Transacao } from '../lib.js'
import { calcularDescontoPromocao } from '../promocao.js'
import { aplicarCredito } from './devolucoes.js'
import { resolverUnidade } from './produtos.js'
import { carregarVigente } from './promocoes.js'

// Quantos pedidos a lista traz de uma vez; a tela avisa quando a lista chega a esse número.
export const LIMITE_LISTA = 300

export const NATUREZAS = ['VENDA', 'BONIFICACAO', 'PERDA'] as const
export const MOTIVOS_PERDA = ['AVARIA', 'VENCIMENTO', 'QUEBRA', 'EXTRAVIO', 'OUTROS'] as const
// CARTAO_CREDITO e CARTAO_DEBITO são na maquininha; LINK_CARTAO é o link de pagamento enviado ao cliente.
export const FORMAS_PAGAMENTO = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'LINK_CARTAO', 'BOLETO', 'TRANSFERENCIA'] as const

const pessoaOpcional = z.number().int().positive().nullish()

// Condição de pagamento da venda: pode vir já no pedido e é confirmada, ou completada, ao faturar.
const condicao = {
  formaPagamento: z.enum(FORMAS_PAGAMENTO, 'Selecione a forma de pagamento').nullish(),
  parcelas: z.number().int().min(1, 'De 1 a 24 parcelas').max(24, 'De 1 a 24 parcelas').optional(),
  primeiroVencimento: dataIso.nullish(),
}

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
    ...condicao,
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

type Corpo = z.infer<typeof corpo>

// Vendedor, médico e paciente são opcionais e precisam ter a classificação correspondente no cadastro.
async function pessoasDoPedido(dados: Corpo) {
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
async function valores(dados: Corpo) {
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
    // A campanha não acumula com desconto manual nos produtos dela; os demais itens aceitam desconto.
    // O desconto no total valeria também para os produtos da campanha, por isso fica bloqueado.
    const campanha = await carregarVigente(dados.promocaoId)
    const participantes = new Set(campanha.itens.map((i) => i.produtoId))
    if (desconto > 0) throw new AppError(400, 'Pedido com campanha não aceita desconto no total.')
    const comDesconto = itens.find((i) => i.desconto > 0 && participantes.has(i.produtoId))
    if (comDesconto) {
      const nome = produtos.find((p) => p.id === comDesconto.produtoId)!.nome
      throw new AppError(400, `"${nome}" participa da campanha e não aceita desconto manual.`)
    }
    descontoPromocao = Math.min(subtotal - descontoItens, calcularDescontoPromocao(campanha, itens))
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

// Só a venda tem condição de pagamento.
function condicaoDoPedido(dados: Corpo) {
  const venda = dados.natureza === 'VENDA'
  return {
    formaPagamento: venda ? (dados.formaPagamento ?? null) : null,
    parcelas: venda ? (dados.parcelas ?? 1) : 1,
    primeiroVencimento: venda ? (dados.primeiroVencimento ?? null) : null,
  }
}

// Quantidade do item em partes do estoque. O fator de um lançamento sempre divide o divisor do produto,
// porque o divisor só cresce; o arredondamento é só uma proteção.
const emPartes = (item: { quantidade: number; fator: number; produto: { divisor: number } }) =>
  Math.round((item.quantidade * item.produto.divisor) / item.fator)

const comDetalhes = {
  cliente: { select: { id: true, nome: true } },
  usuario: { select: { id: true, nome: true } },
  vendedor: { select: { id: true, nome: true } },
  medico: { select: { id: true, nome: true } },
  paciente: { select: { id: true, nome: true } },
  promocao: { select: { id: true, nome: true } },
  itens: { include: { produto: { select: { id: true, sku: true, nome: true, unidade: true } } } },
} as const

type Condicao = { formaPagamento: string; parcelas: number; primeiroVencimento: Date }

// Faturamento: confere e baixa o estoque, guarda o custo dos itens e, na venda, gera as parcelas a receber.
async function faturarNaTransacao(tx: Transacao, id: number, condicao: Condicao | null) {
  const pedido = await tx.pedido.findUniqueOrThrow({ where: { id }, include: { itens: { include: { produto: true } } } })

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

  if (condicao && pedido.total > 0) {
    const base = Math.floor(pedido.total / condicao.parcelas)
    const resto = pedido.total - base * condicao.parcelas
    for (let n = 0; n < condicao.parcelas; n++) {
      await tx.contaReceber.create({
        data: {
          pessoaId: pedido.clienteId,
          pedidoId: id,
          descricao: `Pedido nº ${pedido.numero} — parcela ${n + 1}/${condicao.parcelas}`,
          valor: base + (n === 0 ? resto : 0),
          vencimento: somarMeses(condicao.primeiroVencimento, n),
        },
      })
    }
  }
}

// Desfaz a parte do faturamento que ainda não teve consequência: devolve ao estoque o que saiu dele e
// cancela as parcelas em aberto. Quem chama confere antes que nada foi recebido nem entregue.
async function desfazerFaturamento(tx: Transacao, id: number, origem: 'CANCELAMENTO' | 'ALTERACAO') {
  const pedido = await tx.pedido.findUniqueOrThrow({ where: { id }, include: { itens: { include: { produto: { select: { divisor: true } } } } } })
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
        origem,
        origemId: id,
      },
    })
  }
  await tx.contaReceber.updateMany({ where: { pedidoId: id, status: 'ABERTA' }, data: { status: 'CANCELADA' } })
}

// A condição final de uma venda: o que veio agora, completado pelo que ficou gravado no pedido.
function condicaoFinal(
  pedido: { formaPagamento: string | null; parcelas: number; primeiroVencimento: Date | null },
  dados: { formaPagamento?: string | null; parcelas?: number; primeiroVencimento?: Date | null },
): Condicao {
  const formaPagamento = dados.formaPagamento ?? pedido.formaPagamento
  const primeiroVencimento = dados.primeiroVencimento ?? pedido.primeiroVencimento
  if (!formaPagamento) throw new AppError(400, 'Selecione a forma de pagamento')
  if (!primeiroVencimento) throw new AppError(400, 'Informe o primeiro vencimento.')
  return { formaPagamento, parcelas: dados.parcelas ?? pedido.parcelas, primeiroVencimento }
}

// Os itens e valores do pedido, para comparar o que estava gravado com o que chegou.
const assinaturaValores = (p: {
  promocaoId?: number | null
  desconto: number
  frete: number
  itens: { produtoId: number; unidade?: string | null; quantidade: number; precoUnitario: number; desconto: number }[]
}) =>
  JSON.stringify([
    p.promocaoId ?? null,
    p.desconto,
    p.frete,
    p.itens.map((i) => [i.produtoId, i.unidade ?? '', i.quantidade, i.precoUnitario, i.desconto]).sort(),
  ])

export async function rotasPedidos(app: FastifyInstance) {
  // Lista os mais recentes; a busca e o período procuram em todos os pedidos, não só nos que cabem na lista.
  app.get('/pedidos', async (req) => {
    const q = z
      .object({
        status: z.enum(['ABERTO', 'FATURADO', 'CANCELADO']).optional(),
        busca: z.string().trim().optional(),
        inicio: dia.optional(),
        fim: dia.optional(),
      })
      .parse(req.query)
    // "123" ou "#123" acha o pedido de número 123; o texto procura nas pessoas e na observação.
    const numero = q.busca ? Number(q.busca.replace(/^#/, '')) : NaN
    const contem = { contains: q.busca, mode: 'insensitive' as const }
    return prisma.pedido.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        criadoEm: intervalo(q.inicio, q.fim),
        ...(q.busca
          ? {
              OR: [
                ...(Number.isInteger(numero) && numero > 0 ? [{ numero }] : []),
                { cliente: { nome: contem } },
                { cliente: { nomeFantasia: contem } },
                { vendedor: { nome: contem } },
                { medico: { nome: contem } },
                { paciente: { nome: contem } },
                { observacao: contem },
              ],
            }
          : {}),
      },
      include: comDetalhes,
      orderBy: { id: 'desc' },
      take: LIMITE_LISTA,
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
    const campos = {
      clienteId: dados.clienteId,
      usuarioId: req.usuario.id,
      observacao: dados.observacao,
      ...(await pessoasDoPedido(dados)),
      ...(await valores(dados)),
      ...condicaoDoPedido(dados),
    }
    const pedido = await prisma.$transaction(async (tx) => {
      // O incremento trava a linha da empresa até o fim da transação: dois pedidos simultâneos não pegam o mesmo número.
      const { ultimoPedido: numero } = await tx.empresa.update({
        where: { id: req.usuario.empresa.id },
        data: { ultimoPedido: { increment: 1 } },
        select: { ultimoPedido: true },
      })
      return tx.pedido.create({ data: { ...campos, numero }, include: comDetalhes })
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
          ...condicaoDoPedido(dados),
        },
        include: comDetalhes,
      })
    })
  })

  // Alteração de pedido já faturado. Cliente, vendedor, médico, paciente e observação mudam sempre.
  // Mudar itens, valores ou a condição de pagamento refaz o faturamento: o estoque volta, as parcelas em
  // aberto são canceladas e o pedido é faturado de novo. Para isso nada pode ter sido recebido, devolvido
  // ou estar em rota. A natureza não muda depois do faturamento.
  app.put('/pedidos/:id/faturado', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = corpo.parse(req.body)
    return prisma.$transaction(async (tx) => {
      const atual = await tx.pedido.findUnique({
        where: { id },
        include: { itens: true, contasReceber: true, entregas: true, _count: { select: { devolucoes: { where: { estornada: false } } } } },
      })
      if (!atual) throw new AppError(404, 'Pedido não encontrado.')
      if (atual.status !== 'FATURADO') throw new AppError(409, 'Só pedidos faturados são alterados por aqui.')
      if (dados.natureza !== atual.natureza) throw new AppError(400, 'A natureza da operação não muda depois do faturamento.')
      const pessoas = await pessoasDoPedido(dados)
      const venda = atual.natureza === 'VENDA'

      const novaCondicao = venda ? condicaoFinal(atual, dados) : null
      const mudouCondicao =
        venda &&
        (novaCondicao!.formaPagamento !== atual.formaPagamento ||
          novaCondicao!.parcelas !== atual.parcelas ||
          novaCondicao!.primeiroVencimento.toDateString() !== atual.primeiroVencimento?.toDateString())
      const motivoPerda = atual.natureza === 'PERDA' ? (dados.motivoPerda ?? null) : null
      // Item sem unidade é na unidade base do produto, que é a gravada no pedido.
      const bases = await tx.produto.findMany({ where: { id: { in: dados.itens.map((i) => i.produtoId) } }, select: { id: true, unidade: true } })
      const itensRecebidos = dados.itens.map((i) => ({
        ...i,
        unidade: i.unidade || bases.find((b) => b.id === i.produtoId)?.unidade,
        // A perda é gravada sem preço nem desconto.
        ...(atual.natureza === 'PERDA' ? { precoUnitario: 0, desconto: 0 } : {}),
      }))
      const mudouValores = assinaturaValores({ ...dados, itens: itensRecebidos }) !== assinaturaValores(atual) || motivoPerda !== atual.motivoPerda

      if (mudouValores || mudouCondicao) {
        if (atual._count.devolucoes > 0) throw new AppError(409, 'O pedido tem devolução registrada: os itens e valores não podem mais ser alterados.')
        if (atual.entregas.some((e) => e.status === 'EM_ROTA')) throw new AppError(409, 'Há uma entrega em rota. Registre a conclusão ou a falha antes de alterar.')
        if (atual.contasReceber.some((c) => c.status !== 'CANCELADA' && c.valorPago > 0)) {
          throw new AppError(409, 'Há parcelas já recebidas. Estorne os recebimentos antes de alterar itens, valores ou pagamento.')
        }
        await desfazerFaturamento(tx, id, 'ALTERACAO')
        await tx.pedidoItem.deleteMany({ where: { pedidoId: id } })
        await tx.pedido.update({
          where: { id },
          data: {
            clienteId: dados.clienteId,
            observacao: dados.observacao,
            ...pessoas,
            ...(await valores(dados)),
            formaPagamento: novaCondicao?.formaPagamento ?? null,
            parcelas: novaCondicao?.parcelas ?? 1,
            primeiroVencimento: novaCondicao?.primeiroVencimento ?? null,
          },
        })
        await faturarNaTransacao(tx, id, novaCondicao)
      } else {
        await tx.pedido.update({ where: { id }, data: { clienteId: dados.clienteId, observacao: dados.observacao, ...pessoas } })
        // As parcelas acompanham o cliente do pedido.
        if (dados.clienteId !== atual.clienteId) {
          await tx.contaReceber.updateMany({ where: { pedidoId: id, status: 'ABERTA' }, data: { pessoaId: dados.clienteId } })
        }
      }
      return tx.pedido.findUniqueOrThrow({ where: { id }, include: { ...comDetalhes, contasReceber: { orderBy: { vencimento: 'asc' } } } })
    })
  })

  // Faturar baixa o estoque e, na venda, gera as parcelas a receber. Bonificação e perda só baixam o estoque.
  // Forma, parcelas e vencimento escolhidos no pedido valem quando não vierem aqui. Créditos do cliente
  // informados em `creditos` abatem as parcelas, da primeira para a última.
  app.post('/pedidos/:id/faturar', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = z
      .object({
        ...condicao,
        creditos: z
          .array(z.object({ creditoId: z.number().int().positive(), valor: z.number().int().positive('Informe o valor do crédito') }))
          .max(20)
          .default([]),
      })
      .parse(req.body ?? {})
    if (dados.creditos.length && !req.usuario.permissoes.includes('CREDITOS_UTILIZAR')) {
      throw new AppError(403, 'Seu perfil de acesso não permite usar créditos.')
    }

    return prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.findUnique({ where: { id } })
      if (!pedido) throw new AppError(404, 'Pedido não encontrado.')
      if (pedido.status !== 'ABERTO') throw new AppError(409, 'Este pedido não está em aberto.')
      const condicaoVenda = pedido.natureza === 'VENDA' ? condicaoFinal(pedido, dados) : null
      if (dados.creditos.length && !condicaoVenda) throw new AppError(400, 'Só vendas usam crédito no faturamento.')
      if (dados.creditos.reduce((s, c) => s + c.valor, 0) > pedido.total) throw new AppError(400, 'Os créditos passam do total do pedido.')
      await faturarNaTransacao(tx, id, condicaoVenda)
      for (const uso of dados.creditos) {
        let resta = uso.valor
        const parcelas = await tx.contaReceber.findMany({ where: { pedidoId: id, status: 'ABERTA' }, orderBy: [{ vencimento: 'asc' }, { id: 'asc' }] })
        for (const parcela of parcelas) {
          const valor = Math.min(resta, parcela.valor - parcela.valorPago)
          if (valor <= 0) continue
          await aplicarCredito(tx, { creditoId: uso.creditoId, contaReceberId: parcela.id, pessoaId: pedido.clienteId, valor, usuarioId: req.usuario.id })
          resta -= valor
          if (resta === 0) break
        }
      }
      return tx.pedido.update({
        where: { id },
        data: {
          status: 'FATURADO',
          faturadoEm: new Date(),
          formaPagamento: condicaoVenda?.formaPagamento ?? null,
          parcelas: condicaoVenda?.parcelas ?? 1,
          primeiroVencimento: condicaoVenda?.primeiroVencimento ?? null,
        },
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
        include: { contasReceber: true, entregas: true, _count: { select: { devolucoes: { where: { estornada: false } } } } },
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
        await desfazerFaturamento(tx, id, 'CANCELAMENTO')
      }
      return tx.pedido.update({ where: { id }, data: { status: 'CANCELADO' }, include: comDetalhes })
    })
  })
}
