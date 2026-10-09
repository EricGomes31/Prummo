// Empresa de destino dos importadores. Eles usam o mesmo cliente do Prisma da API (src/lib.ts), que
// acrescenta a empresa em toda consulta e gravação; por isso rodam pelo tsx, que lê o TypeScript:
//   npx tsx --env-file=.env.producao scripts/importar-<x>.mjs --empresa=<id> ...
// Sem --empresa, ou com uma empresa que não existe, lista as empresas e para.
import { prisma } from '../src/lib.js'
import { comEmpresa, semEmpresa } from '../src/empresa.js'

export { prisma }

// Separa --empresa=<id> dos demais argumentos e roda `importar` dentro da empresa escolhida.
export async function naEmpresa(importar) {
  const argumentos = process.argv.slice(2)
  const opcao = argumentos.find((a) => a.startsWith('--empresa='))
  const empresaId = Number(opcao?.slice('--empresa='.length))
  const empresas = await semEmpresa(() => prisma.empresa.findMany({ orderBy: { id: 'asc' } }))
  const empresa = empresas.find((e) => e.id === empresaId)
  if (!empresa) {
    console.error(opcao ? `Empresa ${opcao.slice('--empresa='.length)} não encontrada.` : 'Informe a empresa de destino com --empresa=<id>.')
    console.error('Empresas cadastradas:')
    for (const e of empresas) console.error(`  ${e.id}  ${e.nome}${e.ativa ? '' : ' (inativa)'}`)
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log(`Importando para a empresa ${empresa.id} (${empresa.nome}).`)
  try {
    await comEmpresa(empresa.id, () => importar(argumentos.filter((a) => a !== opcao), empresa))
  } finally {
    await prisma.$disconnect()
  }
}
