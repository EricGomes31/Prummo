// Relatório de cobrança: situação, emissão e visão por produto.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

const diaLocal = (d) => d.toLocaleDateString('sv-SE')
const hoje = diaLocal(new Date())
const semanaPassada = diaLocal(new Date(Date.now() - 7 * 864e5))
await entrarComoAdmin()
const marca = `CB${Date.now().toString(36)}`
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: `${marca} Cliente` })).json
const caixa = (await chamar('POST', '/contas-financeiras', { nome: `${marca} Caixa`, tipo: 'CAIXA' })).json
const a = (await chamar('POST', '/produtos', { sku: `${marca}A`, nome: 'Produto A', precoCusto: 100, precoVenda: 3000 })).json
const b = (await chamar('POST', '/produtos', { sku: `${marca}B`, nome: 'Produto B', precoCusto: 100, precoVenda: 1000 })).json
await chamar('POST', '/entradas', { data: semanaPassada, itens: [{ produtoId: a.id, quantidade: 10, custoUnitario: 100 }, { produtoId: b.id, quantidade: 10, custoUnitario: 100 }] })

// Pedido de semana passada: 1 A (3000) + 1 B (1000) = 4000 em 2 parcelas de 2000.
const p1 = (await chamar('POST', '/pedidos', { clienteId: cliente.id, data: semanaPassada, itens: [{ produtoId: a.id, quantidade: 1, precoUnitario: 3000 }, { produtoId: b.id, quantidade: 1, precoUnitario: 1000 }] })).json
await chamar('POST', `/pedidos/${p1.id}/faturar`, { formaPagamento: 'BOLETO', parcelas: 2, primeiroVencimento: hoje })
// Pedido de hoje: 2 B (2000), pago por inteiro.
const p2 = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: b.id, quantidade: 2, precoUnitario: 1000 }] })).json
await chamar('POST', `/pedidos/${p2.id}/faturar`, { formaPagamento: 'PIX', primeiroVencimento: hoje })
const contas = (await chamar('GET', `/contas-receber?pessoaId=${cliente.id}`)).json
const contaP2 = contas.find((c) => c.pedido?.id === p2.id)
await chamar('POST', `/contas-receber/${contaP2.id}/baixar`, { valor: 2000, data: hoje, contaFinanceiraId: caixa.id })
// Uma parcela do pedido 1 paga em parte.
const parcela1 = contas.filter((c) => c.pedido?.id === p1.id).sort((x, y) => x.vencimento.localeCompare(y.vencimento))[0]
await chamar('POST', `/contas-receber/${parcela1.id}/baixar`, { valor: 500, data: hoje, contaFinanceiraId: caixa.id })

const rel = async (qs) => (await chamar('GET', `/relatorios/cobranca?pessoaId=${cliente.id}&${qs}`)).json
let r = await rel('')
conferir('padrão: só em aberto', r.linhas.length === 2 && r.linhas.every((l) => l.situacao === 'ABERTA' || l.situacao === 'PARCIAL'), JSON.stringify(r.linhas.map((l) => l.situacao)))
conferir('parcial aparece como parcial', r.linhas.some((l) => l.situacao === 'PARCIAL' && l.saldo === 1500))
conferir('com pagamento parcial', (await rel('situacao=PARCIAIS')).linhas.map((l) => l.saldo).join() === '1500')
const pagas = await rel('situacao=PAGAS')
conferir('pagas: saldo zero e recebido no resumo', pagas.linhas.length === 1 && pagas.linhas[0].situacao === 'PAGA' && pagas.linhas[0].saldo === 0 && pagas.resumo.recebido === 2000 && pagas.linhas[0].pagoEm, JSON.stringify(pagas.resumo))
conferir('todas', (await rel('situacao=TODAS')).linhas.length === 3)
conferir('situação inválida -> 400', (await chamar('GET', '/relatorios/cobranca?situacao=TALVEZ')).status === 400)

// Emissão = data da venda.
const daSemanaPassada = await rel(`situacao=TODAS&emissaoInicio=${semanaPassada}&emissaoFim=${semanaPassada}`)
conferir('emissão pela data da venda', daSemanaPassada.linhas.length === 2 && daSemanaPassada.linhas.every((l) => l.pedidoNumero === p1.numero && diaLocal(new Date(l.emissao)) === semanaPassada))
conferir('emissão de hoje', (await rel(`situacao=TODAS&emissaoInicio=${hoje}`)).linhas.map((l) => l.pedidoNumero).join() === String(p2.numero))

// Por produto, em aberto: as 2 parcelas do pedido 1 (saldo 1500 + 2000 = 3500) divididas 3/4 para A e 1/4 para B.
r = await rel('')
const pa = r.porProduto.find((g) => g.produto.endsWith('Produto A'))
const pb = r.porProduto.find((g) => g.produto.endsWith('Produto B'))
conferir('por produto divide o saldo pelo valor dos itens', pa.saldo === 2625 && pb.saldo === 875 && pa.valor === 3000 && pb.valor === 1000, JSON.stringify(r.porProduto))
conferir('quantidade conta uma vez por pedido', pa.quantidade === 1 && pb.quantidade === 1 && pa.pedidos === 1)
const todasPorProduto = (await rel('situacao=TODAS')).porProduto.find((g) => g.produto.endsWith('Produto B'))
conferir('por produto com todas as situações', todasPorProduto.quantidade === 3 && todasPorProduto.pedidos === 2 && todasPorProduto.valor === 3000, JSON.stringify(todasPorProduto))

await encerrar()
