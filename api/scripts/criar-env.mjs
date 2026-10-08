// Gera o .env com segredos aleatórios. Não sobrescreve um .env existente.
import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'

if (existsSync('.env')) {
  console.log('.env já existe; nada foi alterado.')
} else {
  writeFileSync(
    '.env',
    [
      '# Banco PostgreSQL no Supabase: copie as duas URLs em Connect > ORMs > Prisma.',
      'DATABASE_URL=""',
      'DIRECT_URL=""',
      `JWT_SECRET="${randomBytes(48).toString('hex')}"`,
      'PORT=3333',
      `SEED_ADMIN_PASSWORD="${randomBytes(9).toString('base64url')}"`,
      '',
    ].join('\n'),
  )
  console.log('.env criado. A senha inicial do administrador está em SEED_ADMIN_PASSWORD.')
  console.log('Preencha DATABASE_URL e DIRECT_URL no .env e rode "npm run setup" de novo.')
  // Interrompe o setup: sem as URLs o Prisma não tem onde criar as tabelas.
  process.exitCode = 1
}
