// Condição de pagamento no pedido, alteração de pedido faturado e desconto manual fora da campanha.
import { chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

const dia = (deslocamento) => new Date(Date.now() + deslocamento * 864e5).toLocaleDateString('sv-SE')
const hoje = dia(0)

await entrarComoAdmin()
const admin = sessao.token
const pessoa = async (dados) => (await chamar('POST', '/pessoas', dados)).json
const cliente = await pessoa({ cliente: true, nome: 'Cliente Pagamento' })
const outro = await pessoa({ cliente: true, nome: 'Outro Cliente' })
const vendedor = await pessoa({ vendedor: true, nome: 'Vito Vendedor' })
const produto = async (sku, preco) => (await chamar('POST', '/produtos', { sku, nome: `Produto ${sku}`, precoCusto: 1000, precoVenda: preco })).json
const A = await produto('PG-A', 10000)
const B = await produto('PG-B', 5000)
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: A.id, quantidade: 50, custoUnitario: 1000 }, { produtoId: B.id, quantidade: 50, custoUnitario: 1000 }] })
const saldo = async (p) => (await chamar('GET', '/produtos')).json.find((x) => x.id === p.id).saldo
const item = (p, quantidade, extra) => ({ produtoId: p.id, quantidade, precoUnitario: p.precoVenda, ...extra })
const pedir = (dados) => chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [item(A, 1)], ...dados })
const contasDo = async (id) => (await chamar('GET', `/pedidos/${id}`)).json.contasReceber

// Condição de pagamento já no pedido
const comCondicao = await pedir({ formaPagamento: 'LINK_CARTAO', parcelas: 3, primeiroVencimento: dia(30), itens: [item(A, 3)] })
conferir('pedido guarda a condição de pagamento', comCondicao.status === 201 && comCondicao.json.formaPagamento === 'LINK_CARTAO' && comCondicao.json.parcelas === 3 && comCondicao.json.primeiroVencimento.slice(0, 10) === dia(30), JSON.stringify(comCondicao.json?.erro ?? ''))
const faturado = await chamar('POST', `/pedidos/${comCondicao.json.id}/faturar`, {})
conferir('faturar sem corpo usa a condição do pedido', faturado.status === 200 && faturado.json.formaPagamento === 'LINK_CARTAO', JSON.stringify(faturado.json?.erro ?? ''))
let contas = await contasDo(comCondicao.json.id)
conferir('gera as parcelas escolhidas no pedido', contas.length === 3 && contas[0].vencimento.slice(0, 10) === dia(30) && contas.reduce((s, c) => s + c.valor, 0) === 30000)
const semCondicao = await pedir({})
conferir('pedido sem condição continua aceito', semCondicao.status === 201 && semCondicao.json.formaPagamento === null && semCondicao.json.parcelas === 1)
conferir('faturar sem condição em lugar nenhum -> 400', (await chamar('POST', `/pedidos/${semCondicao.json.id}/faturar`, {})).status === 400)
const sobrescrito = await chamar('POST', `/pedidos/${semCondicao.json.id}/faturar`, { formaPagamento: 'CARTAO_CREDITO', parcelas: 2, primeiroVencimento: hoje })
conferir('condição informada ao faturar vale', sobrescrito.json.formaPagamento === 'CARTAO_CREDITO' && (await contasDo(semCondicao.json.id)).length === 2)
conferir('forma de pagamento desconhecida -> 400', (await pedir({ formaPagamento: 'CHEQUE' })).status === 400)
const bonificacao = await pedir({ natureza: 'BONIFICACAO', formaPagamento: 'PIX', parcelas: 4 })
conferir('bonificação não guarda condição de pagamento', bonificacao.json.formaPagamento === null && bonificacao.json.parcelas === 1)

// Alteração de pedido faturado: só cadastro
const id = comCondicao.json.id
const corpoAtual = { clienteId: cliente.id, formaPagamento: 'LINK_CARTAO', parcelas: 3, primeiroVencimento: dia(30), itens: [item(A, 3)] }
const alterar = (corpo) => chamar('PUT', `/pedidos/${id}/faturado`, { motivo: 'Correção de teste', ...corpo })
const saldoAntes = await saldo(A)
const cadastro = await alterar({ ...corpoAtual, clienteId: outro.id, vendedorId: vendedor.id, observacao: 'Ajuste de cadastro' })
contas = await contasDo(id)
conferir('alteração só de cadastro mantém parcelas e estoque', cadastro.status === 200 && cadastro.json.vendedor.nome === 'Vito Vendedor' && cadastro.json.cliente.id === outro.id && contas.filter((c) => c.status === 'ABERTA').length === 3 && (await saldo(A)) === saldoAntes, JSON.stringify(cadastro.json?.erro ?? ''))
conferir('parcelas acompanham o novo cliente', (await chamar('GET', '/contas-receber?status=ABERTA')).json.filter((c) => c.descricao.startsWith(`Pedido nº ${comCondicao.json.numero} `)).every((c) => c.pessoa.id === outro.id))
conferir('natureza não muda depois do faturamento -> 400', (await alterar({ ...corpoAtual, natureza: 'BONIFICACAO' })).status === 400)
conferir('pedido em aberto não usa esta rota -> 409', (await chamar('PUT', `/pedidos/${bonificacao.json.id}/faturado`, { motivo: 'Correção de teste', clienteId: cliente.id, natureza: 'BONIFICACAO', itens: [item(A, 1)] })).status === 409)

// Alteração de itens e pagamento: refaz o faturamento
const novo = await alterar({ ...corpoAtual, clienteId: outro.id, parcelas: 2, frete: 1000, itens: [item(A, 1), item(B, 2)] })
contas = await contasDo(id)
const abertas = contas.filter((c) => c.status === 'ABERTA')
conferir('alterar itens refaz o total', novo.status === 200 && novo.json.total === 10000 + 10000 + 1000 && novo.json.status === 'FATURADO', JSON.stringify(novo.json?.erro ?? novo.json?.total))
conferir('parcelas antigas canceladas e novas geradas', abertas.length === 2 && abertas.reduce((s, c) => s + c.valor, 0) === 21000 && contas.filter((c) => c.status === 'CANCELADA').length === 3 && abertas.every((c) => c.pessoaId === outro.id), JSON.stringify(contas.map((c) => [c.status, c.valor, c.pessoaId])))
conferir('estoque volta e sai de novo', (await saldo(A)) === saldoAntes + 2 && (await saldo(B)) === 48)
const movimentos = (await chamar('GET', `/produtos/${A.id}/movimentos`)).json
conferir('estoque registra a alteração', movimentos.some((m) => m.origem === 'ALTERACAO' && m.origemId === id && m.tipo === 'ENTRADA' && m.quantidade === 3))
conferir('estoque insuficiente na alteração -> 409', (await alterar({ ...corpoAtual, clienteId: outro.id, itens: [item(A, 500)] })).status === 409)
conferir('alteração recusada não muda nada', (await saldo(A)) === saldoAntes + 2 && (await contasDo(id)).filter((c) => c.status === 'ABERTA').length === 2)

// Depois de receber, só o cadastro muda
await chamar('POST', `/contas-receber/${abertas[0].id}/baixar`, { valor: 1000 })
conferir('com parcela recebida, itens não mudam -> 409', (await alterar({ ...corpoAtual, clienteId: outro.id, parcelas: 2, frete: 1000, itens: [item(A, 2), item(B, 2)] })).status === 409)
const soObs = await alterar({ ...corpoAtual, clienteId: outro.id, parcelas: 2, frete: 1000, itens: [item(A, 1), item(B, 2)], observacao: 'Só a observação' })
conferir('com parcela recebida, o cadastro ainda muda', soObs.status === 200 && soObs.json.observacao === 'Só a observação', JSON.stringify(soObs.json?.erro ?? ''))

// Pedido com devolução não muda valores
const venda2 = (await pedir({ formaPagamento: 'PIX', primeiroVencimento: hoje, itens: [item(A, 2)] })).json
await chamar('POST', `/pedidos/${venda2.id}/faturar`, {})
await chamar('POST', '/devolucoes', { pedidoId: venda2.id, itens: [{ pedidoItemId: venda2.itens[0].id, quantidade: 1 }] })
conferir('pedido com devolução não muda valores -> 409', (await chamar('PUT', `/pedidos/${venda2.id}/faturado`, { motivo: 'Correção de teste', clienteId: cliente.id, formaPagamento: 'PIX', primeiroVencimento: hoje, itens: [item(A, 1)] })).status === 409)

// Campanha: desconto manual só fora dos produtos dela
const promo = (await chamar('POST', '/promocoes', { nome: 'Dez por cento A', modalidade: 'PERCENTUAL', percentual: 1000, inicio: dia(-1), fim: dia(1), itens: [{ produtoId: A.id, quantidade: 1 }] })).json
const misto = await pedir({ promocaoId: promo.id, itens: [item(A, 2), item(B, 2, { desconto: 500 })] })
conferir('desconto no produto fora da campanha é aceito', misto.status === 201 && misto.json.descontoPromocao === 2000 && misto.json.descontoItens === 1000 && misto.json.total === 30000 - 2000 - 1000, JSON.stringify(misto.json?.erro ?? misto.json?.total))
const noParticipante = await pedir({ promocaoId: promo.id, itens: [item(A, 2, { desconto: 100 }), item(B, 1)] })
conferir('desconto no produto da campanha -> 400', noParticipante.status === 400 && noParticipante.json.erro.includes('Produto PG-A'))
conferir('desconto no total com campanha -> 400', (await pedir({ promocaoId: promo.id, desconto: 100, itens: [item(A, 2)] })).status === 400)

// Permissão
const perfil = (await chamar('POST', '/perfis', { nome: 'Faturista', permissoes: ['PEDIDOS_VISUALIZAR', 'PEDIDOS_CADASTRAR', 'PEDIDOS_FATURAR'], dashboards: [] })).json
await chamar('POST', '/usuarios', { nome: 'Fábio', email: 'fabio@prumo.local', senha: 'senha-12345', perfilId: perfil.id })
sessao.token = (await chamar('POST', '/auth/login', { email: 'fabio@prumo.local', senha: 'senha-12345' })).json.token
conferir('sem a permissão, não altera faturado -> 403', (await alterar({ ...corpoAtual, observacao: 'x' })).status === 403)
sessao.token = admin

encerrar()
