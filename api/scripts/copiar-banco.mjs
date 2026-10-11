// Cópia de segurança de todas as tabelas do banco do arquivo informado (o real: .env.producao), em JSON, sem depender do esquema do Prisma.
// Uso: npm run vps -- node --env-file=.env.producao scripts/copiar-banco.mjs [pasta]   (padrão: ../backups/AAAA-MM-DD-HHMM)
// A pasta de cópias fica fora do Git (.gitignore): contém dados reais.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const agora = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
const pasta = process.argv[2] ?? path.resolve(import.meta.dirname, '..', '..', 'backups', agora)
mkdirSync(pasta, { recursive: true })

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL })
const tabelas = await prisma.$queryRawUnsafe(`select tablename from pg_tables where schemaname = 'public' order by tablename`)
let total = 0
for (const { tablename } of tabelas) {
  const linhas = await prisma.$queryRawUnsafe(`select * from "${tablename.replaceAll('"', '""')}"`)
  writeFileSync(path.join(pasta, `${tablename}.json`), JSON.stringify(linhas, (_, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  total += linhas.length
  console.log(`${tablename.padEnd(24)} ${linhas.length}`)
}
await prisma.$disconnect()
console.log(`\n${tabelas.length} tabelas, ${total} linhas em ${pasta}`)
