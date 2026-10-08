// Cria a empresa inicial, o administrador do sistema e alguns cadastros fictícios para demonstração.
// Usa o cliente do Prisma sem o filtro de empresa, por isso informa a empresa em cada gravação.
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const senha = process.env.SEED_ADMIN_PASSWORD
if (!senha || senha.length < 8) {
  throw new Error('Defina SEED_ADMIN_PASSWORD no .env (mínimo de 8 caracteres) antes de rodar o seed.')
}

const empresa = (await prisma.empresa.findFirst({ orderBy: { id: 'asc' } })) ?? (await prisma.empresa.create({ data: { nome: 'Empresa padrão' } }))
const empresaId = empresa.id

await prisma.usuario.upsert({
  where: { email: 'admin@prumo.local' },
  update: {},
  create: { empresaId, sistema: true, nome: 'Administrador', email: 'admin@prumo.local', perfil: 'ADMIN', senhaHash: await bcrypt.hash(senha, 10) },
})

// Recebimentos e pagamentos precisam de uma conta financeira; o caixa já vem criado.
if ((await prisma.contaFinanceira.count({ where: { empresaId } })) === 0) {
  await prisma.contaFinanceira.create({ data: { empresaId, nome: 'Caixa', tipo: 'CAIXA' } })
}

if ((await prisma.produto.count({ where: { empresaId } })) === 0) {
  await prisma.produto.createMany({
    data: [
      { empresaId, sku: 'P-001', nome: 'Produto exemplo A', precoCusto: 1250, precoVenda: 2490, estoqueMinimo: 5 },
      { empresaId, sku: 'P-002', nome: 'Produto exemplo B', precoCusto: 3400, precoVenda: 5990, estoqueMinimo: 3 },
      { empresaId, sku: 'P-003', nome: 'Produto exemplo C', unidade: 'CX', precoCusto: 8900, precoVenda: 14900, estoqueMinimo: 2 },
    ],
  })
  await prisma.pessoa.createMany({
    data: [
      { empresaId, cliente: true, nome: 'Cliente Exemplo Ltda', cidade: 'São Paulo', uf: 'SP' },
      { empresaId, fornecedor: true, nome: 'Fornecedor Exemplo S.A.', cidade: 'Curitiba', uf: 'PR' },
    ],
  })
}

console.log(`Seed concluído. Empresa: ${empresa.nome}. Usuário: admin@prumo.local`)
await prisma.$disconnect()
