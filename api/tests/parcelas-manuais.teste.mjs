// Parcelas com data e valor escolhidos à mão no pedido.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

await entrarComoAdmin()
const marca = `PM${Date.now().toString(36)}`
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: `${marca} Cliente` })).json
const prod = (await chamar('POST', '/produtos', { sku: marca, nome: 'Produto parcelas', precoCusto: 100, precoVenda: 10000 })).json
await chamar('POST', '/entradas', { data: '2026-01-05', itens: [{ produtoId: prod.id, quantidade: 50, custoUnitario: 100 }] })
const itens = (quantidade = 1) => [{ produtoId: prod.id, quantidade, precoUnitario: 10000 }]
const contasDe = async (id) => (await chamar('GET', `/pedidos/${id}`)).json.contasReceber.filter((c) => c.status !== 'CANCELADA')
const dataDe = (c) => c.vencimento.slice(0, 10)

// Pedido já com as parcelas escolhidas.
const vencimentos = [
  { vencimento: '2026-11-20', valor: 3000 },
  { vencimento: '2026-11-05', valor: 5000 },
  { vencimento: '2026-12-15', valor: 2000 },
]
const a = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: itens(), formaPagamento: 'BOLETO', vencimentos })).json
conferir('pedido guarda as parcelas em ordem de data', a.parcelas === 3 && a.primeiroVencimento.slice(0, 10) === '2026-11-05' && a.vencimentos[0].valor === 5000)
const fat = await chamar('POST', `/pedidos/${a.id}/faturar`, {})
conferir('fatura com as parcelas do pedido', fat.status === 200, JSON.stringify(fat.json))
let contas = await contasDe(a.id)
conferir('três contas com as datas e valores escolhidos', contas.length === 3 && contas.map(dataDe).join() === '2026-11-05,2026-11-20,2026-12-15' && contas.map((c) => c.valor).join() === '5000,3000,2000', JSON.stringify(contas.map((c) => [dataDe(c), c.valor])))
conferir('descrição numera as parcelas', contas[2].descricao.endsWith('parcela 3/3'))

// Soma diferente do total é recusada ao faturar.
const b = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: itens(), formaPagamento: 'PIX' })).json
const errado = await chamar('POST', `/pedidos/${b.id}/faturar`, { vencimentos: [{ vencimento: '2026-11-10', valor: 4000 }, { vencimento: '2026-12-10', valor: 4000 }] })
conferir('soma diferente do total -> 400 com os valores', errado.status === 400 && errado.json.erro?.includes('somam') && errado.json.erro.includes('80,00'), JSON.stringify(errado.json))
conferir('valor zero -> 400', (await chamar('POST', `/pedidos/${b.id}/faturar`, { vencimentos: [{ vencimento: '2026-11-10', valor: 0 }] })).status === 400)
conferir('data inválida -> 400', (await chamar('POST', `/pedidos/${b.id}/faturar`, { vencimentos: [{ vencimento: '10/11/2026', valor: 10000 }] })).status === 400)
conferir('pedido segue em aberto depois das recusas', (await chamar('GET', `/pedidos/${b.id}`)).json.status === 'ABERTO')

// Parcelas informadas só no faturamento.
const certo = await chamar('POST', `/pedidos/${b.id}/faturar`, { vencimentos: [{ vencimento: '2026-10-25', valor: 2500 }, { vencimento: '2026-11-25', valor: 7500 }] })
contas = await contasDe(b.id)
conferir('parcelas do faturamento valem', certo.status === 200 && contas.map((c) => c.valor).join() === '2500,7500' && certo.json.parcelas === 2)

// Mensais continuam como antes, e null volta às mensais.
const c = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: itens(), formaPagamento: 'PIX', vencimentos: [{ vencimento: '2026-11-01', valor: 10000 }] })).json
await chamar('POST', `/pedidos/${c.id}/faturar`, { vencimentos: null, parcelas: 2, primeiroVencimento: '2026-11-10' })
contas = await contasDe(c.id)
conferir('null volta às parcelas mensais iguais', contas.length === 2 && contas.map(dataDe).join() === '2026-11-10,2026-12-10' && contas.every((x) => x.valor === 5000), JSON.stringify(contas.map((x) => [dataDe(x), x.valor])))

// Alterar o pedido faturado trocando as parcelas refaz as contas.
const corpoA = { clienteId: cliente.id, natureza: 'VENDA', itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 10000 }], formaPagamento: 'BOLETO' }
const alt = await chamar('PUT', `/pedidos/${a.id}/faturado`, { motivo: 'Correção de teste', ...corpoA, vencimentos: [{ vencimento: '2027-01-10', valor: 10000 }] })
contas = await contasDe(a.id)
conferir('alterar as parcelas refaz as contas', alt.status === 200 && contas.length === 1 && dataDe(contas[0]) === '2027-01-10', JSON.stringify(alt.json))
// Mudar a quantidade sem ajustar as parcelas é recusado, porque elas não fecham o novo total.
const semAjuste = await chamar('PUT', `/pedidos/${a.id}/faturado`, { motivo: 'Correção de teste', ...corpoA, itens: itens(2) })
conferir('novo total sem ajustar as parcelas -> 400', semAjuste.status === 400, JSON.stringify(semAjuste.json))
conferir('e nada muda', (await contasDe(a.id)).map((x) => x.valor).join() === '10000')

// Entrada de estoque com parcelas à mão.
const fornecedor = (await chamar('POST', '/pessoas', { fornecedor: true, nome: `${marca} Fornecedor` })).json
const corpoEntrada = { fornecedorId: fornecedor.id, data: '2026-10-01', frete: 1000, itens: [{ produtoId: prod.id, quantidade: 10, custoUnitario: 500 }] }
const entrada = await chamar('POST', '/entradas', { ...corpoEntrada, parcelas: [{ vencimento: '2026-11-15', valor: 3500 }, { vencimento: '2026-10-31', valor: 2500 }] })
conferir('entrada com parcelas à mão', entrada.status === 201, JSON.stringify(entrada.json))
conferir('condição gravada são os dias de cada vencimento', entrada.json.condicaoPagamento === '30/45', entrada.json.condicaoPagamento)
const pagar = (await chamar('GET', `/entradas/${entrada.json.id}`)).json.contasPagar
conferir('contas a pagar com as datas e valores escolhidos', pagar.map((x) => `${x.vencimento.slice(0, 10)}=${x.valor}`).join() === '2026-10-31=2500,2026-11-15=3500', JSON.stringify(pagar))
const entradaErrada = await chamar('POST', '/entradas', { ...corpoEntrada, parcelas: [{ vencimento: '2026-11-01', valor: 5000 }] })
conferir('soma diferente do total da entrada -> 400', entradaErrada.status === 400 && entradaErrada.json.erro.includes('60,00'), JSON.stringify(entradaErrada.json))
conferir('condição e parcelas juntas -> 400', (await chamar('POST', '/entradas', { ...corpoEntrada, condicaoPagamento: '30', parcelas: [{ vencimento: '2026-11-01', valor: 6000 }] })).status === 400)
conferir('bonificação com parcelas -> 400', (await chamar('POST', '/entradas', { ...corpoEntrada, natureza: 'BONIFICACAO', frete: 0, parcelas: [{ vencimento: '2026-11-01', valor: 5000 }] })).status === 400)

await encerrar()
