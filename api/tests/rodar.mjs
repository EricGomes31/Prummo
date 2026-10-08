// Executor dos testes de ponta a ponta. Uso: npm test [-- parte-do-nome] [-- --detalhe]
//
// Sobe um PostgreSQL local e descartável, cria as tabelas uma vez num banco modelo e, para cada
// suíte, copia o modelo para um banco novo e sobe uma API apontada para ele. Nada toca o banco
// configurado no .env.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

const raiz = path.resolve(import.meta.dirname, '..')
const argumentos = process.argv.slice(2)
const detalhe = argumentos.includes('--detalhe')
const filtro = argumentos.find((a) => !a.startsWith('--'))
const suites = readdirSync(import.meta.dirname)
  .filter((nome) => nome.endsWith('.teste.mjs') && (!filtro || nome.includes(filtro)))
  .sort()
if (suites.length === 0) {
  console.error(`Nenhuma suíte encontrada${filtro ? ` com "${filtro}" no nome` : ''}.`)
  process.exit(2)
}

const portaLivre = () =>
  new Promise((resolve, reject) => {
    const servidor = createServer()
    servidor.once('error', reject)
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address()
      servidor.close(() => resolve(port))
    })
  })

const temporario = mkdtempSync(path.join(tmpdir(), 'prumo-testes-'))
const portaBanco = await portaLivre()
const SENHA_ADMIN = 'senha-de-teste-1'
const urlDoBanco = (nome) => `postgresql://prumo:prumo@127.0.0.1:${portaBanco}/${nome}`

// Ambiente dos processos filhos: as URLs do banco de teste substituem as do .env, que o Prisma
// também lê por conta própria mas nunca usa quando a variável já está definida.
const ambiente = (banco, extra = {}) => ({
  ...process.env,
  DATABASE_URL: urlDoBanco(banco),
  DIRECT_URL: urlDoBanco(banco),
  JWT_SECRET: randomBytes(32).toString('hex'),
  SEED_ADMIN_PASSWORD: SENHA_ADMIN,
  UPLOADS_DIR: path.join(temporario, 'uploads'),
  ...extra,
})

function executar(etapa, argumentosDoNode, env) {
  const r = spawnSync(process.execPath, argumentosDoNode, { cwd: raiz, env, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${etapa} falhou:\n${r.stdout}\n${r.stderr}`)
}

const postgres = new EmbeddedPostgres({
  databaseDir: path.join(temporario, 'pg'),
  user: 'prumo',
  password: 'prumo',
  port: portaBanco,
  persistent: false,
  onLog: () => {},
  onError: () => {},
})

let api = null
let falharam = 0
try {
  process.stdout.write('Preparando o banco de teste… ')
  await postgres.initialise()
  await postgres.start()
  await postgres.createDatabase('modelo')
  const prisma = path.join('node_modules', 'prisma', 'build', 'index.js')
  executar('Criação das tabelas', [prisma, 'db', 'push', '--skip-generate'], ambiente('modelo'))
  executar('Ativação do RLS', [prisma, 'db', 'execute', '--file', 'prisma/rls.sql', '--schema', 'prisma/schema.prisma'], ambiente('modelo'))
  executar('Seed', ['--import', 'tsx', 'prisma/seed.ts'], ambiente('modelo'))
  console.log('pronto.\n')

  const cliente = postgres.getPgClient()
  await cliente.connect()
  for (const suite of suites) {
    const nome = suite.replace('.teste.mjs', '')
    const banco = `suite_${nome.replace(/\W/g, '_')}`
    await cliente.query(`CREATE DATABASE "${banco}" TEMPLATE modelo`)

    const portaApi = await portaLivre()
    let registro = ''
    api = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: raiz,
      env: ambiente(banco, { PORT: String(portaApi) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    api.stdout.on('data', (d) => (registro = (registro + d).slice(-4000)))
    api.stderr.on('data', (d) => (registro = (registro + d).slice(-4000)))
    const endereco = `http://127.0.0.1:${portaApi}`
    let noAr = false
    for (let n = 0; n < 80 && !noAr && api.exitCode === null; n++) {
      noAr = await fetch(`${endereco}/saude`).then((r) => r.ok, () => false)
      if (!noAr) await new Promise((r) => setTimeout(r, 250))
    }
    if (!noAr) throw new Error(`A API de teste não subiu para a suíte ${nome}:\n${registro}`)

    const r = spawnSync(process.execPath, [path.join('tests', suite)], {
      cwd: raiz,
      env: { ...process.env, TESTE_API: endereco, TESTE_SENHA_ADMIN: SENHA_ADMIN },
      encoding: 'utf8',
    })
    api.kill()
    api = null

    const saida = `${r.stdout}${r.stderr}`.trimEnd().split('\n')
    const resultado = saida.find((l) => l.startsWith('RESULTADO '))?.slice(10)
    const passou = r.status === 0 && Boolean(resultado)
    if (!passou) falharam++
    console.log(`${passou ? 'ok   ' : 'FALHA'} ${nome.padEnd(18)} ${resultado ?? 'interrompida'}`)
    // Com falha mostra só o que deu errado; sem RESULTADO a suíte quebrou e a saída inteira interessa.
    const mostrar = detalhe || !resultado ? saida : saida.filter((l) => l.startsWith('FALHA'))
    for (const linha of mostrar.filter((l) => !l.startsWith('RESULTADO '))) console.log(`       ${linha}`)
  }
  await cliente.end()
} catch (erro) {
  falharam++
  console.error(`\n${erro.message}`)
} finally {
  api?.kill()
  await postgres.stop().catch(() => {})
  rmSync(temporario, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}

console.log(falharam ? `\n${falharam} suíte(s) com falha.` : `\nTodas as ${suites.length} suítes passaram.`)
process.exit(falharam ? 1 : 0)
