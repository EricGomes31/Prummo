// Confere o saldo de cada produto com o saldo atual do SG Nexus e, onde diferir, lança um ajuste de estoque.
// Uso: npm run vps -- npx tsx --env-file=.env.producao scripts/acertar-saldos.mjs --empresa=<id> <produtos.json> <saldos.json> [--gravar]
// saldos.json é { idDoProdutoNoSgNexus: saldo na unidade base } (scripts/sgnexus/baixar-saldos.mjs).
// Sem --gravar só mostra as diferenças. Rode depois de uma importação complementar de vendas.
import { readFileSync } from 'node:fs'
import { naEmpresa, prisma } from './empresa.mjs'

await naEmpresa(async (argumentos) => {
  const gravar = argumentos.includes('--gravar')
  const [arquivoProdutos, arquivoSaldos] = argumentos.filter((a) => !a.startsWith('--'))
  if (!arquivoSaldos) {
    console.error('Informe produtos.json e saldos.json.')
    process.exitCode = 1
    return
  }
  const produtos = JSON.parse(readFileSync(arquivoProdutos, 'utf8'))
  const saldos = JSON.parse(readFileSync(arquivoSaldos, 'utf8'))
  const hoje = new Date().toLocaleDateString('pt-BR')
  let diferentes = 0

  for (const o of produtos) {
    if (saldos[o.id] === undefined || Number.isNaN(Number(saldos[o.id]))) {
      console.log(`${o.codigo}: sem saldo no SG Nexus, ignorado`)
      continue
    }
    const produto = await prisma.produto.findFirst({ where: { sku: o.codigo } })
    if (!produto) {
      console.log(`${o.codigo}: não existe no Prumo, ignorado`)
      continue
    }
    if (!produto.controlaEstoque) continue
    const alvo = Math.round(Number(saldos[o.id]) * produto.divisor)
    const diferenca = alvo - produto.saldo
    if (diferenca === 0) continue
    diferentes++
    console.log(`${o.codigo} ${produto.nome}: Prumo ${produto.saldo / produto.divisor}, SG Nexus ${alvo / produto.divisor} (${diferenca > 0 ? '+' : ''}${diferenca / produto.divisor})`)
    if (!gravar) continue
    await prisma.$transaction(async (tx) => {
      await tx.produto.update({ where: { id: produto.id }, data: { saldo: alvo } })
      await tx.movimentoEstoque.create({
        data: {
          produtoId: produto.id,
          tipo: 'AJUSTE',
          quantidade: diferenca,
          saldoApos: alvo,
          origem: 'AJUSTE',
          observacao: `Acerto com o saldo do SG Nexus em ${hoje}`,
        },
      })
    })
  }
  console.log(diferentes === 0 ? 'Todos os saldos conferem.' : `${diferentes} produto(s) com diferença${gravar ? ', acertados.' : ' (rode com --gravar para acertar).'}`)
})
