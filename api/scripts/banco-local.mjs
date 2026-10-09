// Banco de desenvolvimento nesta máquina: um PostgreSQL local (o mesmo pacote dos testes), com os dados em
// api/.banco-local (fora do Git). O .env aponta para ele; o banco real fica só no .env.producao.
// Uso: npm run banco            (sobe o banco e cria ou atualiza as tabelas; Ctrl+C para parar)
//      npm run banco:copiar     (antes, tira uma cópia do banco real e carrega aqui; ver carregar-copia.mjs)
// O processo fica aberto enquanto o banco estiver em uso, como o servidor da API.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

const raiz = path.resolve(import.meta.dirname, '..')
const pasta = path.join(raiz, '.banco-local')
const PORTA = 5433
const URL_LOCAL = `postgresql://prumo:prumo@127.0.0.1:${PORTA}/prumo`
const novo = !existsSync(path.join(pasta, 'PG_VERSION'))

const postgres = new EmbeddedPostgres({
  databaseDir: pasta,
  user: 'prumo',
  password: 'prumo',
  port: PORTA,
  persistent: true,
  // UTF-8 e idioma inglês, como o banco real (Supabase, en_US.UTF-8).
  initdbFlags: ['--encoding=UTF8', '--locale=en-US'],
  onLog: () => {},
  onError: (e) => console.error(String(e)),
})

function prisma(...args) {
  const env = { ...process.env, DATABASE_URL: URL_LOCAL, DIRECT_URL: URL_LOCAL }
  const r = spawnSync(process.execPath, [path.join(raiz, 'node_modules', 'prisma', 'build', 'index.js'), ...args], { cwd: raiz, env, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`prisma ${args.join(' ')} falhou:\n${r.stdout}\n${r.stderr}`)
}

if (novo) await postgres.initialise()
await postgres.start()
if (novo) await postgres.createDatabase('prumo')
// Estrutura igual à do esquema, RLS e travas de empresa, como no banco real.
prisma('db', 'push', '--skip-generate', '--accept-data-loss')
prisma('db', 'execute', '--file', 'prisma/rls.sql', '--schema', 'prisma/schema.prisma')
prisma('db', 'execute', '--file', 'prisma/empresas.sql', '--schema', 'prisma/schema.prisma')
console.log(`Banco local no ar em ${URL_LOCAL}${novo ? ' (criado agora, vazio: rode "npm run banco:copiar" para trazer os dados reais)' : ''}.`)
console.log('Deixe esta janela aberta enquanto usar a API local. Ctrl+C para parar.')

const parar = async () => {
  await postgres.stop()
  process.exit(0)
}
process.on('SIGINT', parar)
process.on('SIGTERM', parar)
// Mantém o processo vivo enquanto o banco estiver em uso.
setInterval(() => {}, 1 << 30)
