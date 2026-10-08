// Unidades extras com fator de conversão e saldo fracionado exato.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

await entrarComoAdmin()
const hoje = new Date().toLocaleDateString('sv-SE')
const produto = async (id) => (await chamar('GET', '/produtos')).json.find((p) => p.id === id)
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente Unidades' })).json
const faturar = (id) => chamar('POST', `/pedidos/${id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'PIX' })

// Cadastro
const baseProd = { nome: 'Caixa de ampolas', unidade: 'CX', precoVenda: 20000 }
conferir('unidade base repetida -> 400', (await chamar('POST', '/produtos', { ...baseProd, unidades: [{ sigla: 'CX', fator: 2 }] })).status === 400)
conferir('sigla repetida -> 400', (await chamar('POST', '/produtos', { ...baseProd, unidades: [{ sigla: 'AMP', fator: 2 }, { sigla: 'AMP', fator: 4 }] })).status === 400)
conferir('fator 1 -> 400', (await chamar('POST', '/produtos', { ...baseProd, unidades: [{ sigla: 'AMP', fator: 1 }] })).status === 400)
conferir('fatores que não combinam -> 400', (await chamar('POST', '/produtos', { ...baseProd, unidades: [{ sigla: 'AMP', fator: 9973 }, { sigla: 'UN', fator: 9967 }] })).status === 400)
const criado = await chamar('POST', '/produtos', { ...baseProd, unidades: [{ sigla: 'UN', fator: 12, precoVenda: 1900 }, { sigla: 'AMP', fator: 4 }] })
const P = criado.json
conferir('cria com unidades e divisor = mmc', criado.status === 201 && P.divisor === 12 && P.unidades.map((u) => `${u.sigla}:${u.fator}:${u.precoVenda}`).join() === 'AMP:4:null,UN:12:1900', JSON.stringify(P.unidades ?? P))

// Entradas em unidades diferentes
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: P.id, quantidade: 2, custoUnitario: 12000 }] })
let p = await produto(P.id)
conferir('entrada na base: 2 CX = 24 partes', p.saldo === 24 && p.precoCusto === 12000)
const entradaAmp = await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: P.id, unidade: 'AMP', quantidade: 3, custoUnitario: 3100 }] })
p = await produto(P.id)
conferir('entrada em AMP soma 3/4 CX e custo vira por CX', entradaAmp.status === 201 && p.saldo === 33 && p.precoCusto === 12400 && entradaAmp.json.total === 9300 && entradaAmp.json.itens[0].unidade === 'AMP' && entradaAmp.json.itens[0].fator === 4)
conferir('unidade que o produto não tem -> 400', (await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: P.id, unidade: 'KG', quantidade: 1, custoUnitario: 1 }] })).status === 400)
conferir('mesmo produto, mesma unidade, duas linhas -> 400', (await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: P.id, unidade: 'AMP', quantidade: 1, custoUnitario: 1 }, { produtoId: P.id, unidade: 'AMP', quantidade: 1, custoUnitario: 1 }] })).status === 400)

// Venda do mesmo produto em duas unidades
const ped = await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: P.id, quantidade: 1, precoUnitario: 20000 }, { produtoId: P.id, unidade: 'AMP', quantidade: 5, precoUnitario: 5000 }] })
conferir('pedido aceita o produto em duas unidades', ped.status === 201 && ped.json.subtotal === 45000 && ped.json.itens.map((i) => `${i.unidade}:${i.fator}`).sort().join() === 'AMP:4,CX:1', JSON.stringify(ped.json?.erro ?? ''))
conferir('faturar', (await faturar(ped.json.id)).status === 200)
p = await produto(P.id)
conferir('baixa 1 CX + 5 AMP = 27 partes; sobra meia caixa', p.saldo === 6)
const itensFat = (await chamar('GET', `/pedidos/${ped.json.id}`)).json.itens
conferir('custo histórico na unidade do item', itensFat.find((i) => i.unidade === 'CX').custoUnitario === 12400 && itensFat.find((i) => i.unidade === 'AMP').custoUnitario === 3100)
conferir('dashboard usa o custo por unidade lançada', (await chamar('GET', '/dashboards/comercial')).json.kpis.custo === 12400 + 5 * 3100)

const demais = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: P.id, unidade: 'AMP', quantidade: 3, precoUnitario: 5000 }] })).json
const semSaldo = await faturar(demais.id)
conferir('3 AMP com meia caixa -> 409 em unidade base', semSaldo.status === 409 && semSaldo.json.erro.includes('saldo 0,5 CX') && semSaldo.json.erro.includes('pedido 0,75 CX'), semSaldo.json?.erro)
const exato = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: P.id, unidade: 'UN', quantidade: 6, precoUnitario: 1900 }] })).json
conferir('6 UN (de 12 por caixa) zeram a meia caixa', (await faturar(exato.id)).status === 200 && (await produto(P.id)).saldo === 0)
const mov = (await chamar('GET', `/produtos/${P.id}/movimentos`)).json
conferir('movimentações na unidade base', mov[0].tipo === 'SAIDA' && mov[0].quantidade === 0.5 && mov[0].saldoApos === 0 && mov.at(-1).quantidade === 2, JSON.stringify(mov.map((m) => m.quantidade)))
conferir('cancelar devolve a fração', (await chamar('POST', `/pedidos/${exato.id}/cancelar`)).json.status === 'CANCELADO' && (await produto(P.id)).saldo === 6)
const ajuste = await chamar('POST', `/produtos/${P.id}/ajuste`, { novoSaldo: 1.25 })
conferir('ajuste fracionado na base', ajuste.json.saldo === 15 && (await chamar('GET', `/produtos/${P.id}/movimentos`)).json[0].quantidade === 0.75)

// Terços: sem sobra de arredondamento
const T = (await chamar('POST', '/produtos', { nome: 'Kit de três', unidade: 'KIT', precoVenda: 9000, unidades: [{ sigla: 'UN', fator: 3 }] })).json
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: T.id, quantidade: 1, custoUnitario: 3000 }] })
for (let n = 0; n < 3; n++) {
  const t = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: T.id, unidade: 'UN', quantidade: 1, precoUnitario: 3000 }] })).json
  await faturar(t.id)
}
conferir('três terços zeram o saldo exatamente', (await produto(T.id)).saldo === 0)
const quarto = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: T.id, unidade: 'UN', quantidade: 1, precoUnitario: 3000 }] })).json
conferir('o quarto terço não tem saldo -> 409', (await faturar(quarto.id)).status === 409)

// Unidade criada depois de já haver estoque
const S = (await chamar('POST', '/produtos', { nome: 'Simples', precoVenda: 1000 })).json
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: S.id, quantidade: 5, custoUnitario: 400 }] })
const valorAntes = (await chamar('GET', '/dashboard/resumo')).json.estoque.valor
const comUnidade = await chamar('PUT', `/produtos/${S.id}`, { nome: 'Simples', precoVenda: 1000, unidades: [{ sigla: 'AMP', fator: 3 }] })
conferir('nova unidade reescala saldo e histórico', comUnidade.json.divisor === 3 && comUnidade.json.saldo === 15 && (await chamar('GET', `/produtos/${S.id}/movimentos`)).json[0].quantidade === 5 && comUnidade.json.precoCusto === 400)
conferir('valor do estoque não muda com a reescala', (await chamar('GET', '/dashboard/resumo')).json.estoque.valor === valorAntes)
// Com estoque mínimo de 2 CX, 1,25 CX entra nos alertas; com mínimo 1, não entra.
const unidadesP = [{ sigla: 'UN', fator: 12, precoVenda: 1900 }, { sigla: 'AMP', fator: 4 }]
await chamar('PUT', `/produtos/${P.id}`, { ...baseProd, estoqueMinimo: 2, unidades: unidadesP })
let resumo = (await chamar('GET', '/dashboard/resumo')).json
conferir('início mostra saldo na unidade base', resumo.estoque.criticos.find((c) => c.id === P.id)?.saldo === 1.25, JSON.stringify(resumo.estoque.criticos))
const mesmoDivisor = await chamar('PUT', `/produtos/${P.id}`, { ...baseProd, estoqueMinimo: 1, unidades: unidadesP })
resumo = (await chamar('GET', '/dashboard/resumo')).json
conferir('estoque mínimo compara na unidade base', !resumo.estoque.criticos.some((c) => c.id === P.id) && mesmoDivisor.json.saldo === 15 && mesmoDivisor.json.divisor === 12)
const semUnidade = await chamar('PUT', `/produtos/${S.id}`, { nome: 'Simples', precoVenda: 1000, unidades: [] })
conferir('remover a unidade mantém o divisor', semUnidade.json.divisor === 3 && semUnidade.json.saldo === 15 && semUnidade.json.unidades.length === 0)
conferir('unidade removida não vende mais -> 400', (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: S.id, unidade: 'AMP', quantidade: 1, precoUnitario: 1 }] })).status === 400)

// Promoções contam na unidade base
const dia = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('sv-SE')
const lp = (await chamar('POST', '/promocoes', { nome: 'Leve 2 CX', modalidade: 'LEVE_PAGUE', leve: 2, pague: 1, inicio: dia(-1), fim: dia(1), itens: [{ produtoId: P.id }] })).json
const sim = (id, itens) => chamar('POST', `/promocoes/${id}/simular`, { itens })
conferir('8 AMP = 2 CX: leve 2 pague 1', (await sim(lp.id, [{ produtoId: P.id, quantidade: 8, precoUnitario: 5000, fator: 4 }])).json.desconto === 20000)
conferir('7 AMP não completam 2 CX -> 400', (await sim(lp.id, [{ produtoId: P.id, quantidade: 7, precoUnitario: 5000, fator: 4 }])).status === 400)
conferir('1 CX + 4 AMP somam 2 CX', (await sim(lp.id, [{ produtoId: P.id, quantidade: 1, precoUnitario: 20000 }, { produtoId: P.id, quantidade: 4, precoUnitario: 5000, fator: 4 }])).json.desconto === 20000)
const pct = (await chamar('POST', '/promocoes', { nome: '10% a partir de 1 CX', modalidade: 'PERCENTUAL', percentual: 1000, inicio: dia(-1), fim: dia(1), itens: [{ produtoId: P.id, quantidade: 1 }] })).json
conferir('percentual: 4 AMP atingem 1 CX', (await sim(pct.id, [{ produtoId: P.id, quantidade: 4, precoUnitario: 5000, fator: 4 }])).json.desconto === 2000)
conferir('percentual: 3 AMP não atingem -> 400', (await sim(pct.id, [{ produtoId: P.id, quantidade: 3, precoUnitario: 5000, fator: 4 }])).status === 400)
const comPromo = await chamar('POST', '/pedidos', { clienteId: cliente.id, promocaoId: pct.id, itens: [{ produtoId: P.id, unidade: 'AMP', quantidade: 4, precoUnitario: 5000 }] })
conferir('pedido em AMP com campanha na base', comPromo.status === 201 && comPromo.json.descontoPromocao === 2000 && comPromo.json.total === 18000, JSON.stringify(comPromo.json?.erro ?? ''))

encerrar()
