import type { FastifyRequest } from 'fastify'
import { AppError, prisma } from './lib.js'
import { acessosDe } from './permissoes.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number }
    user: { sub: number }
  }
}

export type UsuarioDaSessao = {
  id: number
  nome: string
  email: string
  perfil: string
  perfilId: number | null
  perfilNome: string
  permissoes: string[]
  dashboards: string[]
}

declare module 'fastify' {
  interface FastifyRequest {
    usuario: UsuarioDaSessao
  }
}

const doUsuario = {
  id: true,
  nome: true,
  email: true,
  perfil: true,
  perfilId: true,
  ativo: true,
  perfilAcesso: { select: { nome: true, permissoes: true, dashboards: true, ativo: true } },
} as const

// Dados do usuário com os acessos já resolvidos, como vão para a sessão e para o frontend.
export async function usuarioDaSessao(where: { id: number } | { email: string }) {
  const usuario = await prisma.usuario.findUnique({ where, select: { ...doUsuario, senhaHash: true } })
  if (!usuario) return null
  const { perfilAcesso, senhaHash, ativo, ...dados } = usuario
  return { ativo, senhaHash, sessao: { ...dados, ...acessosDe({ perfil: dados.perfil, perfilAcesso }) } satisfies UsuarioDaSessao }
}

export async function autenticar(req: FastifyRequest) {
  try {
    await req.jwtVerify()
  } catch {
    throw new AppError(401, 'Sessão expirada. Entre novamente.')
  }
  const usuario = await usuarioDaSessao({ id: req.user.sub })
  if (!usuario || !usuario.ativo) throw new AppError(401, 'Usuário inativo ou inexistente.')
  req.usuario = usuario.sessao
}
