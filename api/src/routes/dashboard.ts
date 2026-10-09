import type { FastifyInstance } from 'fastify'
import { inicioDeHoje, prisma } from '../lib.js'

export async function rotasDashboard(app: FastifyInstance) {
  app.get('/dashboard/resumo', async () => {
    const hoje = inicioDeHoje()
    const [faturados, devolvido, abertos, receber, receberVencidas, pagar, pagarVencidas, cadastros, ultimosPedidos, entregas] =
      await Promise.all([
        prisma.pedido.aggregate({ where: { status: 'FATURADO', natureza: 'VENDA' }, _count: true, _sum: { total: true } }),
        // As devoluções abatem o total vendido.
        prisma.devolucao.aggregate({ where: { estornada: false }, _sum: { valorCredito: true } }),
        prisma.pedido.count({ where: { status: 'ABERTO' } }),
        prisma.contaReceber.aggregate({ where: { status: 'ABERTA' }, _sum: { valor: true, valorPago: true } }),
        prisma.contaReceber.count({ where: { status: 'ABERTA', vencimento: { lt: hoje } } }),
        prisma.contaPagar.aggregate({ where: { status: 'ABERTA' }, _sum: { valor: true, valorPago: true } }),
        prisma.contaPagar.count({ where: { status: 'ABERTA', vencimento: { lt: hoje } } }),
        prisma.produto.findMany({
          where: { ativo: true, controlaEstoque: true },
          select: { id: true, sku: true, nome: true, unidade: true, saldo: true, divisor: true, estoqueMinimo: true, precoCusto: true },
        }),
        prisma.pedido.findMany({
          include: { cliente: { select: { nome: true } } },
          orderBy: { id: 'desc' },
          take: 5,
        }),
        prisma.entrega.groupBy({
          by: ['status'],
          where: { status: { in: ['PENDENTE', 'EM_ROTA', 'FALHOU'] } },
          _count: true,
        }),
      ])
    const entregasEm = (status: string) => entregas.find((e) => e.status === status)?._count ?? 0
    // O saldo é guardado em partes; aqui passa para a unidade base, que é a do custo e do estoque mínimo.
    const produtos = cadastros.map(({ divisor, ...p }) => ({ ...p, saldo: p.saldo / divisor }))

    // Em aberto é o saldo: o valor da conta menos o que já foi baixado em parte.
    const aReceber = (receber._sum.valor ?? 0) - (receber._sum.valorPago ?? 0)
    const aPagar = (pagar._sum.valor ?? 0) - (pagar._sum.valorPago ?? 0)
    return {
      vendas: { quantidade: faturados._count, total: (faturados._sum.total ?? 0) - (devolvido._sum.valorCredito ?? 0), pedidosAbertos: abertos },
      receber: { total: aReceber, vencidas: receberVencidas },
      pagar: { total: aPagar, vencidas: pagarVencidas },
      saldoProjetado: aReceber - aPagar,
      entregas: { pendentes: entregasEm('PENDENTE'), emRota: entregasEm('EM_ROTA'), falhas: entregasEm('FALHOU') },
      estoque: {
        valor: Math.round(produtos.reduce((soma, p) => soma + p.saldo * p.precoCusto, 0)),
        semEstoque: produtos.filter((p) => p.saldo <= 0).length,
        criticos: produtos
          .filter((p) => p.saldo <= p.estoqueMinimo)
          .sort((a, b) => a.saldo - b.saldo)
          .slice(0, 6)
          .map(({ precoCusto: _custo, ...p }) => p),
      },
      ultimosPedidos: ultimosPedidos.map((p) => ({
        id: p.id,
        cliente: p.cliente.nome,
        status: p.status,
        total: p.total,
        criadoEm: p.criadoEm,
      })),
    }
  })
}
