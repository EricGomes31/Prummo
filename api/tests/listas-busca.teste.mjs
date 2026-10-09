// Busca e período nas listas de pedidos e de entradas: acham registros fora dos mais recentes.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

const diaLocal = (d) => d.toLocaleDateString('sv-SE')
const hoje = diaLocal(new Date())
const ontem = diaLocal(new Date(Date.now() - 864e5))
const amanha = diaLocal(new Date(Date.now() + 864e5))

await entrarComoAdmin()
const marca = `LB${Date.now().toString(36)}`
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: `${marca} Cliente`, nomeFantasia: `${marca} Fantasia` })).json
const outro = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Outra pessoa qualquer' })).json
const medico = (await chamar('POST', '/pessoas', { medico: true, nome: `${marca} Médica` })).json
const fornecedor = (await chamar('POST', '/pessoas', { fornecedor: true, nome: `${marca} Fornecedor` })).json
const prod = (await chamar('POST', '/produtos', { sku: marca, nome: `Produto ${marca}`, precoCusto: 100, precoVenda: 1000 })).json

const novoPedido = async (extra) => (await chamar('POST', '/pedidos', { itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 1000 }], ...extra })).json
const a = await novoPedido({ clienteId: cliente.id })
const b = await novoPedido({ clienteId: outro.id, medicoId: medico.id })
const c = await novoPedido({ clienteId: outro.id, observacao: `nota ${marca}` })

const pedidos = async (qs) => (await chamar('GET', `/pedidos?${qs}`)).json
const ids = (lista) => lista.map((p) => p.id).sort()
conferir('busca pelo número', ids(await pedidos(`busca=${b.numero}`)).includes(b.id))
conferir('busca pelo número com #', (await pedidos(`busca=${encodeURIComponent('#' + a.numero)}`)).some((p) => p.id === a.id))
conferir('busca pelo cliente, sem diferenciar maiúsculas', JSON.stringify(ids(await pedidos(`busca=${marca.toLowerCase()}%20cliente`))) === JSON.stringify([a.id]))
conferir('busca pelo nome fantasia do cliente', (await pedidos(`busca=${marca}%20Fantasia`)).some((p) => p.id === a.id))
conferir('busca pelo médico', JSON.stringify(ids(await pedidos(`busca=${encodeURIComponent(marca + ' Médica')}`))) === JSON.stringify([b.id]))
conferir('busca pela observação', JSON.stringify(ids(await pedidos(`busca=${encodeURIComponent('nota ' + marca)}`))) === JSON.stringify([c.id]))
conferir('busca acha os três pela marca', ids(await pedidos(`busca=${marca}`)).length === 3)
conferir('período de hoje inclui os pedidos', (await pedidos(`inicio=${hoje}&fim=${hoje}&busca=${marca}`)).length === 3)
conferir('período de amanhã não inclui', (await pedidos(`inicio=${amanha}&busca=${marca}`)).length === 0)
conferir('período até ontem não inclui', (await pedidos(`fim=${ontem}&busca=${marca}`)).length === 0)
conferir('situação junto da busca', (await pedidos(`status=FATURADO&busca=${marca}`)).length === 0)
conferir('data inválida -> 400', (await chamar('GET', '/pedidos?inicio=09/10/2026')).status === 400)

const entrada = (await chamar('POST', '/entradas', { fornecedorId: fornecedor.id, data: hoje, numeroDocumento: `NF-${marca}`, itens: [{ produtoId: prod.id, quantidade: 2, custoUnitario: 100 }] })).json
await chamar('POST', '/entradas', { data: ontem, itens: [{ produtoId: prod.id, quantidade: 1, custoUnitario: 100 }] })
const entradas = async (qs) => (await chamar('GET', `/entradas?${qs}`)).json
conferir('entrada pelo fornecedor', JSON.stringify((await entradas(`busca=${marca}%20Fornecedor`)).map((e) => e.id)) === JSON.stringify([entrada.id]))
conferir('entrada pelo documento', (await entradas(`busca=NF-${marca}`)).some((e) => e.id === entrada.id))
conferir('entrada pelo número', (await entradas(`busca=${encodeURIComponent('#' + entrada.id)}`)).some((e) => e.id === entrada.id))
conferir('entrada pelo produto', (await entradas(`busca=${marca}`)).length === 2)
conferir('entrada pelo período', (await entradas(`inicio=${hoje}&fim=${hoje}&busca=${marca}`)).length === 1)

await encerrar()
