// Relatórios de vendas e financeiro, frete, vendedor e forma de pagamento.
import { chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

const diaLocal = (d) => d.toLocaleDateString('sv-SE')
const hoje = diaLocal(new Date())
const ontem = diaLocal(new Date(Date.now() - 864e5))
const amanha = diaLocal(new Date(Date.now() + 864e5))

await entrarComoAdmin()
const marca = `RR${Date.now().toString(36)}`
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: `${marca} Cliente` })).json
const prod = (await chamar('POST', '/produtos', { sku: marca, nome: 'Produto relatório', precoCusto: 100, precoVenda: 1000 })).json
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: prod.id, quantidade: 20, custoUnitario: 100 }] })
const novoPedido = async (extra) => (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: prod.id, quantidade: 2, precoUnitario: 1000 }], ...extra })).json

const vendedor = (await chamar('POST', '/pessoas', { vendedor: true, nome: `${marca} Vendedor` })).json
const a = await novoPedido({ frete: 1000, desconto: 500, observacao: '=obs com sinal', vendedorId: vendedor.id })
conferir('frete entra no total', a.total === 2500 && a.frete === 1000 && a.subtotal === 2000, `total=${a.total}`)
conferir('quem lançou fica no pedido; o vendedor é a pessoa escolhida', a.usuario?.nome === 'Administrador' && a.vendedor?.nome === vendedor.nome)
conferir('faturar sem forma de pagamento -> 400', (await chamar('POST', `/pedidos/${a.id}/faturar`, { primeiroVencimento: hoje })).status === 400)
conferir('forma inválida -> 400', (await chamar('POST', `/pedidos/${a.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'CHEQUE' })).status === 400)
const fat = await chamar('POST', `/pedidos/${a.id}/faturar`, { parcelas: 2, primeiroVencimento: hoje, formaPagamento: 'PIX' })
conferir('faturar grava a forma', fat.json.formaPagamento === 'PIX')
const parcelas = (await chamar('GET', `/pedidos/${a.id}`)).json.contasReceber
conferir('parcelas somam total com frete', parcelas.reduce((s, c) => s + c.valor, 0) === 2500)

const b = await novoPedido({})
await chamar('POST', `/pedidos/${b.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'BOLETO' })
const c = await novoPedido({})
await chamar('POST', `/pedidos/${c.id}/cancelar`)

const rel = async (qs) => (await chamar('GET', `/relatorios/vendas?busca=${encodeURIComponent(marca)}${qs}`)).json
let r = await rel('')
conferir('relatório acha os 3 pedidos', r.linhas.length === 3 && r.resumo.quantidade === 3)
conferir('resumo ignora cancelado', r.resumo.cancelados === 1 && r.resumo.total === 4500 && r.resumo.ticketMedio === 2250, JSON.stringify(r.resumo))
let la = r.linhas.find((l) => l.id === a.id)
conferir('linha traz vendedor, forma e frete', la.vendedor === vendedor.nome && la.natureza === 'VENDA' && la.formaPagamento === 'PIX' && la.frete === 1000 && la.cliente.startsWith(marca))
conferir('sem quitar não há data de pagamento', la.pagoEm === null)
await chamar('POST', `/contas-receber/${parcelas[0].id}/baixar`)
conferir('quitação parcial ainda sem data', (await rel('')).linhas.find((l) => l.id === a.id).pagoEm === null)
await chamar('POST', `/contas-receber/${parcelas[1].id}/baixar`)
conferir('quitado tem data de pagamento', !!(await rel('')).linhas.find((l) => l.id === a.id).pagoEm)

conferir('filtro por situação', (await rel('&status=FATURADO')).linhas.length === 2 && (await rel('&status=CANCELADO')).linhas.length === 1)
conferir('período de hoje inclui', (await rel(`&inicio=${hoje}&fim=${hoje}`)).linhas.length === 3)
conferir('até ontem exclui', (await rel(`&fim=${ontem}`)).linhas.length === 0)
conferir('a partir de amanhã exclui', (await rel(`&inicio=${amanha}`)).linhas.length === 0)
const porNumero = (await chamar('GET', `/relatorios/vendas?busca=${encodeURIComponent('#' + b.numero)}`)).json
conferir('busca por número do pedido', porNumero.linhas.some((l) => l.id === b.id))
conferir('busca por observação', (await chamar('GET', '/relatorios/vendas?busca=obs%20com%20sinal')).json.linhas.some((l) => l.id === a.id))
conferir('busca ignora maiúsculas e minúsculas', (await chamar('GET', '/relatorios/vendas?busca=OBS%20COM%20SINAL')).json.linhas.some((l) => l.id === a.id) && (await chamar('GET', `/relatorios/vendas?busca=${encodeURIComponent(marca.toLowerCase())}`)).json.linhas.length === 3)
conferir('data inválida -> 400', (await chamar('GET', '/relatorios/vendas?inicio=07/10/2026')).status === 400)

const fin = async (qs) => (await chamar('GET', `/relatorios/financeiro?busca=${encodeURIComponent(marca)}${qs}`)).json
r = await fin('')
conferir('financeiro lista as 3 parcelas', r.linhas.length === 3 && r.linhas.every((l) => l.tipo === 'RECEBER'), `n=${r.linhas.length}`)
conferir('resumo financeiro', r.resumo.recebido === 2500 && r.resumo.aReceber === 2000 && r.resumo.pago === 0, JSON.stringify(r.resumo))
conferir('filtro tipo pagar', (await fin('&tipo=PAGAR')).linhas.length === 0)
conferir('filtro situação paga', (await fin('&status=PAGA')).linhas.length === 2)
conferir('vencimento fora do período', (await fin(`&inicio=${amanha}`)).linhas.length === 1, 'segunda parcela vence no mês seguinte')
conferir('sem token -> 401', ((sessao.token = ''), (await chamar('GET', '/relatorios/vendas')).status === 401))

encerrar()
