import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, centavos, idParam, mmc, prisma } from '../lib.js'

export const UNIDADES = ['UN', 'CX', 'FR', 'AMP', 'PCT', 'KIT', 'PAR', 'DZ', 'KG', 'G', 'L', 'ML', 'M', 'SV'] as const

// Limite do número de partes por unidade base, para o saldo caber com folga em um inteiro.
const DIVISOR_MAXIMO = 100_000

const corpo = z
  .object({
    // Em branco, o código é gerado a partir do número do cadastro.
    sku: z.string().trim().max(40).optional(),
    nome: z.string().trim().min(2, 'Informe a descrição').max(160),
    ean: z
      .string()
      .trim()
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || /^\d{8,14}$/.test(v), 'O EAN deve ter de 8 a 14 dígitos'),
    unidade: z.enum(UNIDADES).default('UN'),
    // Unidades extras de entrada e venda; o estoque e o custo continuam na unidade base.
    unidades: z
      .array(
        z.object({
          sigla: z.enum(UNIDADES),
          fator: z.number().int().min(2, 'O fator deve ser 2 ou mais').max(10_000),
          precoVenda: centavos.nullish(),
        }),
      )
      .max(8)
      .default([]),
    // O custo vem das entradas de estoque; aqui só é aceito para carga inicial.
    precoCusto: centavos.optional(),
    precoVenda: centavos,
    estoqueMinimo: z.number().int().min(0).default(0),
    controlaEstoque: z.boolean().default(true),
    ativo: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    const siglas = d.unidades.map((u) => u.sigla)
    if (new Set(siglas).size !== siglas.length) ctx.addIssue({ code: 'custom', message: 'A mesma unidade aparece mais de uma vez.' })
    if (siglas.includes(d.unidade)) ctx.addIssue({ code: 'custom', message: 'A unidade base não pode se repetir nas unidades extras.' })
  })

function calcularDivisor(atual: number, fatores: number[]) {
  const divisor = fatores.reduce(mmc, atual)
  if (divisor > DIVISOR_MAXIMO) {
    throw new AppError(400, 'Os fatores das unidades deste produto não combinam entre si. Use fatores múltiplos uns dos outros.')
  }
  return divisor
}

type ComUnidades = { nome: string; unidade: string; unidades: { sigla: string; fator: number; precoVenda: number | null }[] }

// Acha a unidade de um lançamento. Sem sigla, ou com a sigla da unidade base, o fator é 1.
export function resolverUnidade(produto: ComUnidades, sigla?: string | null) {
  if (!sigla || sigla === produto.unidade) return { sigla: produto.unidade, fator: 1, precoVenda: null }
  const unidade = produto.unidades.find((u) => u.sigla === sigla)
  if (!unidade) throw new AppError(400, `"${produto.nome}" não tem a unidade ${sigla}.`)
  return unidade
}

const comUnidades = { unidades: { orderBy: { fator: 'asc' } } } as const

export async function rotasProdutos(app: FastifyInstance) {
  app.get('/produtos', async (req) => {
    const q = z.object({ busca: z.string().trim().optional() }).parse(req.query)
    return prisma.produto.findMany({
      where: q.busca
        ? { OR: (['nome', 'sku', 'ean'] as const).map((campo) => ({ [campo]: { contains: q.busca, mode: 'insensitive' as const } })) }
        : {},
      include: comUnidades,
      orderBy: { nome: 'asc' },
    })
  })

  app.post('/produtos', async (req, reply) => {
    const { sku, unidades, ...dados } = corpo.parse(req.body)
    const divisor = calcularDivisor(1, unidades.map((u) => u.fator))
    const produto = await prisma.$transaction(async (tx) => {
      const criado = await tx.produto.create({
        data: { ...dados, divisor, sku: sku || `tmp-${randomUUID()}`, unidades: { create: unidades } },
        include: comUnidades,
      })
      if (sku) return criado
      return tx.produto.update({
        where: { id: criado.id },
        data: { sku: `P-${String(criado.id).padStart(4, '0')}` },
        include: comUnidades,
      })
    })
    return reply.status(201).send(produto)
  })

  app.put('/produtos/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const { sku, unidades, ...dados } = corpo.parse(req.body)
    return prisma.$transaction(async (tx) => {
      const atual = await tx.produto.findUnique({ where: { id } })
      if (!atual) throw new AppError(404, 'Produto não encontrado.')
      // O divisor só cresce: assim o fator de qualquer lançamento antigo continua valendo partes inteiras.
      const divisor = calcularDivisor(atual.divisor, unidades.map((u) => u.fator))
      const escala = divisor / atual.divisor
      if (escala > 1) {
        await tx.movimentoEstoque.updateMany({
          where: { produtoId: id },
          data: { quantidade: { multiply: escala }, saldoApos: { multiply: escala } },
        })
      }
      await tx.produtoUnidade.deleteMany({ where: { produtoId: id } })
      return tx.produto.update({
        where: { id },
        data: {
          ...dados,
          ...(sku ? { sku } : {}),
          divisor,
          ...(escala > 1 ? { saldo: { multiply: escala } } : {}),
          unidades: { create: unidades },
        },
        include: comUnidades,
      })
    })
  })

  // Movimentações com as quantidades já convertidas para a unidade base.
  app.get('/produtos/:id/movimentos', async (req) => {
    const { id } = idParam.parse(req.params)
    const produto = await prisma.produto.findUnique({ where: { id }, select: { divisor: true } })
    if (!produto) throw new AppError(404, 'Produto não encontrado.')
    const movimentos = await prisma.movimentoEstoque.findMany({ where: { produtoId: id }, orderBy: { id: 'desc' }, take: 100 })
    return movimentos.map((m) => ({
      ...m,
      quantidade: m.quantidade / produto.divisor,
      saldoApos: m.saldoApos / produto.divisor,
    }))
  })

  // Ajuste de inventário: informa o saldo contado, na unidade base, e registra a diferença.
  app.post('/produtos/:id/ajuste', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = z
      .object({ novoSaldo: z.number().min(0).max(1_000_000), observacao: z.string().trim().max(200).optional() })
      .parse(req.body)
    return prisma.$transaction(async (tx) => {
      const produto = await tx.produto.findUnique({ where: { id }, include: comUnidades })
      if (!produto) throw new AppError(404, 'Produto não encontrado.')
      if (!produto.controlaEstoque) throw new AppError(400, 'Este produto não controla estoque.')
      // O saldo contado é arredondado para a parte mais próxima (a menor fração vendável do produto).
      const novoSaldo = Math.round(dados.novoSaldo * produto.divisor)
      const diferenca = novoSaldo - produto.saldo
      if (diferenca === 0) return produto
      await tx.movimentoEstoque.create({
        data: {
          produtoId: id,
          tipo: 'AJUSTE',
          quantidade: diferenca,
          saldoApos: novoSaldo,
          origem: 'AJUSTE',
          observacao: dados.observacao || null,
        },
      })
      return tx.produto.update({ where: { id }, data: { saldo: novoSaldo }, include: comUnidades })
    })
  })
}
