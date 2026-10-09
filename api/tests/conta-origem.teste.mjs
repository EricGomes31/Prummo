// Uma conta com a origem dela (venda, entrada de estoque ou despesa), para a janela de baixa.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

const hoje = new Date().toLocaleDateString('sv-SE')
await entrarComoAdmin()
const marca = `CO${Date.now().toString(36)}`
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: `${marca} Cliente` })).json
const vendedor = (await chamar('POST', '/pessoas', { vendedor: true, nome: `${marca} Vendedor` })).json
const fornecedor = (await chamar('POST', '/pessoas', { fornecedor: true, nome: `${marca} Fornecedor` })).json
const prod = (await chamar('POST', '/produtos', { sku: marca, nome: 'Produto origem', precoCusto: 100, precoVenda: 1000 })).json

const entrada = (await chamar('POST', '/entradas', { fornecedorId: fornecedor.id, data: hoje, numeroDocumento: 'NF 77', condicaoPagamento: '30', itens: [{ produtoId: prod.id, quantidade: 5, custoUnitario: 100 }] })).json
const pedido = (await chamar('POST', '/pedidos', { clienteId: cliente.id, vendedorId: vendedor.id, observacao: 'entregar cedo', formaPagamento: 'PIX', primeiroVencimento: hoje, itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 1000 }] })).json
await chamar('POST', `/pedidos/${pedido.id}/faturar`, {})

const receber = (await chamar('GET', `/contas-receber?pessoaId=${cliente.id}`)).json[0]
const r = await chamar('GET', `/contas-receber/${receber.id}`)
conferir('conta a receber traz a venda', r.status === 200 && r.json.pedido?.numero === pedido.numero && r.json.pedido.vendedor?.nome === vendedor.nome && r.json.pedido.observacao === 'entregar cedo' && r.json.pessoa?.nome === cliente.nome, JSON.stringify(r.json))

const pagarEntrada = (await chamar('GET', `/contas-pagar?pessoaId=${fornecedor.id}`)).json.find((c) => c.descricao.startsWith('Entrada'))
const p = await chamar('GET', `/contas-pagar/${pagarEntrada.id}`)
conferir('conta a pagar traz a entrada', p.status === 200 && p.json.entrada?.id === entrada.id && p.json.entrada.numeroDocumento === 'NF 77' && p.json.despesa === null, JSON.stringify(p.json))

await chamar('POST', '/despesas', { fornecedorId: fornecedor.id, elemento: 'Aluguel', descricao: 'Aluguel de outubro', numeroDocumento: 'BOL-9', dataEmissao: hoje, dataCompetencia: hoje, formaPagamento: 'BOLETO', valor: 50000, condicaoPagamento: 'A_VISTA' })
const pagarDespesa = (await chamar('GET', `/contas-pagar?pessoaId=${fornecedor.id}`)).json.find((c) => c.descricao.startsWith('Despesa'))
const d = await chamar('GET', `/contas-pagar/${pagarDespesa.id}`)
conferir('conta a pagar traz a despesa', d.status === 200 && d.json.despesa?.elemento === 'Aluguel' && d.json.despesa.numeroDocumento === 'BOL-9', JSON.stringify(d.json))

conferir('conta inexistente -> 404', (await chamar('GET', '/contas-receber/999999')).status === 404)

await encerrar()
