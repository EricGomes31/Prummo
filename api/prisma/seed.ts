// Cria o administrador inicial e alguns cadastros fictícios para demonstração.
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const senha = process.env.SEED_ADMIN_PASSWORD
if (!senha || senha.length < 8) {
  throw new Error('Defina SEED_ADMIN_PASSWORD no .env (mínimo de 8 caracteres) antes de rodar o seed.')
}

await prisma.usuario.upsert({
  where: { email: 'admin@prumo.local' },
  update: {},
  create: { nome: 'Administrador', email: 'admin@prumo.local', perfil: 'ADMIN', senhaHash: await bcrypt.hash(senha, 10) },
})

// Recebimentos e pagamentos precisam de uma conta financeira; o caixa já vem criado.
if ((await prisma.contaFinanceira.count()) === 0) {
  await prisma.contaFinanceira.create({ data: { nome: 'Caixa', tipo: 'CAIXA' } })
}

if ((await prisma.produto.count()) === 0) {
  await prisma.produto.createMany({
    data: [
      { sku: 'P-001', nome: 'Produto exemplo A', precoCusto: 1250, precoVenda: 2490, estoqueMinimo: 5 },
      { sku: 'P-002', nome: 'Produto exemplo B', precoCusto: 3400, precoVenda: 5990, estoqueMinimo: 3 },
      { sku: 'P-003', nome: 'Produto exemplo C', unidade: 'CX', precoCusto: 8900, precoVenda: 14900, estoqueMinimo: 2 },
    ],
  })
  await prisma.pessoa.createMany({
    data: [
      { cliente: true, nome: 'Cliente Exemplo Ltda', cidade: 'São Paulo', uf: 'SP' },
      { fornecedor: true, nome: 'Fornecedor Exemplo S.A.', cidade: 'Curitiba', uf: 'PR' },
    ],
  })
}

console.log('Seed concluído. Usuário: admin@prumo.local')
await prisma.$disconnect()
