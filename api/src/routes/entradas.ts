import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, centavos, dataIso, dia, idParam, intervalo, prisma, texto } from '../lib.js'
import { resolverUnidade } from './produtos.js'

export const NATUREZAS_ENTRADA = ['COMPRA_REVENDA', 'BONIFICACAO'] as const

const corpo = z
  .object({
    // Sem fornecedor só se aceita entrada sem conta a pagar (carga inicial de estoque, por exemplo).
    fornecedorId: z.number().int().positive().nullish(),
    natureza: z.enum(NATUREZAS_ENTRADA).default('COMPRA_REVENDA'),
    numeroDocumento: texto.opcional,
    data: dataIso,
    // Prazos das parcelas em dias a partir da data da entrada: "0" (à vista), "30", "30/60/90".
    condicaoPagamento: z
      .string()
      .trim()
      .regex(/^\d{1,3}(\/\d{1,3}){0,11}$/, 'Condição de pagamento inválida')
      .nullish(),
    // Parcelas com data e valor escolhidos à mão, no lugar dos prazos da condição.
    parcelas: z
      .array(z.object({ vencimento: dia, valor: z.number().int().positive('O valor de cada parcela deve ser maior que zero.') }))
      .min(1, 'Informe ao menos uma parcela.')
      .max(24, 'De 1 a 24 parcelas')
      .nullish(),
    frete: centavos.default(0),
    outrasDespesas: centavos.default(0),
    cfop: z
      .string()
      .trim()
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || /^\d{4}$/.test(v), 'O CFOP deve ter 4 dígitos'),
    itens: z
      .array(
        z.object({
          produtoId: z.number().int().positive(),
          // Unidade do lançamento; quantidade e custo são nela. Vazia = unidade base do produto.
          unidade: z.string().trim().max(6).nullish(),
          quantidade: z.number().int().positive('Quantidade deve ser maior que zero'),
          custoUnitario: centavos,
        }),
      )
      .min(1, 'Inclua ao menos um item'),
  })
  .superRefine((d, ctx) => {
    const erro = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (new Set(d.itens.map((i) => `${i.produtoId}:${i.unidade ?? ''}`)).size !== d.itens.length) {
      erro('O mesmo produto aparece em mais de um item na mesma unidade.')
    }
    const pagavel = d.condicaoPagamento || d.parcelas?.length
    if (pagavel && !d.fornecedorId) erro('Informe o fornecedor para gerar as contas a pagar.')
    if (pagavel && d.natureza === 'BONIFICACAO') erro('Bonificação não tem condição de pagamento.')
    if (d.condicaoPagamento && d.parcelas?.length) erro('Informe a condição ou as parcelas, não as duas.')
  })

// Quanto o custo de cada item cresce com o frete e as outras despesas da entrada: a parte de cada item é
// proporcional ao valor dele. Bonificação e entrada sem valor de itens não rateiam.
export function fatorDeRateio(e: { frete: number; outrasDespesas: number; totalItens: number; compra: boolean }) {
  return e.compra && e.totalItens > 0 ? (e.totalItens + e.frete + e.outrasDespesas) / e.totalItens : 1
}

const comDetalhes = {
  fornecedor: { select: { id: true, nome: true } },
  itens: { include: { produto: { select: { id: true, sku: true, nome: true, unidade: true } } } },
} as const

export async function rotasEntradas(app: FastifyInstance) {
  // Lista as mais recentes; a busca e o período procuram em todas as entradas.
  app.get('/entradas', async (req) => {
    const q = z.object({ busca: z.string().trim().optional(), inicio: dia.optional(), fim: dia.optional() }).parse(req.query)
    // "12" ou "#12" acha a entrada nº 12; o texto procura no fornecedor, no documento e nos produtos.
    const numero = q.busca ? Number(q.busca.replace(/^#/, '')) : NaN
    const contem = { contains: q.busca, mode: 'insensitive' as const }
    const where = {
      data: intervalo(q.inicio, q.fim),
      ...(q.busca
        ? {
            OR: [
              ...(Number.isInteger(numero) && numero > 0 ? [{ id: numero }] : []),
              { fornecedor: { nome: contem } },
              { fornecedor: { nomeFantasia: contem } },
              { numeroDocumento: contem },
              { itens: { some: { produto: { OR: [{ nome: contem }, { sku: contem }] } } } },
            ],
          }
        : {}),
    }
    const [entradas, anexos] = await Promise.all([
      prisma.entradaEstoque.findMany({ where, include: comDetalhes, orderBy: { id: 'desc' }, take: 200 }),
      prisma.documento.groupBy({ by: ['origemId'], where: { origem: 'ENTRADA_ESTOQUE' }, _count: true }),
    ])
    const quantos = new Map(anexos.map((a) => [a.origemId, a._count]))
    return entradas.map((e) => ({ ...e, documentos: quantos.get(e.id) ?? 0 }))
  })

  app.post('/entradas', async (req, reply) => {
    const dados = corpo.parse(req.body)
    const totalItens = dados.itens.reduce((soma, i) => soma + i.quantidade * i.custoUnitario, 0)
    const total = totalItens + dados.frete + dados.outrasDespesas
    const compra = dados.natureza === 'COMPRA_REVENDA'
    // Frete e outras despesas entram no custo dos produtos, rateados pelo valor de cada item.
    const rateio = fatorDeRateio({ ...dados, totalItens, compra })
    // Parcelas à mão: em ordem de data, precisam fechar o total. A condição gravada (o que a lista mostra)
    // são os dias de cada vencimento contados da data da entrada.
    const parcelas = dados.parcelas?.length ? [...dados.parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento)) : null
    if (parcelas) {
      const soma = parcelas.reduce((s, p) => s + p.valor, 0)
      const reais = (v: number) => (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      if (soma !== total) throw new AppError(400, `As parcelas somam ${reais(soma)}; o total da entrada é ${reais(total)}. Ajuste os valores das parcelas.`)
    }
    const dias = (vencimento: string) => Math.max(0, Math.round((new Date(`${vencimento}T12:00:00`).getTime() - dados.data.getTime()) / 864e5))
    const condicaoPagamento = parcelas ? parcelas.map((p) => dias(p.vencimento)).join('/') : (dados.condicaoPagamento ?? null)

    const entrada = await prisma.$transaction(async (tx) => {
      // Confere os produtos e descobre o fator da unidade de cada lançamento antes de gravar.
      const itens = []
      for (const item of dados.itens) {
        const produto = await tx.produto.findUnique({ where: { id: item.produtoId }, include: { unidades: true } })
        if (!produto) throw new AppError(400, `Produto ${item.produtoId} não encontrado.`)
        if (!produto.controlaEstoque) throw new AppError(400, `"${produto.nome}" não controla estoque e não aceita entrada.`)
        const unidade = resolverUnidade(produto, item.unidade)
        itens.push({ ...item, unidade: unidade.sigla, fator: unidade.fator, divisor: produto.divisor })
      }

      const criada = await tx.entradaEstoque.create({
        data: {
          fornecedorId: dados.fornecedorId ?? null,
          natureza: dados.natureza,
          numeroDocumento: dados.numeroDocumento,
          data: dados.data,
          condicaoPagamento,
          frete: dados.frete,
          outrasDespesas: dados.outrasDespesas,
          cfop: dados.cfop,
          total,
          itens: { create: itens.map(({ divisor: _divisor, ...item }) => item) },
        },
      })
      for (const item of itens) {
        // O saldo anda em partes e o custo do produto é sempre por unidade base.
        const partes = (item.quantidade * item.divisor) / item.fator
        const produto = await tx.produto.update({
          where: { id: item.produtoId },
          // Mercadoria bonificada entra no saldo sem mexer no custo do produto.
          data: { saldo: { increment: partes }, ...(compra ? { precoCusto: Math.round(item.custoUnitario * item.fator * rateio) } : {}) },
        })
        await tx.movimentoEstoque.create({
          data: {
            produtoId: item.produtoId,
            tipo: 'ENTRADA',
            quantidade: partes,
            saldoApos: produto.saldo,
            origem: 'ENTRADA_ESTOQUE',
            origemId: criada.id,
          },
        })
      }

      if (parcelas) {
        for (const [n, p] of parcelas.entries()) {
          await tx.contaPagar.create({
            data: {
              pessoaId: dados.fornecedorId!,
              entradaId: criada.id,
              descricao: `Entrada de estoque nº ${criada.id} — parcela ${n + 1}/${parcelas.length}`,
              valor: p.valor,
              vencimento: new Date(`${p.vencimento}T12:00:00`),
            },
          })
        }
      } else if (dados.condicaoPagamento && total > 0) {
        const prazos = dados.condicaoPagamento.split('/').map(Number)
        const base = Math.floor(total / prazos.length)
        const resto = total - base * prazos.length
        for (const [n, dias] of prazos.entries()) {
          const vencimento = new Date(dados.data)
          vencimento.setDate(vencimento.getDate() + dias)
          await tx.contaPagar.create({
            data: {
              pessoaId: dados.fornecedorId!,
              entradaId: criada.id,
              descricao: `Entrada de estoque nº ${criada.id} — parcela ${n + 1}/${prazos.length}`,
              valor: base + (n === 0 ? resto : 0),
              vencimento,
            },
          })
        }
      }
      return tx.entradaEstoque.findUniqueOrThrow({ where: { id: criada.id }, include: comDetalhes })
    })
    return reply.status(201).send(entrada)
  })

  app.get('/entradas/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const entrada = await prisma.entradaEstoque.findUnique({
      where: { id },
      include: { ...comDetalhes, contasPagar: { orderBy: { vencimento: 'asc' } } },
    })
    if (!entrada) throw new AppError(404, 'Entrada não encontrada.')
    return entrada
  })
}
