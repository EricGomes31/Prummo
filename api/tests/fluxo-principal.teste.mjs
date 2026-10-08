// Fluxo principal: login, permissões, entrada, pedido, faturamento, parcelas, cancelamento e inventário.
import { SENHA_ADMIN, chamar, conferir, encerrar, sessao } from './apoio.mjs'

conferir('sem token -> 401', (await chamar('GET', '/produtos')).status === 401)
conferir('senha errada -> 401', (await chamar('POST', '/auth/login', { email: 'admin@prumo.local', senha: 'errada-errada' })).status === 401)
const login = await chamar('POST', '/auth/login', { email: 'admin@prumo.local', senha: SENHA_ADMIN })
conferir('login', login.status === 200 && !!login.json.token)
sessao.token = login.json.token
conferir('me', (await chamar('GET', '/auth/me')).json.perfil === 'ADMIN')

const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente Teste' })).json
const fornecedor = (await chamar('POST', '/pessoas', { fornecedor: true, nome: 'Fornecedor Teste' })).json
const lista = await chamar('GET', '/pessoas?classificacao=cliente')
conferir('filtro de pessoas por tipo', lista.json.every((p) => p.cliente) && lista.json.some((p) => p.id === cliente.id))

const prod = (await chamar('POST', '/produtos', { sku: 'T-1', nome: 'Teste', precoCusto: 0, precoVenda: 1000 })).json
conferir('produto criado com saldo 0', prod.saldo === 0)
conferir('sku duplicado -> 409', (await chamar('POST', '/produtos', { sku: 'T-1', nome: 'Outro', precoCusto: 0, precoVenda: 1 })).status === 409)

const entrada = await chamar('POST', '/entradas', {
  fornecedorId: fornecedor.id, data: '2026-10-07', condicaoPagamento: '30',
  itens: [{ produtoId: prod.id, quantidade: 10, custoUnitario: 400 }],
})
conferir('entrada', entrada.status === 201 && entrada.json.total === 4000, JSON.stringify(entrada.json?.erro ?? ''))
let p = (await chamar('GET', '/produtos?busca=T-1')).json[0]
conferir('entrada soma saldo e atualiza custo', p.saldo === 10 && p.precoCusto === 400)
const pagar = (await chamar('GET', '/contas-pagar')).json
conferir('entrada gerou conta a pagar', pagar.some((c) => c.entradaId === entrada.json.id && c.valor === 4000))

const pedido = await chamar('POST', '/pedidos', { clienteId: cliente.id, desconto: 1, itens: [{ produtoId: prod.id, quantidade: 3, precoUnitario: 1000 }] })
conferir('pedido', pedido.status === 201 && pedido.json.total === 2999)
const demais = await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: prod.id, quantidade: 99, precoUnitario: 1000 }] })
conferir('faturar sem estoque -> 409', (await chamar('POST', `/pedidos/${demais.json.id}/faturar`, { formaPagamento: 'PIX', primeiroVencimento: '2026-10-31' })).status === 409)
const fat = await chamar('POST', `/pedidos/${pedido.json.id}/faturar`, { parcelas: 3, formaPagamento: 'PIX', primeiroVencimento: '2026-10-31' })
conferir('faturar', fat.status === 200 && fat.json.status === 'FATURADO', JSON.stringify(fat.json?.erro ?? ''))
conferir('faturar de novo -> 409', (await chamar('POST', `/pedidos/${pedido.json.id}/faturar`, { formaPagamento: 'PIX', primeiroVencimento: '2026-10-31' })).status === 409)
p = (await chamar('GET', '/produtos?busca=T-1')).json[0]
conferir('faturar baixa estoque', p.saldo === 7)
const det = (await chamar('GET', `/pedidos/${pedido.json.id}`)).json
const parcelas = det.contasReceber
conferir('3 parcelas somam o total', parcelas.length === 3 && parcelas.reduce((s, c) => s + c.valor, 0) === 2999, parcelas.map((c) => c.valor).join('+'))
conferir('vencimentos mensais com fim de mês', parcelas.map((c) => c.vencimento.slice(0, 10)).join(',') === '2026-10-31,2026-11-30,2026-12-31', parcelas.map((c) => c.vencimento.slice(0, 10)).join(','))

const baixa = await chamar('POST', `/contas-receber/${parcelas[0].id}/baixar`)
conferir('baixar parcela', baixa.json.status === 'PAGA')
conferir('baixar de novo -> 409', (await chamar('POST', `/contas-receber/${parcelas[0].id}/baixar`)).status === 409)
conferir('cancelar com parcela paga -> 409', (await chamar('POST', `/pedidos/${pedido.json.id}/cancelar`)).status === 409)
await chamar('POST', `/contas-receber/${parcelas[0].id}/estornar`)
const canc = await chamar('POST', `/pedidos/${pedido.json.id}/cancelar`)
conferir('cancelar após estorno', canc.json.status === 'CANCELADO')
p = (await chamar('GET', '/produtos?busca=T-1')).json[0]
conferir('cancelar devolve estoque', p.saldo === 10)
conferir('parcelas canceladas somem da lista', !(await chamar('GET', '/contas-receber')).json.some((c) => c.pedidoId === pedido.json.id))

const aj = await chamar('POST', `/produtos/${prod.id}/ajuste`, { novoSaldo: 8, observacao: 'contagem' })
conferir('ajuste de inventário', aj.json.saldo === 8)
const mov = (await chamar('GET', `/produtos/${prod.id}/movimentos`)).json
conferir('movimentos registrados', mov.length === 4 && mov[0].tipo === 'AJUSTE' && mov[0].quantidade === -2, `n=${mov.length}`)

const resumo = (await chamar('GET', '/dashboard/resumo')).json
conferir('dashboard', resumo.pagar.total === 4000 && resumo.vendas.pedidosAbertos === 1 && resumo.estoque.valor >= 3200, JSON.stringify(resumo).slice(0, 200))

const op = await chamar('POST', '/usuarios', { nome: 'Operador', email: 'op@prumo.local', senha: 'operador-123', perfil: 'OPERADOR' })
conferir('criar usuário', op.status === 201 && !('senhaHash' in op.json))
const admin = sessao.token
sessao.token = (await chamar('POST', '/auth/login', { email: 'op@prumo.local', senha: 'operador-123' })).json.token
conferir('operador não lista usuários -> 403', (await chamar('GET', '/usuarios')).status === 403)
conferir('operador lista produtos', (await chamar('GET', '/produtos')).status === 200)
const opToken = sessao.token
sessao.token = admin
await chamar('PUT', `/usuarios/${op.json.id}`, { nome: 'Operador', email: 'op@prumo.local', perfil: 'OPERADOR', ativo: false })
sessao.token = opToken
conferir('usuário desativado perde acesso -> 401', (await chamar('GET', '/produtos')).status === 401)

encerrar()
