// Histórico do pedido e conferência antes de alterar um pedido faturado.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

const hoje = new Date().toLocaleDateString('sv-SE')
await entrarComoAdmin()
const marca = `HP${Date.now().toString(36)}`
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: `${marca} Cliente` })).json
const outro = (await chamar('POST', '/pessoas', { cliente: true, nome: `${marca} Outro` })).json
const prod = (await chamar('POST', '/produtos', { sku: marca, nome: 'Produto histórico', precoCusto: 100, precoVenda: 1000 })).json
const prod2 = (await chamar('POST', '/produtos', { sku: `${marca}B`, nome: 'Segundo produto', precoCusto: 100, precoVenda: 500 })).json
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: prod.id, quantidade: 20, custoUnitario: 100 }, { produtoId: prod2.id, quantidade: 20, custoUnitario: 100 }] })
const historico = async (id) => (await chamar('GET', `/pedidos/${id}`)).json.historico

const corpo = { clienteId: cliente.id, natureza: 'VENDA', formaPagamento: 'PIX', primeiroVencimento: hoje, itens: [{ produtoId: prod.id, quantidade: 2, precoUnitario: 1000 }] }
const p = (await chamar('POST', '/pedidos', corpo)).json
let h = await historico(p.id)
conferir('lançar registra no histórico', h.length === 1 && h[0].tipo === 'CRIADO' && h[0].descricao.includes('1 item') && h[0].usuario?.nome === 'Administrador', JSON.stringify(h))

const editado = await chamar('PUT', `/pedidos/${p.id}`, { ...corpo, itens: [{ produtoId: prod.id, quantidade: 3, precoUnitario: 1000 }], observacao: 'urgente' })
conferir('editar em aberto funciona', editado.status === 200, JSON.stringify(editado.json))
h = await historico(p.id)
conferir('editar em aberto registra o que mudou', h[0].tipo === 'ALTERADO' && h[0].descricao.includes('Item alterado: 2 UN de Produto histórico') && h[0].descricao.includes('Observação: — → urgente') && h[0].totalAnterior === 2000 && h[0].totalNovo === 3000, h[0].descricao)
await chamar('PUT', `/pedidos/${p.id}`, { ...corpo, itens: [{ produtoId: prod.id, quantidade: 3, precoUnitario: 1000 }], observacao: 'urgente' })
conferir('salvar sem mudar nada não registra', (await historico(p.id)).length === 2)

await chamar('POST', `/pedidos/${p.id}/faturar`, {})
h = await historico(p.id)
conferir('faturar registra', h[0].tipo === 'FATURADO' && h[0].descricao.includes('1 parcela,'), h[0].descricao)

// Alteração do faturado: motivo obrigatório e conferência antes.
const novo = { ...corpo, clienteId: outro.id, itens: [{ produtoId: prod.id, quantidade: 3, precoUnitario: 1000 }, { produtoId: prod2.id, quantidade: 1, precoUnitario: 500 }], observacao: 'urgente' }
conferir('sem motivo -> 400', (await chamar('PUT', `/pedidos/${p.id}/faturado`, novo)).status === 400)
const contasAntes = (await chamar('GET', `/pedidos/${p.id}`)).json.contasReceber.map((c) => `${c.id}:${c.status}`).join()
const saldoAntes = (await chamar('GET', '/produtos')).json.find((x) => x.id === prod2.id).saldo
const previa = await chamar('POST', `/pedidos/${p.id}/faturado/conferir`, novo)
conferir('conferência mostra totais e mudanças', previa.status === 200 && previa.json.totalAnterior === 3000 && previa.json.totalNovo === 3500 && previa.json.refaz === true, JSON.stringify(previa.json))
conferir('conferência lista cliente, item incluído e o refazer', previa.json.mudancas.some((m) => m.startsWith('Cliente:')) && previa.json.mudancas.some((m) => m.startsWith('Item incluído: 1 UN de Segundo produto')) && previa.json.mudancas.includes('Estoque e parcelas em aberto refeitos.'), previa.json.mudancas.join(' | '))
const depoisDaPrevia = await chamar('GET', `/pedidos/${p.id}`)
conferir('conferência não grava nada', depoisDaPrevia.json.clienteId === cliente.id && depoisDaPrevia.json.total === 3000 && depoisDaPrevia.json.contasReceber.map((c) => `${c.id}:${c.status}`).join() === contasAntes && depoisDaPrevia.json.historico.length === 3)
conferir('conferência não mexe no estoque', (await chamar('GET', '/produtos')).json.find((x) => x.id === prod2.id).saldo === saldoAntes)
conferir('conferência sem mudança -> 400', (await chamar('POST', `/pedidos/${p.id}/faturado/conferir`, { ...corpo, itens: [{ produtoId: prod.id, quantidade: 3, precoUnitario: 1000 }], observacao: 'urgente' })).status === 400)

const alterado = await chamar('PUT', `/pedidos/${p.id}/faturado`, { ...novo, motivo: 'Cliente pediu mais um produto' })
h = await historico(p.id)
conferir('alterar o faturado grava motivo, totais e mudanças', alterado.status === 200 && h[0].tipo === 'ALTERADO_FATURADO' && h[0].motivo === 'Cliente pediu mais um produto' && h[0].totalAnterior === 3000 && h[0].totalNovo === 3500 && h[0].descricao.includes('Item incluído'), JSON.stringify(h[0]))

const cancelado = await chamar('POST', `/pedidos/${p.id}/cancelar`, { motivo: 'Desistiu da compra' })
h = await historico(p.id)
conferir('cancelar registra com motivo', cancelado.status === 200 && h[0].tipo === 'CANCELADO' && h[0].motivo === 'Desistiu da compra' && h[0].descricao.includes('estoque devolvido'), JSON.stringify(h[0]))
conferir('histórico em ordem, do mais recente', h.map((x) => x.tipo).join() === 'CANCELADO,ALTERADO_FATURADO,FATURADO,ALTERADO,CRIADO')

await encerrar()
