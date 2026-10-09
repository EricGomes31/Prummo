import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { dia, inicioDeHoje, intervalo, prisma } from '../lib.js'

const PERIODOS_DE_HISTORICO = 6
// Início de "todo o período": antes de qualquer lançamento possível.
const COMECO = new Date(2000, 0, 1)

// O período é um mês ("2026-10"), um ano ("2026") ou tudo ("tudo"). Sem nada, o mês atual.
const consulta = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido')
    .optional(),
  ano: z
    .string()
    .regex(/^\d{4}$/, 'Ano inválido')
    .optional(),
  tudo: z.enum(['1', 'true']).optional(),
})

const dois = (n: number) => String(n).padStart(2, '0')
const chaveMes = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}`
const chaveAno = (d: Date) => String(d.getFullYear())

type Periodo = {
  tipo: 'mes' | 'ano' | 'tudo'
  chave: string
  inicio: Date
  fim: Date
  inicioHistorico: Date
  // Detalhe dentro do período (dias do mês, meses do ano, anos de tudo) e evolução dos períodos anteriores.
  detalhe: string[]
  chaveDetalhe: (d: Date) => string
  historico: string[]
  chaveHistorico: (d: Date) => string
}

// Monta o período pedido. Em "tudo", os anos vão do primeiro com lançamento (`primeiroAno`) até o atual.
function periodo(q: z.infer<typeof consulta>, primeiroAno: number): Periodo {
  const hoje = new Date()
  if (q.tudo) {
    const anos = Array.from({ length: hoje.getFullYear() - primeiroAno + 1 }, (_, i) => String(primeiroAno + i))
    const fim = new Date(hoje.getFullYear() + 1, 0, 1)
    return { tipo: 'tudo', chave: 'tudo', inicio: COMECO, fim, inicioHistorico: COMECO, detalhe: anos, chaveDetalhe: chaveAno, historico: anos, chaveHistorico: chaveAno }
  }
  if (q.ano) {
    const ano = Number(q.ano)
    return {
      tipo: 'ano',
      chave: q.ano,
      inicio: new Date(ano, 0, 1),
      fim: new Date(ano + 1, 0, 1),
      inicioHistorico: new Date(ano - PERIODOS_DE_HISTORICO + 1, 0, 1),
      detalhe: Array.from({ length: 12 }, (_, i) => `${ano}-${dois(i + 1)}`),
      chaveDetalhe: chaveMes,
      historico: Array.from({ length: PERIODOS_DE_HISTORICO }, (_, i) => String(ano - PERIODOS_DE_HISTORICO + 1 + i)),
      chaveHistorico: chaveAno,
    }
  }
  const [ano, numero] = q.mes ? q.mes.split('-').map(Number) : [hoje.getFullYear(), hoje.getMonth() + 1]
  const inicio = new Date(ano, numero - 1, 1)
  return {
    tipo: 'mes',
    chave: chaveMes(inicio),
    inicio,
    fim: new Date(ano, numero, 1),
    inicioHistorico: new Date(ano, numero - PERIODOS_DE_HISTORICO, 1),
    detalhe: Array.from({ length: new Date(ano, numero, 0).getDate() }, (_, i) => String(i + 1)),
    chaveDetalhe: (d) => String(d.getDate()),
    historico: Array.from({ length: PERIODOS_DE_HISTORICO }, (_, i) => chaveMes(new Date(ano, numero - PERIODOS_DE_HISTORICO + i, 1))),
    chaveHistorico: chaveMes,
  }
}

// Ano do lançamento mais antigo, para o período "tudo".
async function primeiroAno() {
  const [pedido, movimento, despesa] = await Promise.all([
    prisma.pedido.findFirst({ where: { status: 'FATURADO' }, orderBy: { data: 'asc' }, select: { data: true } }),
    prisma.movimentoFinanceiro.findFirst({ orderBy: { data: 'asc' }, select: { data: true } }),
    prisma.despesa.findFirst({ orderBy: { dataCompetencia: 'asc' }, select: { dataCompetencia: true } }),
  ])
  const datas = [pedido?.data, movimento?.data, despesa?.dataCompetencia].filter((d): d is Date => !!d)
  return Math.min(new Date().getFullYear(), ...datas.map((d) => d.getFullYear()))
}

// Soma valores por chave e devolve os maiores, para os rankings.
function ranking(entradas: { chave: string; nome: string; valor: number }[], limite = 10) {
  const mapa = new Map<string, { nome: string; total: number }>()
  for (const e of entradas) {
    const atual = mapa.get(e.chave) ?? { nome: e.nome, total: 0 }
    atual.total += e.valor
    mapa.set(e.chave, atual)
  }
  return [...mapa.values()].filter((i) => i.total !== 0).sort((a, b) => b.total - a.total).slice(0, limite)
}

export async function rotasDashboards(app: FastifyInstance) {
  // Vendas contam pela data da venda; pedidos cancelados, bonificações e perdas ficam de fora.
  // Devoluções abatem o faturamento, o custo e os rankings no dia em que foram registradas.
  app.get('/dashboards/comercial', async (req) => {
    const q = consulta.parse(req.query)
    const p = periodo(q, q.tudo ? await primeiroAno() : 0)
    const pessoa = { select: { id: true, nome: true } } as const
    const [pedidos, devolucoes] = await Promise.all([
      prisma.pedido.findMany({
        where: { status: 'FATURADO', natureza: 'VENDA', data: { gte: p.inicioHistorico, lt: p.fim } },
        select: {
          id: true,
          total: true,
          desconto: true,
          descontoItens: true,
          descontoPromocao: true,
          frete: true,
          data: true,
          cliente: pessoa,
          vendedor: pessoa,
          itens: {
            select: { quantidade: true, precoUnitario: true, desconto: true, custoUnitario: true, produto: { select: { id: true, sku: true, nome: true } } },
          },
        },
      }),
      prisma.devolucao.findMany({
        where: { estornada: false, criadoEm: { gte: p.inicioHistorico, lt: p.fim } },
        select: {
          valorCredito: true,
          criadoEm: true,
          pedido: { select: { cliente: pessoa, vendedor: pessoa } },
          itens: { select: { quantidade: true, valorUnitario: true, pedidoItem: { select: { custoUnitario: true, produto: { select: { id: true, sku: true, nome: true } } } } } },
        },
      }),
    ])

    const historico = new Map(p.historico.map((c) => [c, { chave: c, total: 0, vendas: 0, devolvido: 0 }]))
    for (const pedido of pedidos) {
      const h = historico.get(p.chaveHistorico(pedido.data))
      if (!h) continue
      h.total += pedido.total
      h.vendas += 1
    }
    for (const d of devolucoes) {
      const h = historico.get(p.chaveHistorico(d.criadoEm))
      if (!h) continue
      h.total -= d.valorCredito
      h.devolvido += d.valorCredito
    }

    const doPeriodo = pedidos.filter((pedido) => pedido.data >= p.inicio)
    const devolvidas = devolucoes.filter((d) => d.criadoEm >= p.inicio)
    const vendasBrutas = doPeriodo.reduce((s, pedido) => s + pedido.total, 0)
    const devolvido = devolvidas.reduce((s, d) => s + d.valorCredito, 0)
    const faturamento = vendasBrutas - devolvido
    const frete = doPeriodo.reduce((s, pedido) => s + pedido.frete, 0)
    const itens = doPeriodo.flatMap((pedido) => pedido.itens)
    const itensDevolvidos = devolvidas.flatMap((d) => d.itens)
    // A mercadoria devolvida volta ao estoque: o custo dela sai do custo das vendas.
    const custo =
      itens.reduce((s, i) => s + i.quantidade * i.custoUnitario, 0) - itensDevolvidos.reduce((s, i) => s + i.quantidade * i.pedidoItem.custoUnitario, 0)
    // O frete é repasse, não resultado da venda, então fica fora da margem.
    const margem = faturamento - frete - custo

    const detalhe = new Map(p.detalhe.map((c) => [c, { chave: c, total: 0, vendas: 0 }]))
    for (const pedido of doPeriodo) {
      const d = detalhe.get(p.chaveDetalhe(pedido.data))
      if (!d) continue
      d.total += pedido.total
      d.vendas += 1
    }
    for (const dev of devolvidas) {
      const d = detalhe.get(p.chaveDetalhe(dev.criadoEm))
      if (d) d.total -= dev.valorCredito
    }

    return {
      periodo: { tipo: p.tipo, chave: p.chave },
      kpis: {
        faturamento,
        vendasBrutas,
        devolucoes: devolvido,
        vendas: doPeriodo.length,
        ticketMedio: doPeriodo.length ? Math.round(vendasBrutas / doPeriodo.length) : 0,
        descontos: doPeriodo.reduce((s, pedido) => s + pedido.desconto + pedido.descontoItens + pedido.descontoPromocao, 0),
        frete,
        custo,
        margem,
        margemPercentual: faturamento - frete > 0 ? Math.round((margem / (faturamento - frete)) * 1000) / 10 : 0,
      },
      detalhe: [...detalhe.values()],
      historico: [...historico.values()],
      topVendedores: ranking([
        ...doPeriodo.map((pedido) => ({ chave: String(pedido.vendedor?.id ?? 0), nome: pedido.vendedor?.nome ?? 'Sem vendedor', valor: pedido.total })),
        ...devolvidas.map((d) => ({ chave: String(d.pedido.vendedor?.id ?? 0), nome: d.pedido.vendedor?.nome ?? 'Sem vendedor', valor: -d.valorCredito })),
      ]),
      topClientes: ranking([
        ...doPeriodo.map((pedido) => ({ chave: String(pedido.cliente.id), nome: pedido.cliente.nome, valor: pedido.total })),
        ...devolvidas.map((d) => ({ chave: String(d.pedido.cliente.id), nome: d.pedido.cliente.nome, valor: -d.valorCredito })),
      ]),
      topProdutos: ranking([
        ...itens.map((i) => ({ chave: String(i.produto.id), nome: `${i.produto.sku} · ${i.produto.nome}`, valor: i.quantidade * (i.precoUnitario - i.desconto) })),
        ...itensDevolvidos.map((i) => ({
          chave: String(i.pedidoItem.produto.id),
          nome: `${i.pedidoItem.produto.sku} · ${i.pedidoItem.produto.nome}`,
          valor: -i.quantidade * i.valorUnitario,
        })),
      ]),
    }
  })

  // As vendas de um dia, mês ou ano do gráfico do dashboard comercial (as mesmas que ele soma).
  app.get('/dashboards/comercial/vendas', async (req) => {
    const q = z.object({ inicio: dia, fim: dia }).parse(req.query)
    const pedidos = await prisma.pedido.findMany({
      where: { status: 'FATURADO', natureza: 'VENDA', data: intervalo(q.inicio, q.fim) },
      select: { id: true, numero: true, data: true, total: true, cliente: { select: { nome: true } }, vendedor: { select: { nome: true } } },
      orderBy: [{ data: 'asc' }, { numero: 'asc' }],
      take: 1000,
    })
    return pedidos.map((p) => ({ id: p.id, numero: p.numero, data: p.data, total: p.total, cliente: p.cliente.nome, vendedor: p.vendedor?.nome ?? null }))
  })

  // Recebido e pago contam pelo dia da baixa; a receber e a pagar, pelo vencimento; despesas, pela competência.
  app.get('/dashboards/financeiro', async (req) => {
    const q = consulta.parse(req.query)
    const p = periodo(q, q.tudo ? await primeiroAno() : 0)
    const hoje = inicioDeHoje()
    // Cada baixa, total ou parcial, é um movimento; as estornadas ficam de fora.
    const baixas = { estornado: false, data: { gte: p.inicioHistorico, lt: p.fim } }
    const somaSaldo = { _sum: { valor: true, valorPago: true } } as const
    const noPeriodo = { gte: p.inicio, lt: p.fim }
    const [recebidas, pagas, aReceber, aPagar, vencidoReceber, vencidoPagar, despesas] = await Promise.all([
      prisma.movimentoFinanceiro.findMany({
        where: { ...baixas, origem: 'RECEBIMENTO' },
        select: { valor: true, data: true, contaReceber: { select: { pedido: { select: { formaPagamento: true } } } } },
      }),
      prisma.movimentoFinanceiro.findMany({ where: { ...baixas, origem: 'PAGAMENTO' }, select: { valor: true, data: true } }),
      prisma.contaReceber.aggregate({ where: { status: 'ABERTA', vencimento: noPeriodo }, ...somaSaldo }),
      prisma.contaPagar.aggregate({ where: { status: 'ABERTA', vencimento: noPeriodo }, ...somaSaldo }),
      prisma.contaReceber.aggregate({ where: { status: 'ABERTA', vencimento: { lt: hoje } }, ...somaSaldo }),
      prisma.contaPagar.aggregate({ where: { status: 'ABERTA', vencimento: { lt: hoje } }, ...somaSaldo }),
      // Despesas contam pela competência, paga ou não.
      prisma.despesa.findMany({
        where: { status: 'ATIVA', dataCompetencia: { gte: p.inicioHistorico, lt: p.fim } },
        select: { valor: true, elemento: true, dataCompetencia: true },
        orderBy: { id: 'asc' },
      }),
    ])
    // Em aberto é o saldo: o valor da conta menos o que já foi baixado em parte.
    const saldo = (a: { _sum: { valor: number | null; valorPago: number | null } }) => (a._sum.valor ?? 0) - (a._sum.valorPago ?? 0)

    const historico = new Map(p.historico.map((c) => [c, { chave: c, recebido: 0, pago: 0, despesas: 0 }]))
    const somar = (data: Date, campo: 'recebido' | 'pago' | 'despesas', valor: number) => {
      const h = historico.get(p.chaveHistorico(data))
      if (h) h[campo] += valor
    }
    for (const c of recebidas) somar(c.data, 'recebido', c.valor)
    for (const c of pagas) somar(c.data, 'pago', c.valor)
    for (const d of despesas) somar(d.dataCompetencia, 'despesas', d.valor)
    const doPeriodo = <T,>(lista: T[], data: (x: T) => Date) => lista.filter((x) => data(x) >= p.inicio)
    const recebido = doPeriodo(recebidas, (c) => c.data).reduce((s, c) => s + c.valor, 0)
    const pago = doPeriodo(pagas, (c) => c.data).reduce((s, c) => s + c.valor, 0)
    const despesasDoPeriodo = doPeriodo(despesas, (d) => d.dataCompetencia)

    return {
      periodo: { tipo: p.tipo, chave: p.chave },
      kpis: {
        recebido,
        pago,
        saldo: recebido - pago,
        aReceber: saldo(aReceber),
        aPagar: saldo(aPagar),
        vencidoReceber: saldo(vencidoReceber),
        vencidoPagar: saldo(vencidoPagar),
        despesas: despesasDoPeriodo.reduce((s, d) => s + d.valor, 0),
      },
      historico: [...historico.values()],
      formas: ranking(
        doPeriodo(recebidas, (c) => c.data).map((c) => {
          const forma = c.contaReceber?.pedido?.formaPagamento ?? 'OUTROS'
          return { chave: forma, nome: forma, valor: c.valor }
        }),
        10,
      ),
      despesasPorElemento: ranking(
        despesasDoPeriodo.map((d) => ({ chave: d.elemento.toLowerCase(), nome: d.elemento, valor: d.valor })),
        10,
      ),
    }
  })
}
