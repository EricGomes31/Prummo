import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, dataHora, dataIso, documentoValido, idParam, prisma, texto, type Transacao } from '../lib.js'

const corpo = z.object({
  pessoaId: z.number().int().positive().nullish(),
  descricao: z.string().trim().min(2, 'Informe a descrição').max(200),
  valor: z.number().int().positive('Informe um valor maior que zero'),
  vencimento: dataIso,
})

// Filtros das contas: situação, pessoa da conta, pessoas da venda de origem e período do vencimento.
const filtro = z.object({
  status: z.enum(['ABERTA', 'PAGA', 'CANCELADA']).optional(),
  pessoaId: z.coerce.number().int().positive().optional(),
  vendedorId: z.coerce.number().int().positive().optional(),
  medicoId: z.coerce.number().int().positive().optional(),
  pacienteId: z.coerce.number().int().positive().optional(),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').optional(),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').optional(),
})
// Sem valor, a baixa é do saldo inteiro. Sem conta financeira, vale a única conta ativa, se houver só uma.
const baixa = z.object({
  data: dataHora.optional(),
  valor: z.number().int().positive('Informe um valor maior que zero').optional(),
  contaFinanceiraId: z.number().int().positive().nullish(),
  observacao: texto.opcional,
})
const pessoa = { select: { id: true, nome: true } } as const

export const TIPOS_CONTA_FINANCEIRA = ['CAIXA', 'CONTA_CORRENTE', 'CONTA_POUPANCA', 'CARTEIRA_DIGITAL'] as const

const corpoContaFinanceira = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome da conta').max(80),
    tipo: z.enum(TIPOS_CONTA_FINANCEIRA).default('CONTA_CORRENTE'),
    instituicao: texto.opcional,
    codigoBanco: texto.opcional,
    agencia: texto.opcional,
    numeroConta: texto.opcional,
    documentoTitular: texto.digitos,
    // Pode ser negativo (conta que começa no cheque especial).
    saldoInicial: z.number().int().default(0),
    ativa: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    // Conta em banco ou carteira digital precisa do titular; o caixa da empresa não.
    if (d.tipo === 'CAIXA') return
    if (!d.documentoTitular) ctx.addIssue({ code: 'custom', path: ['documentoTitular'], message: 'Informe o CPF ou CNPJ do titular da conta' })
    else if (!documentoValido(d.documentoTitular)) ctx.addIssue({ code: 'custom', path: ['documentoTitular'], message: 'CPF ou CNPJ do titular inválido' })
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
  dados: {
    valor?: number
    data?: Date | { data: Date; comHora: boolean }
    contaFinanceiraId: number
    observacao?: string | null
    usuarioId: number
    extratoId?: number
  },
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

  const quando = dados.data instanceof Date ? { data: dados.data, comHora: false } : (dados.data ?? { data: new Date(), comHora: false })
  await tx.movimentoFinanceiro.create({
    data: {
      contaFinanceiraId: dados.contaFinanceiraId,
      tipo: lado.tipo,
      valor,
      data: quando.data,
      comHora: quando.comHora,
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
    data: { valorPago: conta.valorPago + valor, status: quitada ? 'PAGA' : 'ABERTA', pagoEm: quitada ? quando.data : null },
  })
  if (count === 0) throw new AppError(409, 'A conta mudou enquanto a baixa era registrada. Tente de novo.')
  return delegado.findUniqueOrThrow({ where: { id }, include: { pessoa } })
}

type Movimento = Awaited<ReturnType<Transacao['movimentoFinanceiro']['findUniqueOrThrow']>>

// Estorna um movimento: marca o original e lança o contrário na mesma conta. Se o movimento baixou uma
// conta a receber ou a pagar, a conta volta a ter o saldo. Não apaga nada.
export async function estornarMovimento(tx: Transacao, movimento: Movimento, usuarioId: number) {
  const { count } = await tx.movimentoFinanceiro.updateMany({ where: { id: movimento.id, estornado: false }, data: { estornado: true } })
  if (count === 0) throw new AppError(409, 'Este movimento já foi estornado.')
  await tx.movimentoFinanceiro.create({
    data: {
      contaFinanceiraId: movimento.contaFinanceiraId,
      tipo: movimento.tipo === 'ENTRADA' ? 'SAIDA' : 'ENTRADA',
      valor: movimento.valor,
      data: new Date(),
      origem: 'ESTORNO',
      historico: `Estorno: ${movimento.historico}`.slice(0, 200),
      contaReceberId: movimento.contaReceberId,
      contaPagarId: movimento.contaPagarId,
      transferencia: movimento.transferencia,
      usuarioId,
    },
  })
  for (const [chave, delegado] of [
    [movimento.contaReceberId, tx.contaReceber],
    [movimento.contaPagarId, tx.contaPagar as unknown as typeof tx.contaReceber],
  ] as const) {
    if (!chave) continue
    const conta = await delegado.findUniqueOrThrow({ where: { id: chave } })
    await delegado.update({
      where: { id: chave },
      data: { valorPago: conta.valorPago - movimento.valor, status: conta.status === 'CANCELADA' ? 'CANCELADA' : 'ABERTA', pagoEm: null },
    })
  }
}

// Transferência entre duas contas próprias: sai de uma e entra na outra, com o mesmo código nas duas pontas.
export async function transferir(
  tx: Transacao,
  dados: { origemId: number; destinoId: number; valor: number; data: Date; comHora?: boolean; historico?: string | null; usuarioId: number },
) {
  if (dados.origemId === dados.destinoId) throw new AppError(400, 'Escolha duas contas diferentes.')
  const contas = await tx.contaFinanceira.findMany({ where: { id: { in: [dados.origemId, dados.destinoId] } } })
  const origem = contas.find((c) => c.id === dados.origemId)
  const destino = contas.find((c) => c.id === dados.destinoId)
  if (!origem?.ativa || !destino?.ativa) throw new AppError(400, 'Selecione duas contas financeiras ativas.')
  const codigo = randomUUID()
  const comum = { valor: dados.valor, data: dados.data, comHora: dados.comHora ?? false, origem: 'TRANSFERENCIA', observacao: dados.historico ?? null, transferencia: codigo, usuarioId: dados.usuarioId }
  const saida = await tx.movimentoFinanceiro.create({
    data: { ...comum, contaFinanceiraId: origem.id, tipo: 'SAIDA', historico: `Transferência para ${destino.nome}` },
  })
  const entrada = await tx.movimentoFinanceiro.create({
    data: { ...comum, contaFinanceiraId: destino.id, tipo: 'ENTRADA', historico: `Transferência de ${origem.nome}` },
  })
  return { saida, entrada }
}

// As duas pontas de uma transferência, ou só o movimento, se não for transferência.
export async function comPar(tx: Transacao, movimento: Movimento) {
  if (!movimento.transferencia) return [movimento]
  return tx.movimentoFinanceiro.findMany({ where: { transferencia: movimento.transferencia, origem: 'TRANSFERENCIA' } })
}

const comConta = { contaFinanceira: { select: { id: true, nome: true } }, usuario: { select: { id: true, nome: true } } } as const

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
    const receber = caminho === 'contas-receber'

    app.get(`/${caminho}`, async (req) => {
      const q = filtro.parse(req.query)
      const fim = q.fim ? new Date(`${q.fim}T00:00:00`) : undefined
      fim?.setDate(fim.getDate() + 1)
      // Vendedor, médico e paciente são da venda que gerou a conta a receber.
      const daVenda = receber
        ? {
            ...(q.vendedorId ? { vendedorId: q.vendedorId } : {}),
            ...(q.medicoId ? { medicoId: q.medicoId } : {}),
            ...(q.pacienteId ? { pacienteId: q.pacienteId } : {}),
          }
        : {}
      return contas.findMany({
        where: {
          ...(q.status ? { status: q.status } : { status: { not: 'CANCELADA' } }),
          ...(q.pessoaId ? { pessoaId: q.pessoaId } : {}),
          ...(q.inicio || fim ? { vencimento: { ...(q.inicio ? { gte: new Date(`${q.inicio}T00:00:00`) } : {}), ...(fim ? { lt: fim } : {}) } } : {}),
          ...(Object.keys(daVenda).length ? { pedido: daVenda } : {}),
        },
        include: {
          pessoa,
          ...(receber ? { pedido: { select: { id: true, numero: true, vendedor: pessoa, medico: pessoa, paciente: pessoa } } } : {}),
        },
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

    // Uma conta com a origem dela, para a janela de baixa: a venda (a receber) ou a entrada de estoque ou a
    // despesa (a pagar), com as pessoas, o documento e as observações.
    app.get(`/${caminho}/:id`, async (req) => {
      const { id } = idParam.parse(req.params)
      const conta = receber
        ? await prisma.contaReceber.findUnique({
            where: { id },
            include: {
              pessoa,
              pedido: {
                select: { id: true, numero: true, data: true, natureza: true, formaPagamento: true, observacao: true, vendedor: pessoa, medico: pessoa, paciente: pessoa },
              },
            },
          })
        : await prisma.contaPagar.findUnique({
            where: { id },
            include: {
              pessoa,
              entrada: { select: { id: true, data: true, numeroDocumento: true, natureza: true } },
              despesa: { select: { id: true, elemento: true, descricao: true, numeroDocumento: true, dataEmissao: true, observacao: true } },
            },
          })
      if (!conta) throw new AppError(404, 'Conta não encontrada.')
      return conta
    })

    // Histórico de baixas e estornos da conta, do mais recente para o mais antigo.
    app.get(`/${caminho}/:id/baixas`, async (req) => {
      const { id } = idParam.parse(req.params)
      const movimentos = await prisma.movimentoFinanceiro.findMany({
        where: { [lado.chave]: id },
        include: comConta,
        orderBy: { id: 'desc' },
      })
      if (!receber) return movimentos
      // A baixa por crédito não passa por conta financeira, mas faz parte do histórico.
      const usos = await prisma.creditoUso.findMany({ where: { contaReceberId: id }, include: { usuario: pessoa } })
      const porCredito = usos.map((u) => ({
        id: -u.id,
        tipo: 'ENTRADA',
        valor: u.valor,
        data: u.criadoEm,
        comHora: true,
        origem: 'CREDITO',
        historico: `Baixa pelo crédito nº ${u.creditoId}`,
        observacao: null,
        estornado: u.estornado,
        contaFinanceira: { id: 0, nome: 'Crédito do cliente' },
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
    // A baixa conciliada com o extrato do banco se desfaz pela conciliação, para a linha voltar a ficar pendente.
    app.post(`/${caminho}/:id/estornar`, async (req) => {
      const { id } = idParam.parse(req.params)
      return prisma.$transaction(async (tx) => {
        const delegado = tx[receber ? 'contaReceber' : 'contaPagar'] as typeof tx.contaReceber
        const conta = await delegado.findUnique({ where: { id } })
        if (!conta) throw new AppError(404, 'Conta não encontrada.')
        const ultima = await tx.movimentoFinanceiro.findFirst({
          where: { [lado.chave]: id, origem: lado.origem, estornado: false },
          orderBy: { id: 'desc' },
        })
        if (conta.status !== 'CANCELADA' && !ultima && conta.valorPago > 0) {
          throw new AppError(409, 'O que resta baixado nesta conta veio de crédito do cliente. Estorne o uso do crédito em Devoluções e créditos.')
        }
        if (conta.status === 'CANCELADA' || !ultima) throw new AppError(409, 'A conta não está na situação esperada para esta operação.')
        if (ultima.extratoId) throw new AppError(409, 'Esta baixa foi conciliada com o extrato do banco. Desfaça a conciliação da linha para estorná-la.')
        await estornarMovimento(tx, ultima, req.usuario.id)
        return delegado.findUniqueOrThrow({ where: { id }, include: { pessoa } })
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
        include: comConta,
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

  // Lançamento avulso direto no extrato da conta, sem título: tarifa, rendimento, aporte, retirada...
  app.post('/movimentos-financeiros', async (req, reply) => {
    const dados = z
      .object({
        contaFinanceiraId: z.number().int().positive('Selecione a conta financeira'),
        tipo: z.enum(['ENTRADA', 'SAIDA'], 'Informe se é entrada ou saída'),
        valor: z.number().int().positive('Informe um valor maior que zero'),
        data: dataHora,
        historico: z.string().trim().min(2, 'Descreva o lançamento').max(200),
        observacao: texto.opcional,
      })
      .parse(req.body)
    const conta = await prisma.contaFinanceira.findUnique({ where: { id: dados.contaFinanceiraId } })
    if (!conta?.ativa) throw new AppError(400, 'Selecione uma conta financeira ativa.')
    const movimento = await prisma.movimentoFinanceiro.create({
      data: { ...dados, data: dados.data.data, comHora: dados.data.comHora, origem: 'AVULSO', usuarioId: req.usuario.id },
      include: comConta,
    })
    return reply.status(201).send(movimento)
  })

  // Transferência entre contas próprias.
  app.post('/transferencias', async (req, reply) => {
    const dados = z
      .object({
        origemId: z.number().int().positive('Selecione a conta de origem'),
        destinoId: z.number().int().positive('Selecione a conta de destino'),
        valor: z.number().int().positive('Informe um valor maior que zero'),
        data: dataHora,
        historico: texto.opcional,
      })
      .parse(req.body)
    const feita = await prisma.$transaction((tx) =>
      transferir(tx, { ...dados, data: dados.data.data, comHora: dados.data.comHora, usuarioId: req.usuario.id }),
    )
    return reply.status(201).send(feita)
  })

  // Estorna um lançamento avulso ou uma transferência (as duas pontas). O que já foi conciliado com o
  // extrato do banco se desfaz pela conciliação.
  app.post('/movimentos-financeiros/:id/estornar', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.$transaction(async (tx) => {
      const movimento = await tx.movimentoFinanceiro.findUnique({ where: { id } })
      if (!movimento) throw new AppError(404, 'Movimento não encontrado.')
      if (!['AVULSO', 'TRANSFERENCIA'].includes(movimento.origem)) {
        throw new AppError(409, 'Por aqui só se estornam lançamentos avulsos e transferências. Recebimentos e pagamentos se estornam pela conta.')
      }
      if (movimento.estornado) throw new AppError(409, 'Este movimento já foi estornado.')
      const pontas = await comPar(tx, movimento)
      if (pontas.some((m) => m.extratoId)) throw new AppError(409, 'O movimento está conciliado com o extrato do banco. Desfaça a conciliação primeiro.')
      for (const m of pontas) await estornarMovimento(tx, m, req.usuario.id)
      return { estornados: pontas.length }
    })
  })
}
