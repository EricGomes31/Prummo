import type { FastifyInstance } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { AppError, idParam, prisma, texto } from '../lib.js'
import { lerOfx } from '../ofx.js'
import { registrarBaixa } from './financeiro.js'

const TAMANHO_MAXIMO = 10 * 1024 * 1024
const arquivo = z.object({
  nome: z.string().trim().max(200).default('extrato.ofx'),
  conteudo: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Conteúdo do arquivo inválido'),
})
const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').replace(/^0+/, '')
const DIA = 24 * 60 * 60 * 1000
const pessoa = { select: { id: true, nome: true } } as const

function abrir(dados: z.infer<typeof arquivo>) {
  const bytes = Buffer.from(dados.conteudo, 'base64')
  if (bytes.length > TAMANHO_MAXIMO) throw new AppError(400, 'O arquivo OFX deve ter no máximo 10 MB.')
  return lerOfx(bytes)
}

// Sem acento e em minúsculas, para comparar nomes com a descrição do banco.
const simples = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type Linha = { id: number; contaFinanceiraId: number; data: Date; tipo: string; valor: number; descricao: string }
type Titulo = { id: number; descricao: string; valor: number; valorPago: number; vencimento: Date; pessoa: { id: number; nome: string } | null }
type Movimento = { id: number; contaFinanceiraId: number; tipo: string; valor: number; data: Date; historico: string }
export type Sugestao = {
  acao: 'BAIXA' | 'VINCULO' | 'CREDITO'
  tipo: 'CONTA_RECEBER' | 'CONTA_PAGAR' | null
  contaId: number | null
  movimentoId: number | null
  descricao: string
  pessoa: string | null
  vencimento: Date | null
  saldo: number | null
  pontuacao: number
}

// Sugestões para uma linha do extrato, da mais provável para a menos. A pontuação soma: valor igual ao
// saldo do título (60) ou menor (25), vencimento perto da data (até 20) e nome da pessoa na descrição (20).
// Um movimento já lançado com o mesmo valor, na mesma conta e em data próxima vale 90 ou mais.
function sugerir(linha: Linha, receber: Titulo[], pagar: Titulo[], soltos: Movimento[]): Sugestao[] {
  const entrada = linha.tipo === 'ENTRADA'
  const descricao = simples(linha.descricao)
  const sugestoes: Sugestao[] = []

  for (const m of soltos) {
    const dias = Math.abs(m.data.getTime() - linha.data.getTime()) / DIA
    if (m.contaFinanceiraId !== linha.contaFinanceiraId || m.tipo !== linha.tipo || m.valor !== linha.valor || dias > 5) continue
    sugestoes.push({ acao: 'VINCULO', tipo: null, contaId: null, movimentoId: m.id, descricao: m.historico, pessoa: null, vencimento: m.data, saldo: m.valor, pontuacao: dias < 1 ? 95 : 90 })
  }

  for (const t of entrada ? receber : pagar) {
    const saldo = t.valor - t.valorPago
    let pontos = linha.valor === saldo ? 60 : linha.valor < saldo ? 25 : entrada ? 15 : 0
    if (pontos === 0) continue
    const dias = Math.abs(t.vencimento.getTime() - linha.data.getTime()) / DIA
    pontos += dias <= 3 ? 20 : dias <= 10 ? 10 : 0
    const nomes = simples(t.pessoa?.nome ?? '').split(/\s+/).filter((p) => p.length >= 4)
    if (nomes.some((n) => descricao.includes(n))) pontos += 20
    // Valor diferente do saldo só vira sugestão com a data e o nome batendo; valor igual já basta.
    if (pontos < 50) continue
    sugestoes.push({
      acao: linha.valor > saldo ? 'CREDITO' : 'BAIXA',
      tipo: entrada ? 'CONTA_RECEBER' : 'CONTA_PAGAR',
      contaId: t.id,
      movimentoId: null,
      descricao: t.descricao,
      pessoa: t.pessoa?.nome ?? null,
      vencimento: t.vencimento,
      saldo,
      pontuacao: pontos,
    })
  }
  return sugestoes.sort((a, b) => b.pontuacao - a.pontuacao).slice(0, 3)
}

// O que é preciso para sugerir: títulos em aberto e movimentos ainda não ligados a nenhuma linha do extrato.
async function contexto(db: Prisma.TransactionClient | typeof prisma) {
  const aberta = { where: { status: 'ABERTA' }, include: { pessoa }, take: 2000 } as const
  const [receber, pagar, soltos] = await Promise.all([
    db.contaReceber.findMany(aberta),
    db.contaPagar.findMany(aberta),
    db.movimentoFinanceiro.findMany({ where: { extratoId: null, estornado: false, origem: { not: 'ESTORNO' } }, orderBy: { id: 'desc' }, take: 2000 }),
  ])
  return { receber, pagar, soltos }
}

// Marca a linha como resolvida. A condição no status impede que ela seja conciliada duas vezes.
async function concluir(tx: Prisma.TransactionClient, id: number, usuarioId: number, resolucao: string | null, status = 'CONCILIADA', observacao?: string | null) {
  const { count } = await tx.extratoBancario.updateMany({
    where: { id, status: 'PENDENTE' },
    data: { status, resolucao, observacao: observacao ?? null, conciliadoEm: new Date(), usuarioId },
  })
  if (count === 0) throw new AppError(409, 'Esta linha do extrato já foi resolvida.')
}

async function linhaPendente(tx: Prisma.TransactionClient, id: number) {
  const linha = await tx.extratoBancario.findUnique({ where: { id } })
  if (!linha) throw new AppError(404, 'Linha do extrato não encontrada.')
  if (linha.status !== 'PENDENTE') throw new AppError(409, 'Esta linha do extrato já foi resolvida.')
  return linha
}

// Baixa o título pelo valor da linha, na conta e na data do extrato.
async function conciliarComTitulo(tx: Prisma.TransactionClient, linha: Awaited<ReturnType<typeof linhaPendente>>, tipo: 'CONTA_RECEBER' | 'CONTA_PAGAR', contaId: number, usuarioId: number) {
  if ((tipo === 'CONTA_RECEBER') !== (linha.tipo === 'ENTRADA')) {
    throw new AppError(400, 'Entradas do extrato baixam contas a receber; saídas baixam contas a pagar.')
  }
  await concluir(tx, linha.id, usuarioId, 'BAIXA')
  await registrarBaixa(tx, tipo === 'CONTA_RECEBER' ? 'contas-receber' : 'contas-pagar', contaId, {
    valor: linha.valor,
    data: linha.data,
    contaFinanceiraId: linha.contaFinanceiraId,
    observacao: `Conciliado com o extrato: ${linha.descricao}`.slice(0, 200),
    usuarioId,
    extratoId: linha.id,
  })
}

// Liga a linha a um movimento que já estava lançado, sem baixar nada de novo.
async function vincular(tx: Prisma.TransactionClient, linha: Awaited<ReturnType<typeof linhaPendente>>, movimentoId: number, usuarioId: number) {
  const movimento = await tx.movimentoFinanceiro.findUnique({ where: { id: movimentoId } })
  if (!movimento || movimento.extratoId || movimento.estornado || movimento.origem === 'ESTORNO') throw new AppError(400, 'Este movimento não está disponível para vínculo.')
  if (movimento.contaFinanceiraId !== linha.contaFinanceiraId || movimento.tipo !== linha.tipo || movimento.valor !== linha.valor) {
    throw new AppError(400, 'O movimento precisa ser da mesma conta, do mesmo tipo e do mesmo valor da linha do extrato.')
  }
  await concluir(tx, linha.id, usuarioId, 'VINCULO')
  await tx.movimentoFinanceiro.update({ where: { id: movimentoId }, data: { extratoId: linha.id } })
}

const comMovimentos = {
  contaFinanceira: { select: { id: true, nome: true } },
  usuario: pessoa,
  movimentos: { select: { id: true, origem: true, historico: true, valor: true } },
} as const

export async function rotasConciliacao(app: FastifyInstance) {
  const corpoGrande = { bodyLimit: Math.ceil(TAMANHO_MAXIMO * 1.4) }

  // Mostra o que o arquivo traz, antes de gravar: transações, conta sugerida e o que já foi importado.
  app.post('/ofx/ler', corpoGrande, async (req) => {
    const extrato = abrir(arquivo.parse(req.body))
    const contas = await prisma.contaFinanceira.findMany({ where: { ativa: true } })
    const sugerida = extrato.conta ? contas.find((c) => digitos(c.numeroConta) !== '' && digitos(c.numeroConta) === digitos(extrato.conta)) : undefined
    const jaImportadas = sugerida
      ? new Set((await prisma.extratoBancario.findMany({ where: { contaFinanceiraId: sugerida.id, fitId: { in: extrato.transacoes.map((t) => t.fitId) } }, select: { fitId: true } })).map((e) => e.fitId))
      : new Set<string>()
    return {
      banco: extrato.banco,
      agencia: extrato.agencia,
      conta: extrato.conta,
      contaFinanceiraSugeridaId: sugerida?.id ?? null,
      transacoes: extrato.transacoes.map((t) => ({ ...t, duplicada: jaImportadas.has(t.fitId) })),
    }
  })

  // Grava as linhas do extrato na conta financeira. Linhas já importadas (mesmo identificador do banco) são ignoradas.
  app.post('/ofx/importar', corpoGrande, async (req) => {
    const dados = arquivo.extend({ contaFinanceiraId: z.number().int().positive('Selecione a conta financeira') }).parse(req.body)
    const extrato = abrir(dados)
    const conta = await prisma.contaFinanceira.findUnique({ where: { id: dados.contaFinanceiraId } })
    if (!conta?.ativa) throw new AppError(400, 'Selecione uma conta financeira ativa.')
    if (digitos(conta.numeroConta) && digitos(extrato.conta) && digitos(conta.numeroConta) !== digitos(extrato.conta)) {
      throw new AppError(400, `A conta financeira "${conta.nome}" não corresponde à conta ${extrato.conta} informada no OFX.`)
    }
    const { count } = await prisma.extratoBancario.createMany({
      data: extrato.transacoes.map((t) => ({ ...t, contaFinanceiraId: conta.id, arquivo: dados.nome, usuarioId: req.usuario.id })),
      skipDuplicates: true,
    })
    return { transacoes: extrato.transacoes.length, importadas: count, duplicadas: extrato.transacoes.length - count }
  })

  app.get('/conciliacao/pendentes', async (req) => {
    const q = z.object({ contaFinanceiraId: z.coerce.number().int().positive().optional() }).parse(req.query)
    const [linhas, ctx] = await Promise.all([
      prisma.extratoBancario.findMany({
        where: { status: 'PENDENTE', ...(q.contaFinanceiraId ? { contaFinanceiraId: q.contaFinanceiraId } : {}) },
        include: { contaFinanceira: { select: { id: true, nome: true } } },
        orderBy: [{ data: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
      contexto(prisma),
    ])
    return linhas.map((l) => ({ ...l, sugestoes: sugerir(l, ctx.receber, ctx.pagar, ctx.soltos) }))
  })

  app.get('/conciliacao/concluidas', async () =>
    prisma.extratoBancario.findMany({ where: { status: { not: 'PENDENTE' } }, include: comMovimentos, orderBy: [{ conciliadoEm: 'desc' }, { id: 'desc' }], take: 300 }),
  )

  app.post('/conciliacao/:id/baixar', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = z.object({ tipo: z.enum(['CONTA_RECEBER', 'CONTA_PAGAR']), contaId: z.number().int().positive() }).parse(req.body)
    return prisma.$transaction(async (tx) => {
      await conciliarComTitulo(tx, await linhaPendente(tx, id), dados.tipo, dados.contaId, req.usuario.id)
      return tx.extratoBancario.findUniqueOrThrow({ where: { id }, include: comMovimentos })
    })
  })

  app.post('/conciliacao/:id/vincular', async (req) => {
    const { id } = idParam.parse(req.params)
    const { movimentoId } = z.object({ movimentoId: z.number().int().positive() }).parse(req.body)
    return prisma.$transaction(async (tx) => {
      await vincular(tx, await linhaPendente(tx, id), movimentoId, req.usuario.id)
      return tx.extratoBancario.findUniqueOrThrow({ where: { id }, include: comMovimentos })
    })
  })

  // Lança no extrato da conta um movimento sem título, como tarifa bancária ou rendimento.
  app.post('/conciliacao/:id/avulso', async (req) => {
    const { id } = idParam.parse(req.params)
    const { historico } = z.object({ historico: z.string().trim().min(2, 'Descreva o lançamento').max(200) }).parse(req.body)
    return prisma.$transaction(async (tx) => {
      const linha = await linhaPendente(tx, id)
      await concluir(tx, id, req.usuario.id, 'AVULSO')
      await tx.movimentoFinanceiro.create({
        data: { contaFinanceiraId: linha.contaFinanceiraId, tipo: linha.tipo, valor: linha.valor, data: linha.data, origem: 'AVULSO', historico, observacao: linha.descricao, usuarioId: req.usuario.id, extratoId: id },
      })
      return tx.extratoBancario.findUniqueOrThrow({ where: { id }, include: comMovimentos })
    })
  })

  // Depósito a maior: quita a conta a receber, se houver, e o que sobra vira crédito do cliente.
  // Sem conta a receber, o depósito inteiro vira crédito.
  app.post('/conciliacao/:id/credito', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = z.object({ clienteId: z.number().int().positive('Selecione o cliente'), contaReceberId: z.number().int().positive().nullish() }).parse(req.body)
    return prisma.$transaction(async (tx) => {
      const linha = await linhaPendente(tx, id)
      if (linha.tipo !== 'ENTRADA') throw new AppError(400, 'Só entradas do extrato podem virar crédito de cliente.')
      const cliente = await tx.pessoa.findUnique({ where: { id: dados.clienteId } })
      if (!cliente) throw new AppError(400, 'Cliente não encontrado.')
      let excedente = linha.valor
      await concluir(tx, id, req.usuario.id, 'CREDITO')
      if (dados.contaReceberId) {
        const conta = await tx.contaReceber.findUnique({ where: { id: dados.contaReceberId } })
        if (!conta || conta.status !== 'ABERTA') throw new AppError(400, 'Selecione uma conta a receber em aberto.')
        if (conta.pessoaId !== dados.clienteId) throw new AppError(400, 'A conta a receber precisa ser do cliente escolhido.')
        const saldo = conta.valor - conta.valorPago
        if (linha.valor <= saldo) throw new AppError(400, 'O depósito precisa ser maior que o saldo da conta. Para valores iguais ou menores, use a baixa.')
        await registrarBaixa(tx, 'contas-receber', conta.id, {
          data: linha.data,
          contaFinanceiraId: linha.contaFinanceiraId,
          observacao: `Conciliado com o extrato: ${linha.descricao}`.slice(0, 200),
          usuarioId: req.usuario.id,
          extratoId: id,
        })
        excedente = linha.valor - saldo
      }
      await tx.movimentoFinanceiro.create({
        data: { contaFinanceiraId: linha.contaFinanceiraId, tipo: 'ENTRADA', valor: excedente, data: linha.data, origem: 'DEPOSITO', historico: `Depósito a maior de ${cliente.nome}`, observacao: linha.descricao, usuarioId: req.usuario.id, extratoId: id },
      })
      await tx.credito.create({ data: { pessoaId: cliente.id, valorOriginal: excedente, saldo: excedente } })
      return tx.extratoBancario.findUniqueOrThrow({ where: { id }, include: comMovimentos })
    })
  })

  // Deixa a linha de fora, sem mexer no saldo (transferência entre contas próprias, lançamento repetido...).
  app.post('/conciliacao/:id/ignorar', async (req) => {
    const { id } = idParam.parse(req.params)
    const { observacao } = z.object({ observacao: texto.opcional }).parse(req.body ?? {})
    return prisma.$transaction(async (tx) => {
      await concluir(tx, id, req.usuario.id, null, 'IGNORADA', observacao)
      return tx.extratoBancario.findUniqueOrThrow({ where: { id }, include: comMovimentos })
    })
  })

  app.post('/conciliacao/:id/reabrir', async (req) => {
    const { id } = idParam.parse(req.params)
    const { count } = await prisma.extratoBancario.updateMany({
      where: { id, status: 'IGNORADA' },
      data: { status: 'PENDENTE', resolucao: null, observacao: null, conciliadoEm: null, usuarioId: null },
    })
    if (count === 0) throw new AppError(409, 'Só linhas ignoradas podem ser reabertas. Uma baixa conciliada se desfaz pelo estorno da conta.')
    return prisma.extratoBancario.findUniqueOrThrow({ where: { id }, include: comMovimentos })
  })

  // Conciliação automática: resolve só as linhas com uma única sugestão forte (90 pontos ou mais),
  // isto é, valor igual com data e nome batendo, ou um movimento já lançado de mesmo valor.
  app.post('/conciliacao/automatica', async (req) => {
    const pendentes = await prisma.extratoBancario.findMany({ where: { status: 'PENDENTE' }, orderBy: [{ data: 'asc' }, { id: 'asc' }], take: 500 })
    let conciliadas = 0
    for (const linha of pendentes) {
      // O contexto é relido a cada linha: uma baixa muda os saldos que as próximas sugestões enxergam.
      const resolvida = await prisma.$transaction(async (tx) => {
        const ctx = await contexto(tx)
        const fortes = sugerir(linha, ctx.receber, ctx.pagar, ctx.soltos).filter((s) => s.pontuacao >= 90 && s.acao !== 'CREDITO')
        if (fortes.length !== 1) return false
        const [s] = fortes
        const atual = await linhaPendente(tx, linha.id)
        if (s.acao === 'VINCULO') await vincular(tx, atual, s.movimentoId!, req.usuario.id)
        else await conciliarComTitulo(tx, atual, s.tipo!, s.contaId!, req.usuario.id)
        return true
      })
      if (resolvida) conciliadas++
    }
    return { analisadas: pendentes.length, conciliadas }
  })
}
