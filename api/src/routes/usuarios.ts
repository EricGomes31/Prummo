import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { autenticar, usuarioDaSessao } from '../auth.js'
import { AppError, idParam, prisma, texto } from '../lib.js'
import { acessosDe, DASHBOARDS, GRUPOS_PERMISSOES, PERFIS_PADRAO, PERMISSOES } from '../permissoes.js'

const publico = {
  id: true,
  nome: true,
  email: true,
  perfil: true,
  perfilId: true,
  ativo: true,
  criadoEm: true,
  perfilAcesso: { select: { nome: true, permissoes: true, dashboards: true, ativo: true } },
} as const
const senha = z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(100)
// O usuário tem um perfil de fábrica (ADMIN ou OPERADOR) ou um perfil de acesso personalizado (perfilId).
const escolhaDePerfil = {
  perfil: z.enum(['ADMIN', 'OPERADOR']).default('OPERADOR'),
  perfilId: z.number().int().positive().nullish(),
}

type ComPerfil = { perfil: string; perfilAcesso: { nome: string; permissoes: string[]; dashboards: string[]; ativo: boolean } | null }
// Na lista de usuários o perfil personalizado aparece pelo nome.
const comNomeDoPerfil = <U extends ComPerfil>({ perfilAcesso, ...usuario }: U) => ({
  ...usuario,
  perfilNome: acessosDe({ perfil: usuario.perfil, perfilAcesso }).perfilNome,
})

async function perfilParaGravar(dados: { perfil: 'ADMIN' | 'OPERADOR'; perfilId?: number | null }) {
  if (!dados.perfilId) return { perfil: dados.perfil, perfilId: null }
  const existe = await prisma.perfilAcesso.findUnique({ where: { id: dados.perfilId } })
  if (!existe) throw new AppError(400, 'Perfil de acesso não encontrado.')
  return { perfil: 'OPERADOR', perfilId: dados.perfilId }
}

export async function rotasAuth(app: FastifyInstance) {
  app.post('/auth/login', async (req) => {
    const dados = z.object({ email: z.string().trim().toLowerCase(), senha: z.string() }).parse(req.body)
    const usuario = await usuarioDaSessao({ email: dados.email })
    const confere = usuario && usuario.ativo && (await bcrypt.compare(dados.senha, usuario.senhaHash))
    if (!usuario || !confere) throw new AppError(401, 'E-mail ou senha incorretos.')
    const token = app.jwt.sign({ sub: usuario.sessao.id })
    return { token, usuario: usuario.sessao }
  })

  app.get('/auth/me', { onRequest: autenticar }, async (req) => req.usuario)

  app.put('/auth/senha', { onRequest: autenticar }, async (req, reply) => {
    const dados = z.object({ senhaAtual: z.string(), novaSenha: senha }).parse(req.body)
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: req.usuario.id } })
    if (!(await bcrypt.compare(dados.senhaAtual, usuario.senhaHash))) {
      throw new AppError(400, 'A senha atual não confere.')
    }
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { senhaHash: await bcrypt.hash(dados.novaSenha, 10) },
    })
    return reply.status(204).send()
  })
}

// Quem pode chamar cada rota daqui está em permissoes.ts (USUARIOS_GERENCIAR).
export async function rotasUsuarios(app: FastifyInstance) {
  app.get('/usuarios', async () => (await prisma.usuario.findMany({ select: publico, orderBy: { nome: 'asc' } })).map(comNomeDoPerfil))

  app.post('/usuarios', async (req, reply) => {
    const dados = z
      .object({ nome: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email(), senha, ...escolhaDePerfil })
      .parse(req.body)
    const usuario = await prisma.usuario.create({
      data: { nome: dados.nome, email: dados.email, ...(await perfilParaGravar(dados)), senhaHash: await bcrypt.hash(dados.senha, 10) },
      select: publico,
    })
    return reply.status(201).send(comNomeDoPerfil(usuario))
  })

  app.put('/usuarios/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = z
      .object({
        nome: z.string().trim().min(2).max(120),
        email: z.string().trim().toLowerCase().email(),
        ...escolhaDePerfil,
        ativo: z.boolean(),
        senha: senha.optional(),
      })
      .parse(req.body)
    const perfil = await perfilParaGravar(dados)
    if (id === req.usuario.id) {
      const novo = perfil.perfilId ? await prisma.perfilAcesso.findUnique({ where: { id: perfil.perfilId } }) : null
      const continuaGerenciando = acessosDe({ perfil: perfil.perfil, perfilAcesso: novo }).permissoes.includes('USUARIOS_GERENCIAR')
      if (!dados.ativo || !continuaGerenciando) throw new AppError(400, 'Você não pode desativar nem rebaixar o próprio usuário.')
    }
    const usuario = await prisma.usuario.update({
      where: { id },
      data: {
        nome: dados.nome,
        email: dados.email,
        ...perfil,
        ativo: dados.ativo,
        ...(dados.senha ? { senhaHash: await bcrypt.hash(dados.senha, 10) } : {}),
      },
      select: publico,
    })
    return comNomeDoPerfil(usuario)
  })

  const corpoPerfil = z.object({
    nome: z.string().trim().min(2, 'Informe o nome do perfil').max(60),
    descricao: texto.opcional,
    permissoes: z.array(z.enum(PERMISSOES as [string, ...string[]])).transform((p) => [...new Set(p)]),
    dashboards: z.array(z.enum(DASHBOARDS.map(([codigo]) => codigo) as [string, ...string[]])).transform((d) => [...new Set(d)]),
    ativo: z.boolean().default(true),
  })

  // Perfis de fábrica (fixos), perfis personalizados e o catálogo para montar a tela.
  app.get('/perfis', async () => {
    const personalizados = await prisma.perfilAcesso.findMany({ orderBy: { nome: 'asc' }, include: { _count: { select: { usuarios: true } } } })
    return {
      padrao: Object.entries(PERFIS_PADRAO).map(([codigo, p]) => ({ codigo, ...p })),
      personalizados: personalizados.map(({ _count, ...p }) => ({ ...p, usuarios: _count.usuarios })),
      catalogo: {
        grupos: GRUPOS_PERMISSOES.map((g) => ({ grupo: g.grupo, permissoes: g.permissoes.map(([codigo, rotulo]) => ({ codigo, rotulo })) })),
        dashboards: DASHBOARDS.map(([codigo, rotulo]) => ({ codigo, rotulo })),
      },
    }
  })

  app.post('/perfis', async (req, reply) => {
    const perfil = await prisma.perfilAcesso.create({ data: corpoPerfil.parse(req.body) })
    return reply.status(201).send({ ...perfil, usuarios: 0 })
  })

  app.put('/perfis/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = corpoPerfil.parse(req.body)
    // Quem está editando não pode tirar de si mesmo o acesso a esta tela.
    if (req.usuario.perfilId === id && (!dados.ativo || !dados.permissoes.includes('USUARIOS_GERENCIAR'))) {
      throw new AppError(400, 'Você não pode tirar do próprio perfil o gerenciamento de usuários.')
    }
    return prisma.perfilAcesso.update({ where: { id }, data: dados })
  })
}
