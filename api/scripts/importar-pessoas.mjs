// Importa pessoas de um arquivo JSON exportado do SG Nexus (resposta de GET /pessoas).
// Uso: node --env-file=.env scripts/importar-pessoas.mjs <arquivo.json> [--remover-exemplos]
// Pode ser rodado de novo: quem já existe com o mesmo nome, documento e celular é ignorado.
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const [arquivo, ...opcoes] = process.argv.slice(2)
if (!arquivo) {
  console.error('Informe o arquivo JSON com as pessoas.')
  process.exit(1)
}

const prisma = new PrismaClient()
const limpo = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())
const chave = (p) => [p.nome.toLowerCase(), p.documento ?? '', p.celular ?? ''].join('|')

const pessoas = JSON.parse(readFileSync(arquivo, 'utf8')).map((o) => ({
  nome: String(o.nomeRazaoSocial).trim(),
  nomeFantasia: limpo(o.nomeFantasia),
  documento: limpo(o.cpfCnpj),
  rgIe: limpo(o.rgInscricaoEstadual),
  email: limpo(o.email),
  telefone: limpo(o.telefone),
  celular: limpo(o.celular),
  cep: limpo(o.cep),
  logradouro: limpo(o.logradouro),
  numero: limpo(o.numero),
  complemento: limpo(o.complemento),
  bairro: limpo(o.bairro),
  cidade: limpo(o.cidade),
  uf: limpo(o.uf),
  cliente: !!o.cliente,
  fornecedor: !!o.fornecedor,
  prestador: !!o.prestadorServico,
  paciente: !!o.paciente,
  medico: !!o.medico,
  vendedor: !!o.vendedor,
  ativo: o.ativo !== false,
  criadoEm: o.criadoEm ? new Date(o.criadoEm) : new Date(),
}))

if (opcoes.includes('--remover-exemplos')) {
  // Só remove os cadastros de demonstração do seed que não foram usados em nenhum lançamento.
  const removidos = await prisma.pessoa.deleteMany({
    where: {
      nome: { in: ['Cliente Exemplo Ltda', 'Fornecedor Exemplo S.A.'] },
      pedidos: { none: {} },
      entradas: { none: {} },
      contasReceber: { none: {} },
      contasPagar: { none: {} },
    },
  })
  console.log(`Exemplos removidos: ${removidos.count}`)
}

const existentes = new Set((await prisma.pessoa.findMany({ select: { nome: true, documento: true, celular: true } })).map(chave))
const novas = pessoas.filter((p) => !existentes.has(chave(p)))
const criadas = await prisma.pessoa.createMany({ data: novas })

console.log(`No arquivo: ${pessoas.length} | importadas: ${criadas.count} | já existiam: ${pessoas.length - novas.length}`)
console.log(`Total de pessoas no banco: ${await prisma.pessoa.count()}`)
await prisma.$disconnect()
