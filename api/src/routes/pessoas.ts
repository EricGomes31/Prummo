import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { definirEmpresa, semEmpresa } from '../empresa.js'
import { conferirTentativas, registrarFalha } from '../limite.js'
import { AppError, idParam, prisma, texto } from '../lib.js'

export const CLASSIFICACOES = ['cliente', 'fornecedor', 'prestador', 'paciente', 'medico', 'vendedor'] as const

// Os dados que a própria pessoa pode atualizar pelo link: identificação, contato e endereço.
const dadosDaPessoa = {
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
}

const corpo = z
  .object({
    ...dadosDaPessoa,
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

  // Gera o link para a pessoa atualizar o próprio cadastro. A chave só aparece nesta resposta; gerar
  // outro invalida o anterior. O link vale uma vez e por `dias` dias.
  app.post('/pessoas/:id/link-cadastro', async (req) => {
    const { id } = idParam.parse(req.params)
    const { dias } = z.object({ dias: z.number().int().min(1, 'A validade vai de 1 a 30 dias').max(30, 'A validade vai de 1 a 30 dias').default(7) }).parse(req.body ?? {})
    const chave = randomBytes(24).toString('base64url')
    const expiraEm = new Date(Date.now() + dias * 24 * 60 * 60 * 1000)
    await prisma.pessoa.update({ where: { id }, data: { cadastroLinkHash: hashDaChave(chave), cadastroLinkExpiraEm: expiraEm } })
    return { chave, expiraEm }
  })

  app.delete('/pessoas/:id/link-cadastro', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    await prisma.pessoa.update({ where: { id }, data: { cadastroLinkHash: null, cadastroLinkExpiraEm: null } })
    return reply.status(204).send()
  })
}

const hashDaChave = (chave: string) => createHash('sha256').update(chave).digest('hex')

// Rotas públicas do cadastro: valem só com a chave do link, enviada no cabeçalho X-Cadastro-Token.
export async function rotasCadastroPublico(app: FastifyInstance) {
  async function pessoaDoLink(req: FastifyRequest) {
    conferirTentativas(req)
    const { id } = idParam.parse(req.params)
    const chave = String(req.headers['x-cadastro-token'] ?? '')
    // Quem abre o link não tem usuário: a empresa vem do próprio cadastro, depois de conferida a chave.
    const pessoa = await semEmpresa(async () => await prisma.pessoa.findUnique({ where: { id }, omit: { cadastroLinkHash: false } }))
    const recebido = Buffer.from(hashDaChave(chave))
    const esperado = Buffer.from(pessoa?.cadastroLinkHash ?? hashDaChave(''))
    const confere = !!pessoa?.cadastroLinkHash && !!chave && timingSafeEqual(recebido, esperado)
    if (!pessoa || !confere || !pessoa.cadastroLinkExpiraEm || pessoa.cadastroLinkExpiraEm <= new Date() || !pessoa.ativo) {
      registrarFalha(req)
      throw new AppError(401, 'Link indisponível ou expirado. Peça um novo link à empresa.')
    }
    definirEmpresa(pessoa.empresaId)
    return pessoa
  }

  // Só os campos que a pessoa pode ver e alterar, e o nome da empresa que pediu a atualização.
  const paraAPessoa = async (pessoa: Awaited<ReturnType<typeof pessoaDoLink>>) => {
    const empresa = await semEmpresa(async () => await prisma.empresa.findUnique({ where: { id: pessoa.empresaId }, select: { nome: true } }))
    const campos = Object.fromEntries(Object.keys(dadosDaPessoa).map((c) => [c, pessoa[c as keyof typeof dadosDaPessoa] ?? null]))
    return { empresa: empresa?.nome ?? '', expiraEm: pessoa.cadastroLinkExpiraEm, ...campos }
  }

  app.get('/cadastro/:id', async (req) => paraAPessoa(await pessoaDoLink(req)))

  // Grava os dados e encerra o link: para atualizar de novo, a empresa gera outro.
  app.put('/cadastro/:id', async (req) => {
    const pessoa = await pessoaDoLink(req)
    const dados = z.object(dadosDaPessoa).parse(req.body)
    const { count } = await prisma.pessoa.updateMany({
      where: { id: pessoa.id, cadastroLinkHash: pessoa.cadastroLinkHash },
      data: { ...dados, cadastroLinkHash: null, cadastroLinkExpiraEm: null, cadastroAtualizadoEm: new Date() },
    })
    if (count === 0) throw new AppError(409, 'Este link já foi usado. Peça um novo link à empresa.')
    return { ok: true }
  })
}
