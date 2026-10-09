import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { inicioDeHoje, prisma } from '../lib.js'

const MESES_DE_HISTORICO = 6

const consulta = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido')
    .optional(),
})

// Devolve o mês pedido (ou o atual) e os limites do histórico que termina nele.
function periodo(mes?: string) {
  const hoje = new Date()
  const [ano, numero] = mes ? mes.split('-').map(Number) : [hoje.getFullYear(), hoje.getMonth() + 1]
  const inicio = new Date(ano, numero - 1, 1)
  const fim = new Date(ano, numero, 1)
  const inicioHistorico = new Date(ano, numero - MESES_DE_HISTORICO, 1)
  const meses = Array.from({ length: MESES_DE_HISTORICO }, (_, i) =>
    chaveMes(new Date(ano, numero - MESES_DE_HISTORICO + i, 1)),
  )
  return { chave: chaveMes(inicio), inicio, fim, inicioHistorico, meses, diasNoMes: new Date(ano, numero, 0).getDate() }
}

const chaveMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// Soma valores por chave e devolve os maiores, para os rankings.
function ranking(entradas: { chave: string; nome: string; valor: number }[], limite = 5) {
  const mapa = new Map<string, { nome: string; total: number }>()
  for (const e of entradas) {
    const atual = mapa.get(e.chave) ?? { nome: e.nome, total: 0 }
    atual.total += e.valor
    mapa.set(e.chave, atual)
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total).slice(0, limite)
}

export async function rotasDashboards(app: FastifyInstance) {
  // Vendas contam pelo dia do faturamento; pedidos cancelados, bonificações e perdas ficam de fora.
  app.get('/dashboards/comercial', async (req) => {
    const p = periodo(consulta.parse(req.query).mes)
    const pedidos = await prisma.pedido.findMany({
      where: { status: 'FATURADO', natureza: 'VENDA', faturadoEm: { gte: p.inicioHistorico, lt: p.fim } },
      select: {
        id: true,
        total: true,
        desconto: true,
        descontoItens: true,
        descontoPromocao: true,
        frete: true,
        faturadoEm: true,
        cliente: { select: { id: true, nome: true } },
        vendedor: { select: { id: true, nome: true } },
        itens: {
          select: {
            quantidade: true,
            precoUnitario: true,
            desconto: true,
            custoUnitario: true,
            produto: { select: { id: true, sku: true, nome: true } },
          },
        },
      },
    })

    const porMes = new Map(p.meses.map((m) => [m, { mes: m, total: 0, vendas: 0 }]))
    for (const pedido of pedidos) {
      const mes = porMes.get(chaveMes(pedido.faturadoEm!))
      if (!mes) continue
      mes.total += pedido.total
      mes.vendas += 1
    }

    const doMes = pedidos.filter((pedido) => pedido.faturadoEm! >= p.inicio)
    const faturamento = doMes.reduce((s, pedido) => s + pedido.total, 0)
    const frete = doMes.reduce((s, pedido) => s + pedido.frete, 0)
    const itens = doMes.flatMap((pedido) => pedido.itens)
    const custo = itens.reduce((s, i) => s + i.quantidade * i.custoUnitario, 0)
    // O frete é repasse, não resultado da venda, então fica fora da margem.
    const margem = faturamento - frete - custo

    const dias = Array.from({ length: p.diasNoMes }, (_, i) => ({ dia: i + 1, total: 0, vendas: 0 }))
    for (const pedido of doMes) {
      const dia = dias[pedido.faturadoEm!.getDate() - 1]
      dia.total += pedido.total
      dia.vendas += 1
    }

    return {
      mes: p.chave,
      kpis: {
        faturamento,
        vendas: doMes.length,
        ticketMedio: doMes.length ? Math.round(faturamento / doMes.length) : 0,
        descontos: doMes.reduce((s, pedido) => s + pedido.desconto + pedido.descontoItens + pedido.descontoPromocao, 0),
        frete,
        custo,
        margem,
        margemPercentual: faturamento - frete > 0 ? Math.round((margem / (faturamento - frete)) * 1000) / 10 : 0,
      },
      dias,
      meses: [...porMes.values()],
      topVendedores: ranking(
        doMes.map((pedido) => ({
          chave: String(pedido.vendedor?.id ?? 0),
          nome: pedido.vendedor?.nome ?? 'Sem vendedor',
          valor: pedido.total,
        })),
      ),
      topClientes: ranking(
        doMes.map((pedido) => ({ chave: String(pedido.cliente.id), nome: pedido.cliente.nome, valor: pedido.total })),
      ),
      topProdutos: ranking(
        itens.map((i) => ({
          chave: String(i.produto.id),
          nome: `${i.produto.sku} · ${i.produto.nome}`,
          valor: i.quantidade * (i.precoUnitario - i.desconto),
        })),
      ),
    }
  })

  // Recebido e pago contam pelo dia da baixa; a receber e a pagar, pelo vencimento.
  app.get('/dashboards/financeiro', async (req) => {
    const p = periodo(consulta.parse(req.query).mes)
    const hoje = inicioDeHoje()
    // Cada baixa, total ou parcial, é um movimento; as estornadas ficam de fora.
    const baixas = { estornado: false, data: { gte: p.inicioHistorico, lt: p.fim } }
    const somaSaldo = { _sum: { valor: true, valorPago: true } } as const
    const [recebidas, pagas, aReceber, aPagar, vencidoReceber, vencidoPagar, despesas] = await Promise.all([
      prisma.movimentoFinanceiro.findMany({
        where: { ...baixas, origem: 'RECEBIMENTO' },
        select: { valor: true, data: true, contaReceber: { select: { pedido: { select: { formaPagamento: true } } } } },
      }),
      prisma.movimentoFinanceiro.findMany({ where: { ...baixas, origem: 'PAGAMENTO' }, select: { valor: true, data: true } }),
      prisma.contaReceber.aggregate({ where: { status: 'ABERTA', vencimento: { gte: p.inicio, lt: p.fim } }, ...somaSaldo }),
      prisma.contaPagar.aggregate({ where: { status: 'ABERTA', vencimento: { gte: p.inicio, lt: p.fim } }, ...somaSaldo }),
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

    const porMes = new Map(p.meses.map((m) => [m, { mes: m, recebido: 0, pago: 0, despesas: 0 }]))
    for (const c of recebidas) porMes.get(chaveMes(c.data))!.recebido += c.valor
    for (const c of pagas) porMes.get(chaveMes(c.data))!.pago += c.valor
    for (const d of despesas) porMes.get(chaveMes(d.dataCompetencia))!.despesas += d.valor
    const atual = porMes.get(p.chave)!
    const despesasDoMes = despesas.filter((d) => d.dataCompetencia >= p.inicio)

    return {
      mes: p.chave,
      kpis: {
        recebido: atual.recebido,
        pago: atual.pago,
        saldo: atual.recebido - atual.pago,
        aReceber: saldo(aReceber),
        aPagar: saldo(aPagar),
        vencidoReceber: saldo(vencidoReceber),
        vencidoPagar: saldo(vencidoPagar),
        despesas: atual.despesas,
      },
      meses: [...porMes.values()],
      despesasPorElemento: ranking(
        despesasDoMes.map((d) => ({ chave: d.elemento.toLowerCase(), nome: d.elemento, valor: d.valor })),
        10,
      ),
      formas: ranking(
        recebidas
          .filter((c) => c.data >= p.inicio)
          .map((c) => {
            const forma = c.contaReceber?.pedido?.formaPagamento ?? 'OUTROS'
            return { chave: forma, nome: forma, valor: c.valor }
          }),
        10,
      ),
    }
  })
}
