import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { dia, intervalo, prisma } from '../lib.js'
import { NATUREZAS } from './pedidos.js'

const periodo = { inicio: dia.optional(), fim: dia.optional(), busca: z.string().trim().optional() }

export async function rotasRelatorios(app: FastifyInstance) {
  app.get('/relatorios/vendas', async (req) => {
    const q = z
      .object({ ...periodo, status: z.enum(['ABERTO', 'FATURADO', 'CANCELADO']).optional(), natureza: z.enum(NATUREZAS).optional() })
      .parse(req.query)
    const numero = q.busca ? Number(q.busca.replace(/^#/, '')) : NaN
    const contem = { contains: q.busca, mode: 'insensitive' as const }
    const pedidos = await prisma.pedido.findMany({
      where: {
        data: intervalo(q.inicio, q.fim),
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
                ...(Number.isInteger(numero) ? [{ numero }] : []),
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
        devolucoes: { where: { estornada: false }, select: { valorCredito: true } },
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
        numero: p.numero,
        criadoEm: p.criadoEm,
        data: p.data,
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
        // Valor creditado ao cliente pelas devoluções da venda.
        devolvido: p.devolucoes.reduce((s, d) => s + d.valorCredito, 0),
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
        devolvido: validos.reduce((soma, l) => soma + l.devolvido, 0),
      },
    }
  })

  // Despesas pela competência, com os totais por elemento e por mês. Canceladas ficam de fora.
  app.get('/relatorios/despesas', async (req) => {
    const q = z.object({ ...periodo, elemento: z.string().trim().optional() }).parse(req.query)
    const contem = { contains: q.busca, mode: 'insensitive' as const }
    const despesas = await prisma.despesa.findMany({
      where: {
        status: 'ATIVA',
        dataCompetencia: intervalo(q.inicio, q.fim),
        ...(q.elemento ? { elemento: { equals: q.elemento, mode: 'insensitive' } } : {}),
        ...(q.busca ? { OR: [{ descricao: contem }, { elemento: contem }, { numeroDocumento: contem }, { fornecedor: { nome: contem } }] } : {}),
      },
      include: { fornecedor: { select: { nome: true } }, contasPagar: { where: { status: { not: 'CANCELADA' } }, select: { valorPago: true } } },
      orderBy: [{ dataCompetencia: 'asc' }, { id: 'asc' }],
      take: 5000,
    })
    const linhas = despesas.map((d) => ({
      id: d.id,
      competencia: d.dataCompetencia,
      emissao: d.dataEmissao,
      elemento: d.elemento,
      descricao: d.descricao,
      fornecedor: d.fornecedor.nome,
      numeroDocumento: d.numeroDocumento,
      condicaoPagamento: d.condicaoPagamento,
      formaPagamento: d.formaPagamento,
      valor: d.valor,
      pago: d.contasPagar.reduce((s, c) => s + c.valorPago, 0),
    }))
    // O mesmo elemento escrito com maiúsculas diferentes conta junto, com o nome da primeira ocorrência.
    const agrupar = (chave: (l: (typeof linhas)[number]) => string, nome: (l: (typeof linhas)[number]) => string) => {
      const mapa = new Map<string, { nome: string; quantidade: number; total: number; pago: number }>()
      for (const l of linhas) {
        const g = mapa.get(chave(l)) ?? { nome: nome(l), quantidade: 0, total: 0, pago: 0 }
        g.quantidade++
        g.total += l.valor
        g.pago += l.pago
        mapa.set(chave(l), g)
      }
      return [...mapa.values()]
    }
    const mes = (l: (typeof linhas)[number]) => `${l.competencia.getFullYear()}-${String(l.competencia.getMonth() + 1).padStart(2, '0')}`
    const total = linhas.reduce((s, l) => s + l.valor, 0)
    const pago = linhas.reduce((s, l) => s + l.pago, 0)
    return {
      linhas,
      porElemento: agrupar((l) => l.elemento.toLowerCase(), (l) => l.elemento).sort((a, b) => b.total - a.total),
      porCompetencia: agrupar(mes, mes).sort((a, b) => a.nome.localeCompare(b.nome)),
      resumo: { quantidade: linhas.length, total, pago, aPagar: total - pago },
    }
  })

  // Cobrança: contas a receber em aberto, com o contato do cliente e os dias de atraso, para cobrar.
  // `ate` limita o vencimento; `vencidas` deixa só as já vencidas.
  app.get('/relatorios/cobranca', async (req) => {
    const id = z.coerce.number().int().positive().optional()
    const q = z
      .object({
        ate: dia.optional(),
        vencidas: z.enum(['1', 'true']).optional(),
        pessoaId: id,
        vendedorId: id,
        medicoId: id,
        pacienteId: id,
      })
      .parse(req.query)
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const limite = q.vencidas ? hoje : q.ate ? intervalo(undefined, q.ate)!.lt : undefined
    const daVenda = {
      ...(q.vendedorId ? { vendedorId: q.vendedorId } : {}),
      ...(q.medicoId ? { medicoId: q.medicoId } : {}),
      ...(q.pacienteId ? { pacienteId: q.pacienteId } : {}),
    }
    const pessoa = { select: { id: true, nome: true } } as const
    const contas = await prisma.contaReceber.findMany({
      where: {
        status: 'ABERTA',
        ...(limite ? { vencimento: { lt: limite } } : {}),
        ...(q.pessoaId ? { pessoaId: q.pessoaId } : {}),
        ...(Object.keys(daVenda).length ? { pedido: daVenda } : {}),
      },
      include: {
        pessoa: { select: { id: true, nome: true, telefone: true, celular: true, email: true } },
        pedido: { select: { id: true, numero: true, vendedor: pessoa, medico: pessoa, paciente: pessoa } },
      },
      orderBy: [{ vencimento: 'asc' }, { id: 'asc' }],
      take: 5000,
    })
    const DIA = 24 * 60 * 60 * 1000
    const linhas = contas.map((c) => {
      const vencimento = new Date(c.vencimento)
      vencimento.setHours(0, 0, 0, 0)
      return {
        id: c.id,
        pessoaId: c.pessoa?.id ?? null,
        cliente: c.pessoa?.nome ?? 'Sem cliente',
        telefone: c.pessoa?.celular || c.pessoa?.telefone || null,
        email: c.pessoa?.email ?? null,
        descricao: c.descricao,
        pedidoId: c.pedido?.id ?? null,
        pedidoNumero: c.pedido?.numero ?? null,
        vendedor: c.pedido?.vendedor?.nome ?? null,
        medico: c.pedido?.medico?.nome ?? null,
        paciente: c.pedido?.paciente?.nome ?? null,
        vencimento: c.vencimento,
        diasAtraso: Math.max(0, Math.round((hoje.getTime() - vencimento.getTime()) / DIA)),
        valor: c.valor,
        valorPago: c.valorPago,
        saldo: c.valor - c.valorPago,
      }
    })
    // Um resumo por cliente, do maior saldo vencido para o menor.
    const mapa = new Map<string, { cliente: string; telefone: string | null; quantidade: number; saldo: number; vencido: number; maiorAtraso: number }>()
    for (const l of linhas) {
      const chave = String(l.pessoaId ?? 0)
      const g = mapa.get(chave) ?? { cliente: l.cliente, telefone: l.telefone, quantidade: 0, saldo: 0, vencido: 0, maiorAtraso: 0 }
      g.quantidade++
      g.saldo += l.saldo
      if (l.diasAtraso > 0) g.vencido += l.saldo
      g.maiorAtraso = Math.max(g.maiorAtraso, l.diasAtraso)
      mapa.set(chave, g)
    }
    const porCliente = [...mapa.values()].sort((a, b) => b.vencido - a.vencido || b.saldo - a.saldo)
    const saldo = linhas.reduce((s, l) => s + l.saldo, 0)
    const vencido = linhas.filter((l) => l.diasAtraso > 0).reduce((s, l) => s + l.saldo, 0)
    return { linhas, porCliente, resumo: { quantidade: linhas.length, clientes: porCliente.length, saldo, vencido, aVencer: saldo - vencido } }
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

  // Caixa e conciliação: os movimentos das contas financeiras no período, por conta, tipo e situação da
  // conciliação com o extrato do banco, com o título (conta a receber ou a pagar) de cada um.
  app.get('/relatorios/caixa', async (req) => {
    const q = z
      .object({
        ...periodo,
        contaFinanceiraId: z.coerce.number().int().positive().optional(),
        tipo: z.enum(['ENTRADA', 'SAIDA']).optional(),
        conciliacao: z.enum(['CONCILIADOS', 'PENDENTES']).optional(),
      })
      .parse(req.query)
    const contem = { contains: q.busca, mode: 'insensitive' as const }
    const movimentos = await prisma.movimentoFinanceiro.findMany({
      where: {
        data: intervalo(q.inicio, q.fim),
        ...(q.contaFinanceiraId ? { contaFinanceiraId: q.contaFinanceiraId } : {}),
        ...(q.tipo ? { tipo: q.tipo } : {}),
        ...(q.conciliacao ? { extratoId: q.conciliacao === 'CONCILIADOS' ? { not: null } : null } : {}),
        ...(q.busca ? { OR: [{ historico: contem }, { observacao: contem }] } : {}),
      },
      include: {
        contaFinanceira: { select: { nome: true } },
        contaReceber: { select: { descricao: true } },
        contaPagar: { select: { descricao: true } },
        usuario: { select: { nome: true } },
      },
      orderBy: [{ data: 'asc' }, { id: 'asc' }],
      take: 5000,
    })
    const linhas = movimentos.map((m) => ({
      id: m.id,
      data: m.data,
      comHora: m.comHora,
      conta: m.contaFinanceira.nome,
      tipo: m.tipo,
      origem: m.origem,
      historico: m.historico,
      observacao: m.observacao,
      valor: m.valor,
      conciliado: m.extratoId !== null,
      estornado: m.estornado,
      titulo: m.contaReceber?.descricao ?? m.contaPagar?.descricao ?? null,
      usuario: m.usuario?.nome ?? null,
    }))
    const soma = (tipo: string) => linhas.filter((l) => l.tipo === tipo).reduce((s, l) => s + l.valor, 0)
    return {
      linhas,
      resumo: {
        entradas: soma('ENTRADA'),
        saidas: soma('SAIDA'),
        saldo: soma('ENTRADA') - soma('SAIDA'),
        naoConciliados: linhas.filter((l) => !l.conciliado).length,
      },
    }
  })
}
