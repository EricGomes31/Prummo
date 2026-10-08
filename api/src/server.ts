import path from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import estaticos from '@fastify/static'
import jwt from '@fastify/jwt'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { autenticar } from './auth.js'
import { abrirContexto } from './empresa.js'
import { AppError } from './lib.js'
import { autorizar } from './permissoes.js'
import { rotasAuth, rotasUsuarios } from './routes/usuarios.js'
import { rotasPessoas } from './routes/pessoas.js'
import { rotasProdutos } from './routes/produtos.js'
import { rotasEntradas } from './routes/entradas.js'
import { rotasPedidos } from './routes/pedidos.js'
import { rotasEntregas } from './routes/entregas.js'
import { rotasFinanceiro } from './routes/financeiro.js'
import { rotasEntregador, rotasLogistica } from './routes/logistica.js'
import { rotasDashboard } from './routes/dashboard.js'
import { rotasDashboards } from './routes/dashboards.js'
import { rotasConciliacao } from './routes/conciliacao.js'
import { rotasDespesas } from './routes/despesas.js'
import { rotasDevolucoes } from './routes/devolucoes.js'
import { rotasDocumentos } from './routes/documentos.js'
import { rotasEmpresas } from './routes/empresas.js'
import { rotasPromocoes } from './routes/promocoes.js'
import { rotasRelatorios } from './routes/relatorios.js'

const segredo = process.env.JWT_SECRET
if (!segredo || segredo.length < 32) {
  throw new Error('Defina JWT_SECRET no arquivo .env (mínimo de 32 caracteres).')
}

const app = Fastify({ logger: true })

// Cada requisição ganha o próprio contexto de empresa, definido depois de saber quem chamou (ver empresa.ts).
app.addHook('onRequest', (_req, _reply, continuar) => abrirContexto(continuar))

await app.register(cors, { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' })
await app.register(jwt, { secret: segredo, sign: { expiresIn: '12h' } })

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof AppError) return reply.status(err.status).send({ erro: err.message })
  if (err instanceof ZodError) {
    const primeiro = err.issues[0]
    const campo = primeiro.path.join('.')
    return reply.status(400).send({ erro: campo ? `${campo}: ${primeiro.message}` : primeiro.message })
  }
  // Trava do banco (prisma/empresas.sql): o id enviado é de um registro de outra empresa.
  if (err instanceof Error && err.message.includes('PRUMO_OUTRA_EMPRESA')) {
    return reply.status(404).send({ erro: 'Registro não encontrado.' })
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return reply.status(409).send({ erro: 'Já existe um registro com esse valor.' })
    if (err.code === 'P2025') return reply.status(404).send({ erro: 'Registro não encontrado.' })
    if (err.code === 'P2003') return reply.status(409).send({ erro: 'Registro em uso por outros lançamentos.' })
  }
  const status = (err as { statusCode?: number }).statusCode
  if (status && status < 500) return reply.status(status).send({ erro: (err as Error).message })
  app.log.error(err)
  return reply.status(500).send({ erro: 'Erro interno.' })
})

// Em produção a API também entrega o frontend: WEB_DIST aponta para a pasta do build (web/dist).
// Nesse modo as rotas ficam em /api, como o frontend chama; sem ele ficam na raiz e o Vite faz o repasse.
const webDist = process.env.WEB_DIST
const prefixo = webDist ? '/api' : ''

await app.register(
  async (api) => {
    api.get('/saude', async () => ({ ok: true }))
    await api.register(rotasAuth)
    // Público: o entregador entra pelo link da rota, sem usuário no sistema.
    await api.register(rotasEntregador)

    await api.register(async (privado) => {
      privado.addHook('onRequest', autenticar)
      // Depois de saber quem é o usuário, confere se o perfil dele permite a rota (ver permissoes.ts).
      privado.addHook('onRequest', autorizar(prefixo))
      await privado.register(rotasUsuarios)
      await privado.register(rotasPessoas)
      await privado.register(rotasProdutos)
      await privado.register(rotasEntradas)
      await privado.register(rotasPedidos)
      await privado.register(rotasEntregas)
      await privado.register(rotasFinanceiro)
      await privado.register(rotasDashboard)
      await privado.register(rotasPromocoes)
      await privado.register(rotasRelatorios)
      await privado.register(rotasDashboards)
      await privado.register(rotasDocumentos)
      await privado.register(rotasDevolucoes)
      await privado.register(rotasLogistica)
      await privado.register(rotasDespesas)
      await privado.register(rotasConciliacao)
      await privado.register(rotasEmpresas)
    })
  },
  { prefix: prefixo },
)

if (webDist) {
  await app.register(estaticos, { root: path.resolve(webDist) })
  // As telas do frontend são rotas do navegador: qualquer GET fora de /api recebe o index.html.
  app.setNotFoundHandler((req, reply) =>
    req.method === 'GET' && !req.url.startsWith('/api/')
      ? reply.sendFile('index.html')
      : reply.status(404).send({ erro: 'Rota não encontrada.' }),
  )
}

await app.listen({ port: Number(process.env.PORT ?? 3333), host: process.env.HOST ?? '127.0.0.1' })
