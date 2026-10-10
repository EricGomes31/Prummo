import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { definirEmpresa, semEmpresa } from '../empresa.js'
import { AppError, idParam, prisma, texto } from '../lib.js'

const corpoEmpresa = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da empresa').max(120),
  documento: texto.digitos,
})

const corpoNovaEmpresa = corpoEmpresa.extend({
  // Primeiro usuário da empresa, com o perfil de administrador dela.
  administrador: z.object({
    nome: z.string().trim().min(2, 'Informe o nome do administrador').max(120),
    email: z.string().trim().toLowerCase().email('Informe um e-mail válido'),
    senha: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(100),
  }),
})

// Administração das empresas que usam o Prumo. Só o administrador do sistema chega aqui; as rotas
// enxergam todas as empresas, por isso rodam sem o filtro de empresa.
export async function rotasEmpresas(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => {
    if (!req.usuario.sistema) throw new AppError(403, 'Só o administrador do sistema gerencia as empresas.')
  })

  app.get('/sistema/empresas', async () =>
    semEmpresa(async () => {
      const [empresas, usuarios] = await Promise.all([
        prisma.empresa.findMany({ orderBy: { nome: 'asc' } }),
        prisma.usuario.groupBy({ by: ['empresaId'], _count: true }),
      ])
      const porEmpresa = new Map(usuarios.map((u) => [u.empresaId, u._count]))
      return empresas.map((e) => ({ ...e, usuarios: porEmpresa.get(e.id) ?? 0 }))
    }),
  )

  // Cria a empresa já pronta para uso: o administrador dela e a conta "Caixa", que os recebimentos exigem.
  app.post('/sistema/empresas', async (req, reply) => {
    const dados = corpoNovaEmpresa.parse(req.body)
    const emUso = await semEmpresa(async () => await prisma.usuario.findUnique({ where: { email: dados.administrador.email } }))
    if (emUso) throw new AppError(409, 'Esse e-mail já é usado por outro usuário do sistema.')
    const senhaHash = await bcrypt.hash(dados.administrador.senha, 10)
    const empresa = await prisma.$transaction(async (tx) => {
      const nova = await tx.empresa.create({ data: { nome: dados.nome, documento: dados.documento } })
      // As gravações seguintes ficam na empresa nova, não na de quem está criando.
      definirEmpresa(nova.id)
      await tx.usuario.create({
        data: { nome: dados.administrador.nome, email: dados.administrador.email, perfil: 'ADMIN', senhaHash, empresaId: nova.id },
      })
      await tx.contaFinanceira.create({ data: { nome: 'Caixa', tipo: 'CAIXA', empresaId: nova.id } })
      return nova
    })
    return reply.status(201).send({ ...empresa, usuarios: 1 })
  })

  // Usuários de uma empresa, para o administrador do sistema redefinir a senha de quem a esqueceu
  // (principalmente o administrador da empresa, que é quem redefiniria a dos outros).
  app.get('/sistema/empresas/:id/usuarios', async (req) => {
    const { id } = idParam.parse(req.params)
    return semEmpresa(async () => {
      await prisma.empresa.findUniqueOrThrow({ where: { id } })
      return prisma.usuario.findMany({
        where: { empresaId: id },
        select: { id: true, nome: true, email: true, perfil: true, ativo: true, perfilAcesso: { select: { nome: true } } },
        orderBy: { nome: 'asc' },
      })
    })
  })

  // Senha provisória: o usuário entra com ela e troca em "Alterar senha".
  app.put('/sistema/empresas/:id/usuarios/:usuarioId/senha', async (req, reply) => {
    const { id, usuarioId } = z.object({ id: z.coerce.number().int().positive(), usuarioId: z.coerce.number().int().positive() }).parse(req.params)
    const { senha } = z.object({ senha: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(100) }).parse(req.body)
    const senhaHash = await bcrypt.hash(senha, 10)
    const alterados = await semEmpresa(async () => await prisma.usuario.updateMany({ where: { id: usuarioId, empresaId: id }, data: { senhaHash } }))
    if (alterados.count === 0) throw new AppError(404, 'Usuário não encontrado nesta empresa.')
    return reply.status(204).send()
  })

  app.put('/sistema/empresas/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = corpoEmpresa.extend({ ativa: z.boolean() }).parse(req.body)
    if (id === req.usuario.empresa.id && !dados.ativa) throw new AppError(400, 'Você não pode desativar a própria empresa.')
    return semEmpresa(async () => await prisma.empresa.update({ where: { id }, data: dados }))
  })
}
