// Data da venda no pedido: padrão hoje, pode ser anterior, nunca futura; vale para lista, relatório e dashboard.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

const diaLocal = (d) => d.toLocaleDateString('sv-SE')
const hoje = diaLocal(new Date())
const ontem = diaLocal(new Date(Date.now() - 864e5))
const amanha = diaLocal(new Date(Date.now() + 864e5))
const mesPassado = (() => {
  const d = new Date()
  d.setDate(15)
  d.setMonth(d.getMonth() - 1)
  return diaLocal(d)
})()

await entrarComoAdmin()
const marca = `DV${Date.now().toString(36)}`
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: `${marca} Cliente` })).json
const prod = (await chamar('POST', '/produtos', { sku: marca, nome: 'Produto data', precoCusto: 100, precoVenda: 1000 })).json
await chamar('POST', '/entradas', { data: mesPassado, itens: [{ produtoId: prod.id, quantidade: 20, custoUnitario: 100 }] })
const corpo = (extra) => ({ clienteId: cliente.id, itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 1000 }], ...extra })

const semData = (await chamar('POST', '/pedidos', corpo({}))).json
conferir('sem data, vale hoje', diaLocal(new Date(semData.data)) === hoje, semData.data)
const antigo = (await chamar('POST', '/pedidos', corpo({ data: mesPassado }))).json
conferir('data anterior é aceita', diaLocal(new Date(antigo.data)) === mesPassado, antigo.data)
const editado = await chamar('PUT', `/pedidos/${semData.id}`, corpo({ data: ontem }))
conferir('editar o pedido em aberto muda a data da venda', editado.status === 200 && diaLocal(new Date(editado.json.data)) === ontem, JSON.stringify(editado.json))
await chamar('PUT', `/pedidos/${semData.id}`, corpo({ data: hoje }))
conferir('data futura -> 400', (await chamar('POST', '/pedidos', corpo({ data: amanha }))).status === 400)

const doPeriodo = (await chamar('GET', `/pedidos?busca=${marca}&inicio=${mesPassado}&fim=${mesPassado}`)).json
conferir('período da lista usa a data da venda', doPeriodo.length === 1 && doPeriodo[0].id === antigo.id)
const lista = (await chamar('GET', `/pedidos?busca=${marca}`)).json
conferir('lista em ordem de data da venda, mais recente primeiro', lista[0].id === semData.id && lista.at(-1).id === antigo.id)

// Faturado: mudar só a data não refaz o faturamento.
await chamar('POST', `/pedidos/${antigo.id}/faturar`, { formaPagamento: 'PIX', primeiroVencimento: hoje })
const contasAntes = (await chamar('GET', `/pedidos/${antigo.id}`)).json.contasReceber.map((c) => c.id).join()
const alterado = await chamar('PUT', `/pedidos/${antigo.id}/faturado`, { motivo: 'Correção de teste', ...corpo({ data: ontem }), natureza: 'VENDA', formaPagamento: 'PIX', primeiroVencimento: hoje })
const depois = (await chamar('GET', `/pedidos/${antigo.id}`)).json
conferir('alterar a data do faturado', alterado.status === 200 && diaLocal(new Date(depois.data)) === ontem, JSON.stringify(alterado.json))
conferir('sem refazer as parcelas', depois.contasReceber.map((c) => c.id).join() === contasAntes)

// Relatório de vendas e dashboard comercial contam pela data da venda.
const rel = (await chamar('GET', `/relatorios/vendas?busca=${marca}&inicio=${ontem}&fim=${ontem}`)).json
conferir('relatório filtra pela data da venda', rel.linhas.length === 1 && rel.linhas[0].id === antigo.id && diaLocal(new Date(rel.linhas[0].data)) === ontem)
const mes = ontem.slice(0, 7)
const dash = (await chamar('GET', `/dashboards/comercial?mes=${mes}`)).json
conferir('dashboard conta a venda pela data dela', dash.kpis.vendas === 1 && dash.kpis.faturamento === 1000, JSON.stringify(dash.kpis))

// Endereço de entrega alternativo: gravado no pedido e oferecido para a nova entrega.
const endereco = { cep: '29.160-000', logradouro: 'Rua das Acácias', numero: '45', complemento: null, bairro: 'Centro', cidade: 'Serra', uf: 'es', referencia: 'Portão azul' }
const comEndereco = (await chamar('POST', '/pedidos', corpo({ enderecoEntrega: endereco }))).json
conferir('pedido guarda o endereço de entrega, com CEP só em dígitos e UF maiúscula', comEndereco.enderecoEntrega?.cep === '29160000' && comEndereco.enderecoEntrega.uf === 'ES' && comEndereco.enderecoEntrega.referencia === 'Portão azul', JSON.stringify(comEndereco.enderecoEntrega))
conferir('endereço sem rua -> 400', (await chamar('POST', '/pedidos', corpo({ enderecoEntrega: { ...endereco, logradouro: '' } }))).status === 400)
await chamar('POST', `/pedidos/${comEndereco.id}/faturar`, { formaPagamento: 'PIX', primeiroVencimento: hoje })
const disponiveis = (await chamar('GET', '/entregas/pedidos-disponiveis')).json
conferir('pedido disponível para entrega leva o endereço', disponiveis.find((p) => p.id === comEndereco.id)?.enderecoEntrega?.logradouro === 'Rua das Acácias')
const semEndereco = await chamar('PUT', `/pedidos/${comEndereco.id}/faturado`, { motivo: 'Correção de teste', ...corpo({ enderecoEntrega: null }), natureza: 'VENDA', formaPagamento: 'PIX', primeiroVencimento: hoje })
conferir('tirar o endereço do faturado volta ao do cliente', semEndereco.status === 200 && semEndereco.json.enderecoEntrega === null, JSON.stringify(semEndereco.json.enderecoEntrega))

await encerrar()
