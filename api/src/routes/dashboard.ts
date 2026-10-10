import type { FastifyInstance } from 'fastify'
import { inicioDeHoje, prisma } from '../lib.js'

// Cada bloco do resumo só vem para quem pode ver a área de onde ele sai; os demais vêm vazios (null).
// Sem isso, um perfil só de vendas veria pelo Início os totais a receber e a pagar da empresa.
export async function rotasDashboard(app: FastifyInstance) {
  app.get('/dashboard/resumo', async (req) => {
    const pode = (p: string) => req.usuario.permissoes.includes(p)
    const ver = {
      vendas: pode('PEDIDOS_VISUALIZAR'),
      receber: pode('CONTAS_RECEBER_VISUALIZAR'),
      pagar: pode('CONTAS_PAGAR_VISUALIZAR'),
      estoque: pode('PRODUTOS_VISUALIZAR'),
      entregas: pode('LOGISTICA_VISUALIZAR'),
      pessoas: pode('PESSOAS_VISUALIZAR'),
    }
    const se = <T>(permitido: boolean, consulta: () => Promise<T>) => (permitido ? consulta() : Promise.resolve(null))
    const hoje = inicioDeHoje()
    const [faturados, devolvido, abertos, receber, receberVencidas, pagar, pagarVencidas, cadastros, ultimosPedidos, entregas] =
      await Promise.all([
        se(ver.vendas, () => prisma.pedido.aggregate({ where: { status: 'FATURADO', natureza: 'VENDA' }, _count: true, _sum: { total: true } })),
        // As devoluções abatem o total vendido.
        se(ver.vendas, () => prisma.devolucao.aggregate({ where: { estornada: false }, _sum: { valorCredito: true } })),
        se(ver.vendas, () => prisma.pedido.count({ where: { status: 'ABERTO' } })),
        se(ver.receber, () => prisma.contaReceber.aggregate({ where: { status: 'ABERTA' }, _sum: { valor: true, valorPago: true } })),
        se(ver.receber, () => prisma.contaReceber.count({ where: { status: 'ABERTA', vencimento: { lt: hoje } } })),
        se(ver.pagar, () => prisma.contaPagar.aggregate({ where: { status: 'ABERTA' }, _sum: { valor: true, valorPago: true } })),
        se(ver.pagar, () => prisma.contaPagar.count({ where: { status: 'ABERTA', vencimento: { lt: hoje } } })),
        se(ver.estoque, () =>
          prisma.produto.findMany({
            where: { ativo: true, controlaEstoque: true },
            select: { id: true, sku: true, nome: true, unidade: true, saldo: true, divisor: true, estoqueMinimo: true, precoCusto: true },
          }),
        ),
        se(ver.vendas, () =>
          prisma.pedido.findMany({
            include: { cliente: { select: { nome: true } } },
            orderBy: { id: 'desc' },
            take: 5,
          }),
        ),
        se(ver.entregas, () =>
          prisma.entrega.groupBy({
            by: ['status'],
            where: { status: { in: ['PENDENTE', 'EM_ROTA', 'FALHOU'] } },
            _count: true,
          }),
        ),
      ])
    const entregasEm = (status: string) => entregas?.find((e) => e.status === status)?._count ?? 0
    // Avisos dos links públicos: rotas cujo link o entregador abriu nas últimas 24 horas e pessoas que
    // atualizaram o próprio cadastro nos últimos 7 dias.
    const horasAtras = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000)
    const [linksAbertos, cadastrosAtualizados] = await Promise.all([
      ver.entregas
        ? prisma.rota.findMany({ where: { linkAbertoEm: { gte: horasAtras(24) } }, select: { id: true, nome: true, linkAbertoEm: true }, orderBy: { linkAbertoEm: 'desc' }, take: 5 })
        : [],
      ver.pessoas
        ? prisma.pessoa.findMany({ where: { cadastroAtualizadoEm: { gte: horasAtras(7 * 24) } }, select: { id: true, nome: true, cadastroAtualizadoEm: true }, orderBy: { cadastroAtualizadoEm: 'desc' }, take: 5 })
        : [],
    ])
    // O saldo é guardado em partes; aqui passa para a unidade base, que é a do custo e do estoque mínimo.
    const produtos = (cadastros ?? []).map(({ divisor, ...p }) => ({ ...p, saldo: p.saldo / divisor }))

    // Em aberto é o saldo: o valor da conta menos o que já foi baixado em parte.
    const aReceber = receber ? (receber._sum.valor ?? 0) - (receber._sum.valorPago ?? 0) : null
    const aPagar = pagar ? (pagar._sum.valor ?? 0) - (pagar._sum.valorPago ?? 0) : null
    return {
      vendas: faturados && devolvido
        ? { quantidade: faturados._count, total: (faturados._sum.total ?? 0) - (devolvido._sum.valorCredito ?? 0), pedidosAbertos: abertos ?? 0 }
        : null,
      receber: aReceber === null ? null : { total: aReceber, vencidas: receberVencidas ?? 0 },
      pagar: aPagar === null ? null : { total: aPagar, vencidas: pagarVencidas ?? 0 },
      saldoProjetado: aReceber === null || aPagar === null ? null : aReceber - aPagar,
      entregas: entregas ? { pendentes: entregasEm('PENDENTE'), emRota: entregasEm('EM_ROTA'), falhas: entregasEm('FALHOU') } : null,
      avisos: { linksAbertos, cadastrosAtualizados },
      estoque: cadastros && {
        valor: Math.round(produtos.reduce((soma, p) => soma + p.saldo * p.precoCusto, 0)),
        semEstoque: produtos.filter((p) => p.saldo <= 0).length,
        criticos: produtos
          .filter((p) => p.saldo <= p.estoqueMinimo)
          .sort((a, b) => a.saldo - b.saldo)
          .slice(0, 6)
          .map(({ precoCusto: _custo, ...p }) => p),
      },
      ultimosPedidos: (ultimosPedidos ?? []).map((p) => ({
        id: p.id,
        numero: p.numero,
        cliente: p.cliente.nome,
        status: p.status,
        total: p.total,
        criadoEm: p.criadoEm,
      })),
    }
  })
}
