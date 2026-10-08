// Importa motoristas e veículos do SG Nexus e completa as entregas já importadas com peso, coordenadas e horário.
// Uso: node --env-file=.env scripts/importar-logistica.mjs <pasta>
// A pasta deve ter infinity-motoristas.json, infinity-veiculos.json e infinity-entregas.json.
// Rode depois de importar-vendas. Motoristas e veículos que já existem (pelo nome ou pela placa) são ignorados.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const [pasta] = process.argv.slice(2)
if (!pasta) {
  console.error('Informe a pasta com os arquivos JSON.')
  process.exit(1)
}
const ler = (nome) => JSON.parse(readFileSync(path.join(pasta, nome), 'utf8'))
const prisma = new PrismaClient()
const limpo = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())
const hora = (v) => (v ? String(v).slice(0, 5) : null)
const resumo = { motoristas: 0, veiculos: 0, entregas: 0 }

for (const m of ler('infinity-motoristas.json')) {
  const nome = String(m.nome).trim()
  if (await prisma.motorista.findFirst({ where: { nome } })) continue
  await prisma.motorista.create({
    data: { nome, telefone: limpo(m.telefone), cnh: limpo(m.cnh), validadeCnh: m.validadeCnh ? new Date(`${String(m.validadeCnh).slice(0, 10)}T12:00:00`) : null, ativo: m.ativo !== false },
  })
  resumo.motoristas++
}

for (const v of ler('infinity-veiculos.json')) {
  const placa = String(v.placa).trim().toUpperCase()
  if (await prisma.veiculo.findUnique({ where: { placa } })) continue
  await prisma.veiculo.create({ data: { placa, descricao: limpo(v.descricao), capacidadeKg: Number(v.capacidadeKg), ativo: v.ativo !== false } })
  resumo.veiculos++
}

// As entregas já foram criadas pelo importador de vendas; aqui entram só os dados de rota que faltavam.
for (const e of ler('infinity-entregas.json')) {
  const { count } = await prisma.entrega.updateMany({
    where: { pedidoId: e.pedidoId, status: { not: 'CANCELADA' }, pesoKg: null },
    data: {
      pesoKg: e.pesoKg === null || e.pesoKg === undefined ? null : Number(e.pesoKg),
      latitude: e.latitude ?? null,
      longitude: e.longitude ?? null,
      inicioRecebimento: hora(e.inicioRecebimento),
      fimRecebimento: hora(e.fimRecebimento),
    },
  })
  resumo.entregas += count
}

console.log(JSON.stringify(resumo))
await prisma.$disconnect()
