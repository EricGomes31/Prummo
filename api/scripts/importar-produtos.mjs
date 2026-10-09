// Importa produtos de um arquivo JSON exportado do SG Nexus (resposta de GET /produtos).
// Uso: npx tsx --env-file=.env.producao scripts/importar-produtos.mjs --empresa=<id> <produtos.json> [saldos.json] [--remover-exemplos]
// saldos.json é um objeto { idDoProdutoNoSgNexus: saldo na unidade base }; gera um ajuste de inventário inicial.
// Pode ser rodado de novo: produtos cujo código já existe na empresa são ignorados.
import { readFileSync } from 'node:fs'
import { naEmpresa, prisma } from './empresa.mjs'

const UNIDADES = ['UN', 'CX', 'FR', 'AMP', 'PCT', 'KIT', 'PAR', 'DZ', 'KG', 'G', 'L', 'ML', 'M', 'SV']
// Siglas do SG Nexus que têm outro nome no Prumo.
const SIGLAS = { AMPOLA: 'AMP', FRASCO: 'FR', CAIXA: 'CX', UNIDADE: 'UN', PACOTE: 'PCT' }
const sigla = (s) => {
  const convertida = SIGLAS[String(s).toUpperCase()] ?? String(s).toUpperCase()
  if (!UNIDADES.includes(convertida)) throw new Error(`Unidade desconhecida: ${s}`)
  return convertida
}
const centavos = (v) => Math.round(Number(v ?? 0) * 100)
const mdc = (a, b) => (b === 0 ? a : mdc(b, a % b))
const mmc = (a, b) => (a * b) / mdc(a, b)

await naEmpresa(async (argumentos) => {
  const [arquivo, arquivoSaldos] = argumentos.filter((a) => !a.startsWith('--'))
  if (!arquivo) {
    console.error('Informe o arquivo JSON com os produtos.')
    process.exitCode = 1
    return
  }

  const saldos = arquivoSaldos ? JSON.parse(readFileSync(arquivoSaldos, 'utf8')) : {}
  const produtos = JSON.parse(readFileSync(arquivo, 'utf8'))

  if (argumentos.includes('--remover-exemplos')) {
    // Só remove os produtos de demonstração do seed que nunca foram movimentados.
    const removidos = await prisma.produto.deleteMany({
      where: {
        sku: { in: ['P-001', 'P-002', 'P-003'] },
        nome: { startsWith: 'Produto exemplo' },
        movimentos: { none: {} },
        itensPedido: { none: {} },
        itensEntrada: { none: {} },
        promocoes: { none: {} },
      },
    })
    console.log(`Exemplos removidos: ${removidos.count}`)
  }

  const existentes = new Set((await prisma.produto.findMany({ select: { sku: true } })).map((p) => p.sku))
  let importados = 0
  let comSaldo = 0

  for (const o of produtos) {
    if (existentes.has(o.codigo)) continue
    // No SG Nexus a conversão é { SIGLA: quantas cabem em 1 unidade base }, o mesmo sentido do fator do Prumo.
    const unidades = Object.entries(o.unidadesConversao ?? {}).map(([s, fator]) => ({ sigla: sigla(s), fator: Number(fator) }))
    const divisor = unidades.map((u) => u.fator).reduce(mmc, 1)
    const saldo = Math.round(Number(saldos[o.id] ?? 0) * divisor)

    await prisma.$transaction(async (tx) => {
      const produto = await tx.produto.create({
        data: {
          sku: o.codigo,
          nome: String(o.descricao).trim(),
          ean: o.ean || null,
          unidade: sigla(o.unidade),
          controlaEstoque: o.controlaEstoque !== false,
          precoCusto: centavos(o.custoAtual),
          precoVenda: centavos(o.precoVenda),
          divisor,
          saldo: o.controlaEstoque !== false ? saldo : 0,
          ativo: o.ativo !== false,
          criadoEm: o.criadoEm ? new Date(o.criadoEm) : new Date(),
          unidades: { create: unidades },
        },
      })
      if (produto.saldo > 0) {
        await tx.movimentoEstoque.create({
          data: {
            produtoId: produto.id,
            tipo: 'AJUSTE',
            quantidade: produto.saldo,
            saldoApos: produto.saldo,
            origem: 'AJUSTE',
            observacao: 'Saldo inicial importado do SG Nexus',
          },
        })
        comSaldo++
      }
    })
    importados++
  }

  console.log(`No arquivo: ${produtos.length} | importados: ${importados} | já existiam: ${produtos.length - importados} | com saldo inicial: ${comSaldo}`)
  console.log(`Total de produtos na empresa: ${await prisma.produto.count()}`)
})
