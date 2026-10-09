// Dashboards comercial e financeiro, conferidos contra um cenário calculado à mão.
import { chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

const agora = new Date()
const hoje = agora.toLocaleDateString('sv-SE')
const mes = hoje.slice(0, 7)
const anterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1).toLocaleDateString('sv-SE').slice(0, 7)

await entrarComoAdmin()
const c1 = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente Um' })).json
const c2 = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente Dois' })).json
const forn = (await chamar('POST', '/pessoas', { fornecedor: true, nome: 'Fornecedor' })).json
const pa = (await chamar('POST', '/produtos', { sku: 'A', nome: 'Alfa', precoCusto: 0, precoVenda: 1000 })).json
const pb = (await chamar('POST', '/produtos', { sku: 'B', nome: 'Beta', precoCusto: 0, precoVenda: 5000 })).json
await chamar('POST', '/entradas', { fornecedorId: forn.id, data: hoje, condicaoPagamento: '0', itens: [{ produtoId: pa.id, quantidade: 10, custoUnitario: 400 }, { produtoId: pb.id, quantidade: 10, custoUnitario: 2000 }] })

// Pedido 1: 3×Alfa (3000) − 200 desconto + 500 frete = 3300; custo 1200
const p1 = (await chamar('POST', '/pedidos', { clienteId: c1.id, desconto: 200, frete: 500, itens: [{ produtoId: pa.id, quantidade: 3, precoUnitario: 1000 }] })).json
await chamar('POST', `/pedidos/${p1.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'PIX' })
// O custo do produto muda depois da venda; a margem do pedido 1 não pode mudar.
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: pa.id, quantidade: 1, custoUnitario: 900 }] })
// Pedido 2: 1×Beta (5000) + 1×Alfa (1000) = 6000; custo 2000 + 900
const p2 = (await chamar('POST', '/pedidos', { clienteId: c2.id, itens: [{ produtoId: pb.id, quantidade: 1, precoUnitario: 5000 }, { produtoId: pa.id, quantidade: 1, precoUnitario: 1000 }] })).json
await chamar('POST', `/pedidos/${p2.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'BOLETO' })
// Pedido 3 cancelado e pedido 4 em aberto não entram.
const p3 = (await chamar('POST', '/pedidos', { clienteId: c1.id, itens: [{ produtoId: pb.id, quantidade: 1, precoUnitario: 5000 }] })).json
await chamar('POST', `/pedidos/${p3.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'PIX' })
await chamar('POST', `/pedidos/${p3.id}/cancelar`)
await chamar('POST', '/pedidos', { clienteId: c1.id, itens: [{ produtoId: pb.id, quantidade: 1, precoUnitario: 5000 }] })

let d = (await chamar('GET', `/dashboards/comercial?mes=${mes}`)).json
const k = d.kpis
conferir('faturamento e vendas', k.faturamento === 9300 && k.vendas === 2 && k.ticketMedio === 4650, JSON.stringify(k))
conferir('descontos e frete', k.descontos === 200 && k.frete === 500)
conferir('custo histórico', k.custo === 1200 + 2900, `custo=${k.custo}`)
conferir('margem sem frete', k.margem === 9300 - 500 - 4100 && k.margemPercentual === 53.4, `margem=${k.margem} ${k.margemPercentual}%`)
const diaHoje = d.detalhe[agora.getDate() - 1]
conferir('vendas por dia', d.detalhe.length === new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate() && diaHoje.chave === String(agora.getDate()) && diaHoje.total === 9300 && diaHoje.vendas === 2 && d.detalhe.reduce((s, x) => s + x.total, 0) === 9300)
conferir('evolução tem 6 meses e termina no mês', d.historico.length === 6 && d.historico[5].chave === mes && d.historico[5].total === 9300 && d.historico[4].chave === anterior && d.historico[4].total === 0)
conferir('top clientes em ordem', d.topClientes.length === 2 && d.topClientes[0].nome === 'Cliente Dois' && d.topClientes[0].total === 6000 && d.topClientes[1].total === 3300)
conferir('top produtos por valor dos itens', d.topProdutos[0].nome === 'B · Beta' && d.topProdutos[0].total === 5000 && d.topProdutos[1].total === 4000, JSON.stringify(d.topProdutos))
conferir('top vendedores', d.topVendedores.length === 1 && d.topVendedores[0].nome === 'Sem vendedor' && d.topVendedores[0].total === 9300)
const ant = (await chamar('GET', `/dashboards/comercial?mes=${anterior}`)).json
conferir('mês anterior vazio', ant.kpis.faturamento === 0 && ant.kpis.margemPercentual === 0 && ant.topClientes.length === 0 && ant.historico[5].chave === anterior)
conferir('sem parâmetro usa o mês atual', (await chamar('GET', '/dashboards/comercial')).json.periodo.chave === mes)
const vendasDoDia = (await chamar('GET', `/dashboards/comercial/vendas?inicio=${hoje}&fim=${hoje}`)).json
conferir('vendas do dia do gráfico: só as faturadas, com cliente e total', vendasDoDia.map((v) => `${v.numero}:${v.cliente}:${v.total}`).join() === `${p1.numero}:Cliente Um:3300,${p2.numero}:Cliente Dois:6000`, JSON.stringify(vendasDoDia))
conferir('vendas do gráfico sem datas -> 400', (await chamar('GET', '/dashboards/comercial/vendas')).status === 400)
conferir('mês inválido -> 400', (await chamar('GET', '/dashboards/comercial?mes=2026-13')).status === 400)

// Financeiro: recebe o pedido 1 (3300, Pix), um avulso (700) e paga a entrada (24000 = 10×400 + 10×2000).
const receber = (await chamar('GET', '/contas-receber')).json
await chamar('POST', `/contas-receber/${receber.find((c) => c.pedidoId === p1.id).id}/baixar`)
const avulsa = (await chamar('POST', '/contas-receber', { descricao: 'Serviço avulso', valor: 700, vencimento: hoje })).json
await chamar('POST', `/contas-receber/${avulsa.id}/baixar`)
const pagar = (await chamar('GET', '/contas-pagar')).json
await chamar('POST', `/contas-pagar/${pagar[0].id}/baixar`)
await chamar('POST', '/contas-pagar', { descricao: 'Aluguel atrasado', valor: 1500, vencimento: '2020-01-10' })

const f = (await chamar('GET', `/dashboards/financeiro?mes=${mes}`)).json
conferir('recebido, pago e saldo', f.kpis.recebido === 4000 && f.kpis.pago === 24000 && f.kpis.saldo === -20000, JSON.stringify(f.kpis))
conferir('a receber no mês', f.kpis.aReceber === 6000 && f.kpis.aPagar === 0)
conferir('vencido a pagar', f.kpis.vencidoPagar === 1500 && f.kpis.vencidoReceber === 0)
conferir('histórico financeiro', f.historico.length === 6 && f.historico[5].recebido === 4000 && f.historico[5].pago === 24000 && f.historico[4].recebido === 0)
conferir('formas de pagamento', f.formas.length === 2 && f.formas[0].nome === 'PIX' && f.formas[0].total === 3300 && f.formas[1].nome === 'OUTROS' && f.formas[1].total === 700, JSON.stringify(f.formas))
// Ano e todo o período
const ano = hoje.slice(0, 4)
const doAno = (await chamar('GET', `/dashboards/comercial?ano=${ano}`)).json
conferir('ano: detalhe pelos 12 meses e histórico de 6 anos', doAno.periodo.tipo === 'ano' && doAno.kpis.faturamento === 9300 && doAno.detalhe.length === 12 && doAno.detalhe.find((m) => m.chave === mes).total === 9300 && doAno.historico.length === 6 && doAno.historico[5].chave === ano)
const tudo = (await chamar('GET', '/dashboards/comercial?tudo=1')).json
conferir('todo o período: anos com lançamento até o atual', tudo.periodo.tipo === 'tudo' && tudo.kpis.faturamento === 9300 && tudo.detalhe.at(-1).chave === ano && tudo.detalhe.at(-1).total === 9300)
const financeiroTudo = (await chamar('GET', '/dashboards/financeiro?tudo=1')).json
conferir('financeiro em todo o período', financeiroTudo.kpis.recebido === 4000 && financeiroTudo.kpis.pago === 24000 && financeiroTudo.kpis.aReceber === 6000)
conferir('ano inválido -> 400', (await chamar('GET', '/dashboards/comercial?ano=26')).status === 400)
conferir('sem token -> 401', ((sessao.token = ''), (await chamar('GET', '/dashboards/financeiro')).status === 401))

encerrar()
