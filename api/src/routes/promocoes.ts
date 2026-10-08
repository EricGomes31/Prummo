import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, centavos, dataIso, idParam, prisma } from '../lib.js'
import { calcularDescontoPromocao, estaVigente, MODALIDADES } from '../promocao.js'

const quantidade = z.number().int().positive('Quantidade deve ser maior que zero')

const corpo = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome da campanha').max(120),
    modalidade: z.enum(MODALIDADES),
    inicio: dataIso,
    fim: dataIso,
    percentual: z.number().int().min(1).max(10000).nullish(),
    preco: centavos.nullish(),
    leve: quantidade.nullish(),
    pague: quantidade.nullish(),
    ativo: z.boolean().default(true),
    itens: z
      .array(
        z.object({
          produtoId: z.number().int().positive('Selecione o produto'),
          quantidade: quantidade.default(1),
          papel: z.enum(['COMPRA', 'BRINDE']).default('COMPRA'),
        }),
      )
      .min(1, 'Inclua ao menos um produto'),
  })
  .superRefine((d, ctx) => {
    const erro = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (d.fim < d.inicio) erro('O fim da campanha não pode ser antes do início.')
    if (new Set(d.itens.map((i) => i.produtoId)).size !== d.itens.length) erro('O mesmo produto aparece mais de uma vez.')
    const brindes = d.itens.filter((i) => i.papel === 'BRINDE').length
    if (d.modalidade === 'PERCENTUAL' && !d.percentual) erro('Informe o percentual de desconto.')
    if (d.modalidade === 'PRECO' && !d.preco) erro('Informe o preço promocional.')
    if (d.modalidade === 'COMBO' && !d.preco) erro('Informe o preço do combo.')
    if (d.modalidade === 'LEVE_PAGUE' && !(d.leve && d.pague && d.leve >= 2 && d.pague < d.leve)) {
      erro('Em "leve e pague", a quantidade paga deve ser menor que a levada.')
    }
    if (d.modalidade === 'BRINDE' && (brindes === 0 || brindes === d.itens.length)) {
      erro('Informe ao menos um produto comprado e um produto de brinde.')
    }
    if (d.modalidade !== 'BRINDE' && brindes > 0) erro('Só a modalidade brinde aceita produto de brinde.')
  })

// Guarda só os campos que a modalidade usa, para a campanha não carregar valores sem efeito.
function normalizar(d: z.infer<typeof corpo>) {
  const usa = (...modalidades: string[]) => modalidades.includes(d.modalidade)
  return {
    nome: d.nome,
    modalidade: d.modalidade,
    inicio: d.inicio,
    fim: d.fim,
    ativo: d.ativo,
    percentual: usa('PERCENTUAL') ? d.percentual! : null,
    preco: usa('PRECO', 'COMBO') ? d.preco! : null,
    leve: usa('LEVE_PAGUE') ? d.leve! : null,
    pague: usa('LEVE_PAGUE') ? d.pague! : null,
    itens: d.itens.map((i) => ({ ...i, quantidade: usa('LEVE_PAGUE') ? 1 : i.quantidade })),
  }
}

const comItens = { itens: { include: { produto: { select: { id: true, sku: true, nome: true } } }, orderBy: { id: 'asc' } } } as const

export async function rotasPromocoes(app: FastifyInstance) {
  app.get('/promocoes', async () => {
    const campanhas = await prisma.promocao.findMany({ include: comItens, orderBy: { id: 'desc' } })
    return campanhas.map((c) => ({ ...c, vigente: estaVigente(c) }))
  })

  app.post('/promocoes', async (req, reply) => {
    const { itens, ...dados } = normalizar(corpo.parse(req.body))
    const campanha = await prisma.promocao.create({ data: { ...dados, itens: { create: itens } }, include: comItens })
    return reply.status(201).send(campanha)
  })

  app.put('/promocoes/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const { itens, ...dados } = normalizar(corpo.parse(req.body))
    return prisma.$transaction(async (tx) => {
      await tx.promocaoItem.deleteMany({ where: { promocaoId: id } })
      return tx.promocao.update({ where: { id }, data: { ...dados, itens: { create: itens } }, include: comItens })
    })
  })

  // Mostra o desconto que a campanha daria a um conjunto de itens, sem gravar nada.
  app.post('/promocoes/:id/simular', async (req) => {
    const { id } = idParam.parse(req.params)
    const { itens } = z
      .object({ itens: z.array(z.object({
            produtoId: z.number().int(),
            quantidade: z.number().int().min(0),
            precoUnitario: centavos,
            fator: z.number().int().positive().default(1),
          })) })
      .parse(req.body)
    const campanha = await carregarVigente(id)
    return { desconto: calcularDescontoPromocao(campanha, itens) }
  })
}

export async function carregarVigente(id: number) {
  const campanha = await prisma.promocao.findUnique({ where: { id }, include: comItens })
  if (!campanha) throw new AppError(404, 'Campanha não encontrada.')
  if (!estaVigente(campanha)) throw new AppError(400, `A campanha "${campanha.nome}" não está vigente.`)
  return campanha
}
