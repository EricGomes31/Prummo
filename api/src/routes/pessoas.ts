import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, idParam, prisma, texto } from '../lib.js'

export const CLASSIFICACOES = ['cliente', 'fornecedor', 'prestador', 'paciente', 'medico', 'vendedor'] as const

const corpo = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome').max(160),
    nomeFantasia: texto.opcional,
    documento: texto.opcional,
    rgIe: texto.opcional,
    email: texto.opcional,
    telefone: texto.opcional,
    celular: texto.opcional,
    cep: texto.opcional,
    logradouro: texto.opcional,
    numero: texto.opcional,
    complemento: texto.opcional,
    bairro: texto.opcional,
    cidade: texto.opcional,
    uf: texto.opcional,
    cliente: z.boolean().default(false),
    fornecedor: z.boolean().default(false),
    prestador: z.boolean().default(false),
    paciente: z.boolean().default(false),
    medico: z.boolean().default(false),
    vendedor: z.boolean().default(false),
    ativo: z.boolean().default(true),
  })
  .refine((d) => CLASSIFICACOES.some((c) => d[c]), { message: 'Marque ao menos uma classificação.' })

export async function rotasPessoas(app: FastifyInstance) {
  app.get('/pessoas', async (req) => {
    const q = z
      .object({ busca: z.string().trim().optional(), classificacao: z.enum(CLASSIFICACOES).optional() })
      .parse(req.query)
    const campos = ['nome', 'nomeFantasia', 'documento', 'email', 'telefone', 'celular'] as const
    return prisma.pessoa.findMany({
      where: {
        ...(q.classificacao ? { [q.classificacao]: true } : {}),
        ...(q.busca ? { OR: campos.map((campo) => ({ [campo]: { contains: q.busca, mode: 'insensitive' as const } })) } : {}),
      },
      orderBy: { nome: 'asc' },
    })
  })

  app.post('/pessoas', async (req, reply) => {
    const pessoa = await prisma.pessoa.create({ data: corpo.parse(req.body) })
    return reply.status(201).send(pessoa)
  })

  app.put('/pessoas/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.pessoa.update({ where: { id }, data: corpo.parse(req.body) })
  })

  // Só exclui quem nunca foi usado; com histórico, o caminho é desativar o cadastro.
  app.delete('/pessoas/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const pessoa = await prisma.pessoa.findUnique({
      where: { id },
      select: {
        _count: {
          select: { pedidos: true, pedidosVendedor: true, pedidosMedico: true, pedidosPaciente: true, entradas: true, contasReceber: true, contasPagar: true },
        },
      },
    })
    if (!pessoa) throw new AppError(404, 'Pessoa não encontrada.')
    if (Object.values(pessoa._count).some((n) => n > 0)) {
      throw new AppError(409, 'Este cadastro tem pedidos ou lançamentos e não pode ser excluído. Desmarque "Ativo" para desativá-lo.')
    }
    await prisma.pessoa.delete({ where: { id } })
    return reply.status(204).send()
  })
}
