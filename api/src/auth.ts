import type { FastifyRequest } from 'fastify'
import { definirEmpresa, semEmpresa } from './empresa.js'
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
  // Administrador do sistema: gerencia as empresas, além da própria.
  sistema: boolean
  empresa: { id: number; nome: string }
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
  sistema: true,
  ativo: true,
  empresa: { select: { id: true, nome: true, ativa: true } },
  perfilAcesso: { select: { nome: true, permissoes: true, dashboards: true, ativo: true } },
} as const

// Dados do usuário com os acessos já resolvidos, como vão para a sessão e para o frontend.
// A busca é por e-mail ou id, antes de saber a empresa, por isso roda sem o filtro de empresa.
export async function usuarioDaSessao(where: { id: number } | { email: string }) {
  const usuario = await semEmpresa(async () => await prisma.usuario.findUnique({ where, select: { ...doUsuario, senhaHash: true } }))
  if (!usuario) return null
  const { perfilAcesso, senhaHash, ativo, empresa, ...dados } = usuario
  return {
    // Usuário de empresa inativa não entra, como se estivesse inativo.
    ativo: ativo && empresa.ativa,
    senhaHash,
    sessao: { ...dados, empresa: { id: empresa.id, nome: empresa.nome }, ...acessosDe({ perfil: dados.perfil, perfilAcesso }) } satisfies UsuarioDaSessao,
  }
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
  // Daqui em diante, toda consulta da requisição fica restrita à empresa do usuário.
  definirEmpresa(usuario.sessao.empresa.id)
}
