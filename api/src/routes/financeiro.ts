import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, dataIso, idParam, prisma, texto, type Transacao } from '../lib.js'

const corpo = z.object({
  pessoaId: z.number().int().positive().nullish(),
  descricao: z.string().trim().min(2, 'Informe a descrição').max(200),
  valor: z.number().int().positive('Informe um valor maior que zero'),
  vencimento: dataIso,
})

const filtro = z.object({ status: z.enum(['ABERTA', 'PAGA', 'CANCELADA']).optional() })
// Sem valor, a baixa é do saldo inteiro. Sem conta financeira, vale a única conta ativa, se houver só uma.
const baixa = z.object({
  data: dataIso.optional(),
  valor: z.number().int().positive('Informe um valor maior que zero').optional(),
  contaFinanceiraId: z.number().int().positive().nullish(),
  observacao: texto.opcional,
})
const pessoa = { select: { id: true, nome: true } } as const

export const TIPOS_CONTA_FINANCEIRA = ['CAIXA', 'CONTA_CORRENTE', 'CONTA_POUPANCA', 'CARTEIRA_DIGITAL'] as const

const corpoContaFinanceira = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da conta').max(80),
  tipo: z.enum(TIPOS_CONTA_FINANCEIRA).default('CONTA_CORRENTE'),
  instituicao: texto.opcional,
  codigoBanco: texto.opcional,
  agencia: texto.opcional,
  numeroConta: texto.opcional,
  documentoTitular: texto.opcional,
  // Pode ser negativo (conta que começa no cheque especial).
  saldoInicial: z.number().int().default(0),
  ativa: z.boolean().default(true),
})

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

// Os dois lados do financeiro têm o mesmo ciclo; muda só o sentido do dinheiro.
const lados = {
  'contas-receber': { chave: 'contaReceberId', tipo: 'ENTRADA', origem: 'RECEBIMENTO', verbo: 'Recebimento', contrario: 'SAIDA' },
  'contas-pagar': { chave: 'contaPagarId', tipo: 'SAIDA', origem: 'PAGAMENTO', verbo: 'Pagamento', contrario: 'ENTRADA' },
} as const

export type LadoFinanceiro = keyof typeof lados

// Baixa uma conta a receber ou a pagar, no todo ou em parte, e lança o movimento na conta financeira.
// Sem valor, baixa o saldo inteiro. `extratoId` liga o movimento à linha do extrato do banco (conciliação).
export async function registrarBaixa(
  tx: Transacao,
  caminho: LadoFinanceiro,
  id: number,
  dados: { valor?: number; data?: Date; contaFinanceiraId: number; observacao?: string | null; usuarioId: number; extratoId?: number },
) {
  const lado = lados[caminho]
  const delegado = tx[caminho === 'contas-receber' ? 'contaReceber' : 'contaPagar'] as typeof tx.contaReceber
  const conta = await delegado.findUnique({ where: { id } })
  if (!conta) throw new AppError(404, 'Conta não encontrada.')
  if (conta.status !== 'ABERTA') throw new AppError(409, 'A conta não está na situação esperada para esta operação.')
  const saldo = conta.valor - conta.valorPago
  const valor = dados.valor ?? saldo
  if (valor > saldo) throw new AppError(400, 'O valor não pode ser maior que o saldo da conta.')

  const contaFinanceira = await tx.contaFinanceira.findUnique({ where: { id: dados.contaFinanceiraId } })
  if (!contaFinanceira?.ativa) throw new AppError(400, 'Selecione uma conta financeira ativa.')

  const data = dados.data ?? new Date()
  await tx.movimentoFinanceiro.create({
    data: {
      contaFinanceiraId: dados.contaFinanceiraId,
      tipo: lado.tipo,
      valor,
      data,
      origem: lado.origem,
      historico: `${lado.verbo}: ${conta.descricao}`,
      observacao: dados.observacao ?? null,
      [lado.chave]: id,
      usuarioId: dados.usuarioId,
      extratoId: dados.extratoId ?? null,
    },
  })
  const quitada = valor === saldo
  // A condição no status evita duas baixas simultâneas passarem do saldo.
  const { count } = await delegado.updateMany({
    where: { id, status: 'ABERTA', valorPago: conta.valorPago },
    data: { valorPago: conta.valorPago + valor, status: quitada ? 'PAGA' : 'ABERTA', pagoEm: quitada ? data : null },
  })
  if (count === 0) throw new AppError(409, 'A conta mudou enquanto a baixa era registrada. Tente de novo.')
  return delegado.findUniqueOrThrow({ where: { id }, include: { pessoa } })
}

export async function rotasFinanceiro(app: FastifyInstance) {
  const modelos = {
    'contas-receber': prisma.contaReceber,
    'contas-pagar': prisma.contaPagar,
  } as const

  // Contas a receber e a pagar: lançar, baixar (no todo ou em parte), estornar a última baixa, cancelar.
  for (const [caminho, modelo] of Object.entries(modelos)) {
    // Os dois delegates têm a mesma forma para os campos usados aqui.
    const contas = modelo as typeof prisma.contaReceber
    const lado = lados[caminho as keyof typeof lados]

    app.get(`/${caminho}`, async (req) => {
      const q = filtro.parse(req.query)
      return contas.findMany({
        where: q.status ? { status: q.status } : { status: { not: 'CANCELADA' } },
        include: { pessoa },
        orderBy: [{ vencimento: 'asc' }, { id: 'asc' }],
        take: 500,
      })
    })

    app.post(`/${caminho}`, async (req, reply) => {
      const dados = corpo.parse(req.body)
      const conta = await contas.create({
        data: { ...dados, pessoaId: dados.pessoaId ?? null },
        include: { pessoa },
      })
      return reply.status(201).send(conta)
    })

    // Histórico de baixas e estornos da conta, do mais recente para o mais antigo.
    app.get(`/${caminho}/:id/baixas`, async (req) => {
      const { id } = idParam.parse(req.params)
      const movimentos = await prisma.movimentoFinanceiro.findMany({
        where: { [lado.chave]: id },
        include: { contaFinanceira: { select: { id: true, nome: true } }, usuario: { select: { id: true, nome: true } } },
        orderBy: { id: 'desc' },
      })
      if (caminho !== 'contas-receber') return movimentos
      // A baixa por crédito de devolução não passa por conta financeira, mas faz parte do histórico.
      const usos = await prisma.creditoUso.findMany({ where: { contaReceberId: id }, include: { usuario: { select: { id: true, nome: true } } } })
      const porCredito = usos.map((u) => ({
        id: -u.id,
        tipo: 'ENTRADA',
        valor: u.valor,
        data: u.criadoEm,
        origem: 'CREDITO',
        historico: `Baixa pelo crédito nº ${u.creditoId}`,
        observacao: null,
        estornado: false,
        contaFinanceira: { id: 0, nome: 'Crédito de devolução' },
        usuario: u.usuario,
        criadoEm: u.criadoEm,
      }))
      return [...movimentos, ...porCredito].sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
    })

    app.post(`/${caminho}/:id/baixar`, async (req) => {
      const { id } = idParam.parse(req.params)
      const dados = baixa.parse(req.body ?? {})
      return prisma.$transaction(async (tx) => {
        const ativas = await tx.contaFinanceira.findMany({ where: { ativa: true }, select: { id: true }, take: 2 })
        const contaFinanceiraId = dados.contaFinanceiraId ?? (ativas.length === 1 ? ativas[0].id : null)
        if (!contaFinanceiraId) throw new AppError(400, 'Selecione a conta financeira.')
        return registrarBaixa(tx, caminho as LadoFinanceiro, id, { ...dados, contaFinanceiraId, usuarioId: req.usuario.id })
      })
    })

    // Estorna a baixa mais recente: a conta volta a ter saldo e o extrato ganha o movimento contrário.
    app.post(`/${caminho}/:id/estornar`, async (req) => {
      const { id } = idParam.parse(req.params)
      return prisma.$transaction(async (tx) => {
        const delegado = tx[caminho === 'contas-receber' ? 'contaReceber' : 'contaPagar'] as typeof tx.contaReceber
        const conta = await delegado.findUnique({ where: { id } })
        if (!conta) throw new AppError(404, 'Conta não encontrada.')
        const ultima = await tx.movimentoFinanceiro.findFirst({
          where: { [lado.chave]: id, origem: lado.origem, estornado: false },
          orderBy: { id: 'desc' },
        })
        if (conta.status !== 'CANCELADA' && !ultima && conta.valorPago > 0) {
          throw new AppError(409, 'O que resta baixado nesta conta veio de crédito de devolução e não pode ser estornado por aqui.')
        }
        if (conta.status === 'CANCELADA' || !ultima) throw new AppError(409, 'A conta não está na situação esperada para esta operação.')
        await tx.movimentoFinanceiro.update({ where: { id: ultima.id }, data: { estornado: true } })
        await tx.movimentoFinanceiro.create({
          data: {
            contaFinanceiraId: ultima.contaFinanceiraId,
            tipo: lado.contrario,
            valor: ultima.valor,
            data: new Date(),
            origem: 'ESTORNO',
            historico: `Estorno de ${lado.verbo.toLowerCase()}: ${conta.descricao}`,
            [lado.chave]: id,
            usuarioId: req.usuario.id,
          },
        })
        return delegado.update({
          where: { id },
          data: { valorPago: conta.valorPago - ultima.valor, status: 'ABERTA', pagoEm: null },
          include: { pessoa },
        })
      })
    })

    app.post(`/${caminho}/:id/cancelar`, async (req) => {
      const { id } = idParam.parse(req.params)
      const { count } = await contas.updateMany({ where: { id, status: 'ABERTA', valorPago: 0 }, data: { status: 'CANCELADA' } })
      if (count === 0) {
        const conta = await contas.findUnique({ where: { id } })
        throw new AppError(
          409,
          conta?.status === 'ABERTA' ? 'A conta tem baixas parciais. Estorne-as antes de cancelar.' : 'A conta não está na situação esperada para esta operação.',
        )
      }
      return contas.findUniqueOrThrow({ where: { id }, include: { pessoa } })
    })
  }

  // Caixa e bancos: contas financeiras com o saldo atual (saldo inicial + entradas - saídas).
  app.get('/contas-financeiras', async () => {
    const [contas, somas] = await Promise.all([
      prisma.contaFinanceira.findMany({ orderBy: { nome: 'asc' } }),
      prisma.movimentoFinanceiro.groupBy({ by: ['contaFinanceiraId', 'tipo'], _sum: { valor: true } }),
    ])
    const soma = (contaId: number, tipo: string) => somas.find((s) => s.contaFinanceiraId === contaId && s.tipo === tipo)?._sum.valor ?? 0
    return contas.map((c) => ({ ...c, saldo: c.saldoInicial + soma(c.id, 'ENTRADA') - soma(c.id, 'SAIDA') }))
  })

  app.post('/contas-financeiras', async (req, reply) => {
    const conta = await prisma.contaFinanceira.create({ data: corpoContaFinanceira.parse(req.body) })
    return reply.status(201).send({ ...conta, saldo: conta.saldoInicial })
  })

  app.put('/contas-financeiras/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.contaFinanceira.update({ where: { id }, data: corpoContaFinanceira.parse(req.body) })
  })

  // Extrato: movimentos do período, com o saldo antes dele e os totais.
  app.get('/movimentos-financeiros', async (req) => {
    const q = z
      .object({
        contaFinanceiraId: z.coerce.number().int().positive().optional(),
        tipo: z.enum(['ENTRADA', 'SAIDA']).optional(),
        inicio: dia.optional(),
        fim: dia.optional(),
      })
      .parse(req.query)
    const inicio = q.inicio ? new Date(`${q.inicio}T00:00:00`) : undefined
    const fim = q.fim ? new Date(`${q.fim}T00:00:00`) : undefined
    fim?.setDate(fim.getDate() + 1)
    const daConta = q.contaFinanceiraId ? { contaFinanceiraId: q.contaFinanceiraId } : {}

    const [contas, anteriores, linhas] = await Promise.all([
      prisma.contaFinanceira.findMany({ where: q.contaFinanceiraId ? { id: q.contaFinanceiraId } : {}, select: { saldoInicial: true } }),
      inicio
        ? prisma.movimentoFinanceiro.groupBy({ by: ['tipo'], where: { ...daConta, data: { lt: inicio } }, _sum: { valor: true } })
        : [],
      prisma.movimentoFinanceiro.findMany({
        where: {
          ...daConta,
          ...(q.tipo ? { tipo: q.tipo } : {}),
          ...(inicio || fim ? { data: { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lt: fim } : {}) } } : {}),
        },
        include: { contaFinanceira: { select: { id: true, nome: true } }, usuario: { select: { id: true, nome: true } } },
        orderBy: [{ data: 'desc' }, { id: 'desc' }],
        take: 1000,
      }),
    ])
    const antes = (tipo: string) => anteriores.find((a) => a.tipo === tipo)?._sum.valor ?? 0
    const saldoInicial = contas.reduce((s, c) => s + c.saldoInicial, 0) + antes('ENTRADA') - antes('SAIDA')
    const entradas = linhas.filter((l) => l.tipo === 'ENTRADA').reduce((s, l) => s + l.valor, 0)
    const saidas = linhas.filter((l) => l.tipo === 'SAIDA').reduce((s, l) => s + l.valor, 0)
    return { linhas, resumo: { saldoInicial, entradas, saidas, saldoFinal: saldoInicial + entradas - saidas } }
  })
}
