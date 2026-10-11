// Carrega uma cópia de segurança (a pasta de JSON do copiar-banco.mjs) no banco LOCAL de desenvolvimento,
// apagando o que houver nele. Recusa qualquer banco que não seja desta máquina: nunca escreve no banco real.
// Uso: node --env-file=.env scripts/carregar-copia.mjs [pasta]   (padrão: a cópia mais recente em ../backups)
// Com o banco local no ar (npm run banco). "npm run banco:copiar" tira a cópia do banco real e chama este script.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''
const { hostname: host, port } = (() => {
  try {
    return new URL(url)
  } catch {
    return { hostname: '', port: '' }
  }
})()
// A porta 15433 é o túnel para o banco real (scripts/com-tunel.mjs): parece local, mas não é.
if (!['127.0.0.1', 'localhost', '::1'].includes(host) || port === '15433') {
  console.error(`Recusado: o banco do .env (${host ? `${host}:${port}` : 'sem endereço'}) não é o local. Este script só carrega cópias no banco desta máquina.`)
  process.exit(1)
}

const backups = path.resolve(import.meta.dirname, '..', '..', 'backups')
const pasta = process.argv[2] ?? path.join(backups, readdirSync(backups).filter((n) => /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(n)).sort().at(-1))
const arquivos = readdirSync(pasta).filter((n) => n.endsWith('.json'))
const prisma = new PrismaClient({ datasourceUrl: url })

const existentes = new Set((await prisma.$queryRawUnsafe(`select tablename from pg_tables where schemaname = 'public'`)).map((t) => t.tablename))
const tabelas = arquivos.map((a) => a.slice(0, -5)).filter((t) => existentes.has(t))
const comId = new Set(
  (await prisma.$queryRawUnsafe(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'id'`)).map((c) => c.table_name),
)
const nome = (t) => `"${t.replaceAll('"', '""')}"`

let total = 0
await prisma.$transaction(
  async (tx) => {
    // Sem gatilhos nem conferência de chaves durante a carga: a cópia já é coerente e as tabelas entram em qualquer ordem.
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`)
    await tx.$executeRawUnsafe(`truncate ${tabelas.map(nome).join(', ')} restart identity cascade`)
    for (const t of tabelas) {
      const linhas = JSON.parse(readFileSync(path.join(pasta, `${t}.json`), 'utf8'))
      if (linhas.length === 0) continue
      // O próprio PostgreSQL converte cada campo do JSON para o tipo da coluna.
      await tx.$executeRawUnsafe(`insert into ${nome(t)} select * from json_populate_recordset(null::${nome(t)}, $1::json)`, JSON.stringify(linhas))
      // A numeração dos ids continua de onde a cópia parou.
      if (comId.has(t)) {
        await tx.$executeRawUnsafe(
          `select setval(seq, (select coalesce(max(id), 1) from ${nome(t)})) from (select pg_get_serial_sequence('${nome(t)}', 'id') as seq) s where seq is not null`,
        )
      }
      total += linhas.length
      console.log(`${t.padEnd(24)} ${linhas.length}`)
    }
  },
  { timeout: 120000 },
)
await prisma.$disconnect()
console.log(`\n${total} linhas carregadas no banco local, a partir de ${pasta}`)
