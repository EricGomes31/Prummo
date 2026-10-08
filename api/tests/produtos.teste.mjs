// Cadastro de produtos: EAN, unidade base, código gerado e produtos que não controlam estoque.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

await entrarComoAdmin()
const hoje = new Date().toLocaleDateString('sv-SE')

const auto = await chamar('POST', '/produtos', { nome: 'Sem código', unidade: 'CX', ean: '7891234567895', precoVenda: 14999 })
conferir('código gerado quando em branco', auto.status === 201 && auto.json.sku === `P-${String(auto.json.id).padStart(4, '0')}`, auto.json?.sku)
conferir('grava EAN, unidade e padrões', auto.json.ean === '7891234567895' && auto.json.unidade === 'CX' && auto.json.controlaEstoque === true && auto.json.precoCusto === 0 && auto.json.saldo === 0)
conferir('EAN repetido -> 409', (await chamar('POST', '/produtos', { nome: 'Outro', ean: '7891234567895', precoVenda: 1 })).status === 409)
conferir('EAN inválido -> 400', (await chamar('POST', '/produtos', { nome: 'Outro', ean: '12AB', precoVenda: 1 })).status === 400)
conferir('unidade fora da lista -> 400', (await chamar('POST', '/produtos', { nome: 'Outro', unidade: 'XYZ', precoVenda: 1 })).status === 400)
const semEan1 = await chamar('POST', '/produtos', { nome: 'Sem EAN 1', ean: '', precoVenda: 1 })
const semEan2 = await chamar('POST', '/produtos', { nome: 'Sem EAN 2', precoVenda: 1 })
conferir('vários produtos sem EAN', semEan1.status === 201 && semEan2.status === 201 && semEan1.json.ean === null)
conferir('busca ignora maiúsculas e minúsculas', (await chamar('GET', `/produtos?busca=${encodeURIComponent('SEM CÓD')}`)).json.some((p) => p.id === auto.json.id))
conferir('busca por EAN',(await chamar('GET', '/produtos?busca=78912345')).json.some((p) => p.id === auto.json.id))

// Editar sem mandar custo não zera o custo vindo da entrada
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: auto.json.id, quantidade: 5, custoUnitario: 6000 }] })
const editado = await chamar('PUT', `/produtos/${auto.json.id}`, { nome: 'Com código', sku: 'COD-1', unidade: 'CX', precoVenda: 15999, ean: '' })
conferir('editar preserva o custo da entrada', editado.json.precoCusto === 6000 && editado.json.saldo === 5 && editado.json.sku === 'COD-1' && editado.json.ean === null && editado.json.precoVenda === 15999, JSON.stringify(editado.json))
const semSku = await chamar('PUT', `/produtos/${auto.json.id}`, { nome: 'Com código', unidade: 'CX', precoVenda: 15999 })
conferir('editar sem código mantém o código', semSku.json.sku === 'COD-1')

// Produto que não controla estoque
const servico = (await chamar('POST', '/produtos', { nome: 'Instalação', unidade: 'SV', precoVenda: 20000, controlaEstoque: false })).json
conferir('serviço criado sem controle', servico.controlaEstoque === false)
conferir('entrada de produto sem controle -> 400', (await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: servico.id, quantidade: 1, custoUnitario: 1 }] })).status === 400)
conferir('ajuste de produto sem controle -> 400', (await chamar('POST', `/produtos/${servico.id}/ajuste`, { novoSaldo: 3 })).status === 400)
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente Produto' })).json
const pedido = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: servico.id, quantidade: 3, precoUnitario: 20000 }, { produtoId: auto.json.id, quantidade: 2, precoUnitario: 15999 }] })).json
const fat = await chamar('POST', `/pedidos/${pedido.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'PIX' })
conferir('fatura serviço sem saldo', fat.status === 200 && fat.json.status === 'FATURADO', JSON.stringify(fat.json?.erro ?? ''))
const depois = (await chamar('GET', '/produtos')).json
conferir('baixa só o produto controlado', depois.find((p) => p.id === servico.id).saldo === 0 && depois.find((p) => p.id === auto.json.id).saldo === 3)
conferir('serviço sem movimentação de estoque', (await chamar('GET', `/produtos/${servico.id}/movimentos`)).json.length === 0)
const resumo = (await chamar('GET', '/dashboard/resumo')).json
conferir('serviço fora dos alertas de estoque', !resumo.estoque.criticos.some((p) => p.id === servico.id))
// Trocar o controle depois do faturamento não pode devolver ao estoque o que nunca saiu
await chamar('PUT', `/produtos/${servico.id}`, { nome: 'Instalação', unidade: 'SV', precoVenda: 20000, controlaEstoque: true })
const canc = await chamar('POST', `/pedidos/${pedido.id}/cancelar`)
const final = (await chamar('GET', '/produtos')).json
conferir('cancelar devolve só o que saiu', canc.json.status === 'CANCELADO' && final.find((p) => p.id === servico.id).saldo === 0 && final.find((p) => p.id === auto.json.id).saldo === 5)

encerrar()
