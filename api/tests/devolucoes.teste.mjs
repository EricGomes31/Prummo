// Devoluções de vendas: saldo devolvível, estoque, crédito gerado e uso do crédito em contas a receber.
import { SENHA_ADMIN, chamar, conferir, encerrar, sessao } from './apoio.mjs'

const hoje = new Date().toLocaleDateString('sv-SE')
const admin = (await chamar('POST', '/auth/login', { email: 'admin@prumo.local', senha: SENHA_ADMIN })).json.token
sessao.token = admin
const pessoa = async (dados) => (await chamar('POST', '/pessoas', dados)).json
const cliente = await pessoa({ cliente: true, nome: 'Cliente Devolução' })
const medico = await pessoa({ medico: true, nome: 'Dra. Marta' })
const estranho = await pessoa({ cliente: true, nome: 'Outro Cliente' })
const produto = async (sku, preco) => (await chamar('POST', '/produtos', { sku, nome: `Produto ${sku}`, precoCusto: 100, precoVenda: preco })).json
const A = await produto('DA', 10000)
const B = await produto('DB', 5000)
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: A.id, quantidade: 10, custoUnitario: 100 }, { produtoId: B.id, quantidade: 10, custoUnitario: 100 }] })
const saldoDe = async (p) => (await chamar('GET', '/produtos')).json.find((x) => x.id === p.id).saldo

// Venda: 2×A com 10,00 de desconto cada (180,00) + 2×B (100,00) = 280,00; 10% no total (28,00) e 5,00 de frete
const pedido = (
  await chamar('POST', '/pedidos', {
    clienteId: cliente.id,
    medicoId: medico.id,
    desconto: 2800,
    frete: 500,
    itens: [{ produtoId: A.id, quantidade: 2, precoUnitario: 10000, desconto: 1000 }, { produtoId: B.id, quantidade: 2, precoUnitario: 5000 }],
  })
).json
const itemA = pedido.itens.find((i) => i.produtoId === A.id)
const itemB = pedido.itens.find((i) => i.produtoId === B.id)
const devolver = (itens, extra) => chamar('POST', '/devolucoes', { pedidoId: pedido.id, itens, ...extra })
conferir('pedido em aberto não aceita devolução -> 409', (await devolver([{ pedidoItemId: itemA.id, quantidade: 1 }])).status === 409)
await chamar('POST', `/pedidos/${pedido.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'PIX' })
const contaDoPedido = (await chamar('GET', `/pedidos/${pedido.id}`)).json.contasReceber[0]
conferir('venda faturada por 257,00', contaDoPedido.valor === 25700)

// Saldo devolvível e valor líquido: A vale 90,00 − 10% = 81,00; B vale 50,00 − 10% = 45,00
const saldos = async () => (await chamar('GET', `/devolucoes/pedido/${pedido.id}/saldos`)).json
let s = await saldos()
conferir('saldos trazem o valor líquido por unidade', s.find((i) => i.pedidoItemId === itemA.id).valorUnitario === 8100 && s.find((i) => i.pedidoItemId === itemB.id).valorUnitario === 4500 && s.every((i) => i.disponivel === 2))

// Primeira devolução: 1×A
const estoqueAntes = await saldoDe(A)
const primeira = await devolver([{ pedidoItemId: itemA.id, quantidade: 1 }], { observacao: 'Caixa amassada' })
conferir('devolução gera crédito pelo valor líquido', primeira.status === 201 && primeira.json.valorCredito === 8100 && primeira.json.credito.saldo === 8100 && primeira.json.credito.status === 'DISPONIVEL', JSON.stringify(primeira.json?.erro ?? ''))
conferir('devolução devolve o estoque', (await saldoDe(A)) === estoqueAntes + 1)
const movimentos = (await chamar('GET', `/produtos/${A.id}/movimentos`)).json
conferir('estoque registra a origem', movimentos[0].tipo === 'ENTRADA' && movimentos[0].origem === 'DEVOLUCAO' && movimentos[0].origemId === primeira.json.id)
conferir('quantidade acima do que resta -> 400', (await devolver([{ pedidoItemId: itemA.id, quantidade: 2 }])).status === 400)
conferir('quantidade zero -> 400', (await devolver([{ pedidoItemId: itemA.id, quantidade: 0 }])).status === 400)
conferir('item repetido -> 400', (await devolver([{ pedidoItemId: itemA.id, quantidade: 1 }, { pedidoItemId: itemA.id, quantidade: 1 }])).status === 400)
conferir('item de outra venda -> 400', (await devolver([{ pedidoItemId: 999999, quantidade: 1 }])).status === 400)

// Segunda devolução: o que resta de A e 1×B
const segunda = await devolver([{ pedidoItemId: itemA.id, quantidade: 1 }, { pedidoItemId: itemB.id, quantidade: 1 }])
conferir('segunda devolução soma os itens', segunda.json.valorCredito === 8100 + 4500)
s = await saldos()
conferir('saldo devolvível diminui', s.find((i) => i.pedidoItemId === itemA.id).disponivel === 0 && s.find((i) => i.pedidoItemId === itemB.id).disponivel === 1)
conferir('pedido com devolução não cancela -> 409', (await chamar('POST', `/pedidos/${pedido.id}/cancelar`)).status === 409)
const lista = (await chamar('GET', '/devolucoes')).json
conferir('lista de devoluções', lista.length === 2 && lista[1].observacao === 'Caixa amassada' && lista[1].itens[0].pedidoItem.produto.sku === 'DA' && lista[0].itens.length === 2)

// Créditos e pessoas elegíveis
const creditos = async (qs = '') => (await chamar('GET', `/creditos${qs}`)).json
let lc = await creditos()
const credito = lc.find((c) => c.devolucao.id === primeira.json.id)
conferir('crédito é do cliente e vale para as pessoas da venda', credito.pessoa.id === cliente.id && credito.elegiveis.map((p) => p.id).sort().join() === [cliente.id, medico.id].sort().join())
const usar = (id, corpo) => chamar('POST', `/creditos/${id}/utilizar`, corpo)
const contaDaMedica = (await chamar('POST', '/contas-receber', { pessoaId: medico.id, descricao: 'Consulta', valor: 3100, vencimento: hoje })).json
conferir('valor maior que o crédito -> 400', (await usar(credito.id, { contaReceberId: contaDoPedido.id, pessoaId: cliente.id, valor: 8101 })).status === 400)
conferir('pessoa fora da venda -> 400', (await usar(credito.id, { contaReceberId: contaDoPedido.id, pessoaId: estranho.id, valor: 1000 })).status === 400)
conferir('conta de outra pessoa -> 400', (await usar(credito.id, { contaReceberId: contaDaMedica.id, pessoaId: cliente.id, valor: 1000 })).status === 400)
conferir('valor maior que o saldo da conta -> 400', (await usar(credito.id, { contaReceberId: contaDaMedica.id, pessoaId: medico.id, valor: 3101 })).status === 400)
const parte = await usar(credito.id, { contaReceberId: contaDoPedido.id, pessoaId: cliente.id, valor: 5000 })
conferir('uso parcial do crédito', parte.status === 200 && parte.json.saldo === 3100 && parte.json.status === 'DISPONIVEL', JSON.stringify(parte.json?.erro ?? ''))
const contaAposCredito = (await chamar('GET', '/contas-receber?status=ABERTA')).json.find((c) => c.id === contaDoPedido.id)
conferir('conta a receber baixa em parte', contaAposCredito.valorPago === 5000 && contaAposCredito.status === 'ABERTA')
const resto = await usar(credito.id, { contaReceberId: contaDaMedica.id, pessoaId: medico.id, valor: 3100 })
conferir('médica da venda usa o resto e o crédito esgota', resto.json.saldo === 0 && resto.json.status === 'ESGOTADO')
conferir('conta quitada por crédito fica paga', (await chamar('GET', '/contas-receber?status=PAGA')).json.some((c) => c.id === contaDaMedica.id && c.valorPago === 3100))
conferir('crédito esgotado não é usado de novo -> 400', (await usar(credito.id, { contaReceberId: contaDoPedido.id, pessoaId: cliente.id, valor: 100 })).status === 400)
lc = await creditos('?status=DISPONIVEL')
conferir('filtro por situação', lc.length === 1 && lc[0].saldo === 12600 && (await creditos('?status=ESGOTADO'))[0].usos.length === 2)

// O crédito aparece no histórico da conta, mas não é dinheiro
const historico = (await chamar('GET', `/contas-receber/${contaDoPedido.id}/baixas`)).json
conferir('histórico da conta mostra a baixa por crédito', historico.length === 1 && historico[0].origem === 'CREDITO' && historico[0].valor === 5000)
conferir('baixa por crédito não é estornada como recebimento -> 409', (await chamar('POST', `/contas-receber/${contaDoPedido.id}/estornar`)).status === 409)
conferir('crédito não conta como recebido', (await chamar('GET', '/dashboards/financeiro')).json.kpis.recebido === 0 && (await chamar('GET', '/contas-financeiras')).json[0].saldo === 0)
const recebe = await chamar('POST', `/contas-receber/${contaDoPedido.id}/baixar`, {})
conferir('o restante é recebido em dinheiro', recebe.json.status === 'PAGA' && recebe.json.valorPago === 25700 && (await chamar('GET', '/contas-financeiras')).json[0].saldo === 20700)

// Permissões
const perfil = (await chamar('POST', '/perfis', { nome: 'Consulta devoluções', permissoes: ['DEVOLUCOES_VISUALIZAR'], dashboards: [] })).json
await chamar('POST', '/usuarios', { nome: 'Dora', email: 'dora@prumo.local', senha: 'senha-12345', perfilId: perfil.id })
sessao.token = (await chamar('POST', '/auth/login', { email: 'dora@prumo.local', senha: 'senha-12345' })).json.token
conferir('quem só visualiza vê devoluções e créditos', (await chamar('GET', '/devolucoes')).status === 200 && (await chamar('GET', '/creditos')).status === 200)
conferir('quem só visualiza não registra nem usa -> 403', (await devolver([{ pedidoItemId: itemB.id, quantidade: 1 }])).status === 403 && (await usar(lc[0].id, { contaReceberId: contaDoPedido.id, pessoaId: cliente.id, valor: 100 })).status === 403)

encerrar()
