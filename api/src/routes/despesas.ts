import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, dataIso, idParam, prisma, texto } from '../lib.js'
import { registrarBaixa } from './financeiro.js'

export const FORMAS_PAGAMENTO_DESPESA = ['DINHEIRO', 'PIX', 'TRANSFERENCIA', 'BOLETO', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'OUTRO'] as const

// O que pode ser corrigido depois do lançamento. Valor, condição e parcelas não mudam: para isso,
// cancela-se a despesa e lança-se outra.
const cadastro = z.object({
  fornecedorId: z.number().int().positive('Selecione o fornecedor'),
  elemento: z.string().trim().min(2, 'Informe o elemento da despesa').max(80),
  descricao: z.string().trim().min(2, 'Informe a descrição').max(200),
  numeroDocumento: texto.opcional,
  dataEmissao: dataIso,
  dataCompetencia: dataIso,
  formaPagamento: z.enum(FORMAS_PAGAMENTO_DESPESA, 'Selecione a forma de pagamento'),
  observacao: texto.opcional,
})

const lancamento = cadastro
  .extend({
    valor: z.number().int().positive('Informe um valor maior que zero'),
    condicaoPagamento: z.enum(['A_VISTA', 'A_PRAZO']).default('A_VISTA'),
    parcelas: z
      .array(z.object({ vencimento: dataIso, valor: z.number().int().positive('Informe o valor de todas as parcelas') }))
      .max(60)
      .default([]),
    // À vista, a despesa pode ser paga já no lançamento, saindo da conta financeira escolhida.
    pagamento: z
      .object({ contaFinanceiraId: z.number().int().positive('Selecione a conta financeira'), data: dataIso.optional() })
      .nullish(),
  })
  .superRefine((d, ctx) => {
    if (d.pagamento && d.condicaoPagamento !== 'A_VISTA') ctx.addIssue({ code: 'custom', message: 'Só a despesa à vista é paga no lançamento.' })
    if (d.condicaoPagamento !== 'A_PRAZO') return
    if (d.parcelas.length === 0) ctx.addIssue({ code: 'custom', message: 'Informe pelo menos uma parcela.' })
    else if (d.parcelas.reduce((s, p) => s + p.valor, 0) !== d.valor) {
      ctx.addIssue({ code: 'custom', message: 'A soma das parcelas deve ser igual ao valor total da despesa.' })
    }
  })

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
const pessoa = { select: { id: true, nome: true } } as const
const comDetalhes = {
  fornecedor: pessoa,
  usuario: pessoa,
  contasPagar: { select: { id: true, valor: true, valorPago: true, vencimento: true, status: true, pagoEm: true }, orderBy: { vencimento: 'asc' } },
} as const

// A despesa lista o que já foi pago e a data em que ficou quitada (a "data de caixa").
function comPagamento<D extends { contasPagar: { valorPago: number; status: string; pagoEm: Date | null }[] }>(despesa: D) {
  const validas = despesa.contasPagar.filter((c) => c.status !== 'CANCELADA')
  const quitada = validas.length > 0 && validas.every((c) => c.status === 'PAGA')
  return {
    ...despesa,
    valorPago: validas.reduce((s, c) => s + c.valorPago, 0),
    dataCaixa: quitada ? validas.reduce<Date | null>((ultima, c) => (c.pagoEm && (!ultima || c.pagoEm > ultima) ? c.pagoEm : ultima), null) : null,
  }
}

// A despesa é de um fornecedor ou prestador de serviço do cadastro.
async function conferirFornecedor(id: number) {
  const fornecedor = await prisma.pessoa.findUnique({ where: { id } })
  if (!fornecedor || !(fornecedor.fornecedor || fornecedor.prestador)) throw new AppError(400, 'Selecione um fornecedor ou prestador de serviço do cadastro de pessoas.')
}

export async function rotasDespesas(app: FastifyInstance) {
  app.get('/despesas', async (req) => {
    const q = z
      .object({
        inicio: dia.optional(), // competência
        fim: dia.optional(),
        fornecedorId: z.coerce.number().int().positive().optional(),
        elemento: z.string().trim().optional(),
        status: z.enum(['ATIVA', 'CANCELADA']).optional(),
      })
      .parse(req.query)
    const inicio = q.inicio ? new Date(`${q.inicio}T00:00:00`) : undefined
    const fim = q.fim ? new Date(`${q.fim}T00:00:00`) : undefined
    fim?.setDate(fim.getDate() + 1)
    const despesas = await prisma.despesa.findMany({
      where: {
        status: q.status ?? 'ATIVA',
        ...(inicio || fim ? { dataCompetencia: { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lt: fim } : {}) } } : {}),
        ...(q.fornecedorId ? { fornecedorId: q.fornecedorId } : {}),
        ...(q.elemento ? { elemento: { equals: q.elemento, mode: 'insensitive' } } : {}),
      },
      include: comDetalhes,
      orderBy: [{ dataCompetencia: 'desc' }, { id: 'desc' }],
      take: 1000,
    })
    const linhas = despesas.map(comPagamento)
    return { linhas, resumo: { quantidade: linhas.length, total: linhas.reduce((s, d) => s + d.valor, 0), pago: linhas.reduce((s, d) => s + d.valorPago, 0) } }
  })

  // Elementos já usados, para sugerir no lançamento e filtrar a lista.
  app.get('/despesas/elementos', async () =>
    (await prisma.despesa.findMany({ distinct: ['elemento'], select: { elemento: true }, orderBy: { elemento: 'asc' } })).map((d) => d.elemento),
  )

  // Lançar a despesa gera as contas a pagar: uma, na data de emissão, se for à vista; uma por parcela, se for a prazo.
  // Com `pagamento`, a conta da despesa à vista já nasce paga.
  app.post('/despesas', async (req, reply) => {
    const { parcelas, pagamento, ...dados } = lancamento.parse(req.body)
    if (pagamento && !req.usuario.permissoes.includes('CONTAS_PAGAR_BAIXAR')) {
      throw new AppError(403, 'Seu perfil de acesso não permite registrar pagamentos. Lance a despesa sem pagar.')
    }
    await conferirFornecedor(dados.fornecedorId)
    const titulos = dados.condicaoPagamento === 'A_PRAZO' ? parcelas : [{ vencimento: dados.dataEmissao, valor: dados.valor }]
    const despesa = await prisma.$transaction(async (tx) => {
      const criada = await tx.despesa.create({ data: { ...dados, usuarioId: req.usuario.id } })
      for (const [n, titulo] of titulos.entries()) {
        const conta = await tx.contaPagar.create({
          data: {
            pessoaId: dados.fornecedorId,
            despesaId: criada.id,
            descricao: `Despesa nº ${criada.id} — ${dados.elemento}: ${dados.descricao}${titulos.length > 1 ? ` — parcela ${n + 1}/${titulos.length}` : ''}`.slice(0, 200),
            valor: titulo.valor,
            vencimento: titulo.vencimento,
          },
        })
        if (pagamento) {
          await registrarBaixa(tx, 'contas-pagar', conta.id, {
            contaFinanceiraId: pagamento.contaFinanceiraId,
            data: pagamento.data ?? new Date(),
            usuarioId: req.usuario.id,
          })
        }
      }
      return tx.despesa.findUniqueOrThrow({ where: { id: criada.id }, include: comDetalhes })
    })
    return reply.status(201).send(comPagamento(despesa))
  })

  app.put('/despesas/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = cadastro.parse(req.body)
    const atual = await prisma.despesa.findUnique({ where: { id } })
    if (!atual) throw new AppError(404, 'Despesa não encontrada.')
    if (atual.status !== 'ATIVA') throw new AppError(409, 'Despesa cancelada não pode ser alterada.')
    await conferirFornecedor(dados.fornecedorId)
    return prisma.$transaction(async (tx) => {
      // As contas a pagar acompanham o fornecedor da despesa.
      await tx.contaPagar.updateMany({ where: { despesaId: id }, data: { pessoaId: dados.fornecedorId } })
      return comPagamento(await tx.despesa.update({ where: { id }, data: dados, include: comDetalhes }))
    })
  })

  // Cancelar a despesa cancela as contas a pagar dela. Com pagamento registrado, é preciso estornar antes.
  app.post('/despesas/:id/cancelar', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.$transaction(async (tx) => {
      const despesa = await tx.despesa.findUnique({ where: { id }, include: comDetalhes })
      if (!despesa) throw new AppError(404, 'Despesa não encontrada.')
      if (despesa.status !== 'ATIVA') throw new AppError(409, 'Despesa já cancelada.')
      if (despesa.contasPagar.some((c) => c.valorPago > 0)) throw new AppError(409, 'Há pagamentos registrados nesta despesa. Estorne-os antes de cancelar.')
      await tx.contaPagar.updateMany({ where: { despesaId: id, status: 'ABERTA' }, data: { status: 'CANCELADA' } })
      return comPagamento(await tx.despesa.update({ where: { id }, data: { status: 'CANCELADA' }, include: comDetalhes }))
    })
  })
}
