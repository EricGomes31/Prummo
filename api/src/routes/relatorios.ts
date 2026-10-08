import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib.js'
import { NATUREZAS } from './pedidos.js'

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
const periodo = { inicio: dia.optional(), fim: dia.optional(), busca: z.string().trim().optional() }

// Intervalo de datas com os dois dias incluídos por inteiro.
function intervalo(inicio?: string, fim?: string) {
  if (!inicio && !fim) return undefined
  const ate = fim ? new Date(`${fim}T00:00:00`) : undefined
  ate?.setDate(ate.getDate() + 1)
  return { ...(inicio ? { gte: new Date(`${inicio}T00:00:00`) } : {}), ...(ate ? { lt: ate } : {}) }
}

export async function rotasRelatorios(app: FastifyInstance) {
  app.get('/relatorios/vendas', async (req) => {
    const q = z
      .object({ ...periodo, status: z.enum(['ABERTO', 'FATURADO', 'CANCELADO']).optional(), natureza: z.enum(NATUREZAS).optional() })
      .parse(req.query)
    const numero = q.busca ? Number(q.busca.replace(/^#/, '')) : NaN
    const contem = { contains: q.busca, mode: 'insensitive' as const }
    const pedidos = await prisma.pedido.findMany({
      where: {
        criadoEm: intervalo(q.inicio, q.fim),
        ...(q.status ? { status: q.status } : {}),
        ...(q.natureza ? { natureza: q.natureza } : {}),
        ...(q.busca
          ? {
              OR: [
                { cliente: { nome: contem } },
                { vendedor: { nome: contem } },
                { medico: { nome: contem } },
                { paciente: { nome: contem } },
                { observacao: contem },
                ...(Number.isInteger(numero) ? [{ id: numero }] : []),
              ],
            }
          : {}),
      },
      include: {
        cliente: { select: { nome: true } },
        vendedor: { select: { nome: true } },
        medico: { select: { nome: true } },
        paciente: { select: { nome: true } },
        contasReceber: { where: { status: { not: 'CANCELADA' } }, select: { status: true, pagoEm: true } },
      },
      orderBy: { id: 'desc' },
      take: 2000,
    })

    const linhas = pedidos.map((p) => {
      // O pedido só tem data de pagamento quando todas as parcelas foram recebidas.
      const quitado = p.contasReceber.length > 0 && p.contasReceber.every((c) => c.status === 'PAGA')
      const pagoEm = quitado
        ? p.contasReceber.reduce<Date | null>((ultima, c) => (c.pagoEm && (!ultima || c.pagoEm > ultima) ? c.pagoEm : ultima), null)
        : null
      return {
        id: p.id,
        criadoEm: p.criadoEm,
        pagoEm,
        cliente: p.cliente.nome,
        natureza: p.natureza,
        vendedor: p.vendedor?.nome ?? null,
        medico: p.medico?.nome ?? null,
        paciente: p.paciente?.nome ?? null,
        status: p.status,
        formaPagamento: p.formaPagamento,
        frete: p.frete,
        observacao: p.observacao,
        total: p.total,
      }
    })
    // O valor total e o ticket médio consideram só as vendas; bonificações e perdas aparecem nas linhas.
    const validos = linhas.filter((l) => l.status !== 'CANCELADO' && l.natureza === 'VENDA')
    const total = validos.reduce((soma, l) => soma + l.total, 0)
    return {
      linhas,
      resumo: {
        quantidade: linhas.length,
        cancelados: linhas.length - validos.length,
        total,
        ticketMedio: validos.length ? Math.round(total / validos.length) : 0,
      },
    }
  })

  app.get('/relatorios/financeiro', async (req) => {
    const q = z
      .object({
        ...periodo,
        tipo: z.enum(['RECEBER', 'PAGAR']).optional(),
        status: z.enum(['ABERTA', 'PAGA', 'CANCELADA']).optional(),
      })
      .parse(req.query)
    const contem = { contains: q.busca, mode: 'insensitive' as const }
    const where = {
      vencimento: intervalo(q.inicio, q.fim),
      ...(q.status ? { status: q.status } : {}),
      ...(q.busca ? { OR: [{ descricao: contem }, { pessoa: { nome: contem } }] } : {}),
    }
    const opcoes = { where, include: { pessoa: { select: { nome: true } } }, take: 2000 } as const
    const [receber, pagar] = await Promise.all([
      q.tipo === 'PAGAR' ? [] : prisma.contaReceber.findMany(opcoes),
      q.tipo === 'RECEBER' ? [] : prisma.contaPagar.findMany(opcoes),
    ])

    const linha = (tipo: 'RECEBER' | 'PAGAR') => (c: (typeof receber)[number] | (typeof pagar)[number]) => ({
      chave: `${tipo}-${c.id}`,
      tipo,
      descricao: c.descricao,
      pessoa: c.pessoa?.nome ?? null,
      vencimento: c.vencimento,
      pagoEm: c.pagoEm,
      status: c.status,
      valor: c.valor,
      valorPago: c.valorPago,
    })
    const linhas = [...receber.map(linha('RECEBER')), ...pagar.map(linha('PAGAR'))].sort(
      (a, b) => a.vencimento.getTime() - b.vencimento.getTime(),
    )
    // Baixado é o que já entrou ou saiu, inclusive em parte; em aberto é o saldo das contas abertas.
    const doTipo = (tipo: string) => linhas.filter((l) => l.tipo === tipo && l.status !== 'CANCELADA')
    const baixado = (tipo: string) => doTipo(tipo).reduce((s, l) => s + l.valorPago, 0)
    const emAberto = (tipo: string) => doTipo(tipo).filter((l) => l.status === 'ABERTA').reduce((s, l) => s + l.valor - l.valorPago, 0)
    return {
      linhas,
      resumo: {
        quantidade: linhas.length,
        recebido: baixado('RECEBER'),
        aReceber: emAberto('RECEBER'),
        pago: baixado('PAGAR'),
        aPagar: emAberto('PAGAR'),
      },
    }
  })
}
