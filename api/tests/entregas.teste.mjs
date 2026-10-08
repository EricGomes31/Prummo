// Logística: ciclo da entrega e vínculo com o cancelamento do pedido.
import { SENHA_ADMIN, chamar, conferir, encerrar, sessao } from './apoio.mjs'

const login = await chamar('POST', '/auth/login', { email: 'admin@prumo.local', senha: SENHA_ADMIN })
sessao.token = login.json.token
const eu = login.json.usuario.id

const sufixo = Date.now().toString(36)
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: 'ZZ Cliente Entrega', logradouro: 'Rua A', cidade: 'São Paulo' })).json
const prod = (await chamar('POST', '/produtos', { sku: `ZZ-${sufixo}`, nome: 'ZZ Produto Entrega', precoCusto: 100, precoVenda: 500 })).json
await chamar('POST', '/entradas', { data: '2026-10-07', itens: [{ produtoId: prod.id, quantidade: 10, custoUnitario: 100 }] })

async function pedidoFaturado() {
  const p = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 500 }] })).json
  await chamar('POST', `/pedidos/${p.id}/faturar`, { formaPagamento: 'PIX', primeiroVencimento: '2026-11-07' })
  return p.id
}
const dadosEntrega = { dataPrevista: '2026-10-08', destinatario: 'Fulano', logradouro: 'Rua A', numero: '10', cidade: 'São Paulo', uf: 'SP' }

const aberto = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 500 }] })).json
conferir('entrega de pedido em aberto -> 409', (await chamar('POST', '/entregas', { ...dadosEntrega, pedidoId: aberto.id })).status === 409)
await chamar('POST', `/pedidos/${aberto.id}/cancelar`)

const p1 = await pedidoFaturado()
let disp = (await chamar('GET', '/entregas/pedidos-disponiveis')).json
conferir('pedido faturado aparece como disponível', disp.some((p) => p.id === p1 && p.cliente.logradouro === 'Rua A'))
conferir('sem logradouro -> 400', (await chamar('POST', '/entregas', { ...dadosEntrega, logradouro: '', pedidoId: p1 })).status === 400)
const e1 = await chamar('POST', '/entregas', { ...dadosEntrega, pedidoId: p1 })
conferir('criar entrega', e1.status === 201 && e1.json.status === 'PENDENTE' && e1.json.pedido.cliente.nome === 'ZZ Cliente Entrega', JSON.stringify(e1.json?.erro ?? ''))
conferir('segunda entrega do mesmo pedido -> 409', (await chamar('POST', '/entregas', { ...dadosEntrega, pedidoId: p1 })).status === 409)
disp = (await chamar('GET', '/entregas/pedidos-disponiveis')).json
conferir('pedido sai dos disponíveis', !disp.some((p) => p.id === p1))

const id = e1.json.id
conferir('concluir sem sair -> 409', (await chamar('POST', `/entregas/${id}/concluir`, { recebedor: 'Maria' })).status === 409)
const ed = await chamar('PUT', `/entregas/${id}`, { ...dadosEntrega, numero: '22', dataPrevista: '2026-10-09' })
conferir('editar pendente', ed.status === 200 && ed.json.numero === '22')
const sair = await chamar('POST', `/entregas/${id}/sair`)
conferir('sair para entrega assume o usuário', sair.json.status === 'EM_ROTA' && sair.json.entregador?.id === eu && !!sair.json.saiuEm)
conferir('editar em rota -> 409', (await chamar('PUT', `/entregas/${id}`, dadosEntrega)).status === 409)
conferir('cancelar pedido com entrega em rota -> 409', (await chamar('POST', `/pedidos/${p1}/cancelar`)).status === 409)
conferir('falhar sem motivo -> 400', (await chamar('POST', `/entregas/${id}/falhar`, { motivo: '' })).status === 400)
const falha = await chamar('POST', `/entregas/${id}/falhar`, { motivo: 'Cliente ausente' })
conferir('registrar falha', falha.json.status === 'FALHOU' && falha.json.motivoFalha === 'Cliente ausente')
const rep = await chamar('POST', `/entregas/${id}/reprogramar`, { dataPrevista: '2026-10-12' })
conferir('reprogramar', rep.json.status === 'PENDENTE' && rep.json.saiuEm === null && rep.json.dataPrevista.startsWith('2026-10-12'))

const doDia = (await chamar('GET', '/entregas?status=ATIVAS&data=2026-10-12')).json
conferir('filtro por data e ativas', doDia.some((e) => e.id === id))
conferir('filtro de outro dia não traz', !(await chamar('GET', '/entregas?data=2026-10-13')).json.some((e) => e.id === id))
conferir('filtro por entregador', (await chamar('GET', `/entregas?entregadorId=${eu}`)).json.some((e) => e.id === id))
conferir('lista de entregadores', (await chamar('GET', '/entregas/entregadores')).json.some((u) => u.id === eu))

await chamar('POST', `/entregas/${id}/sair`)
const fim = await chamar('POST', `/entregas/${id}/concluir`, { recebedor: 'Maria' })
conferir('concluir', fim.json.status === 'ENTREGUE' && fim.json.recebedor === 'Maria' && !!fim.json.concluidaEm)
conferir('cancelar entrega entregue -> 409', (await chamar('POST', `/entregas/${id}/cancelar`)).status === 409)
conferir('cancelar pedido entregue -> 409', (await chamar('POST', `/pedidos/${p1}/cancelar`)).status === 409)

const p2 = await pedidoFaturado()
const e2 = (await chamar('POST', '/entregas', { ...dadosEntrega, pedidoId: p2 })).json
const resumo = (await chamar('GET', '/dashboard/resumo')).json
conferir('dashboard conta pendentes', resumo.entregas.pendentes >= 1, JSON.stringify(resumo.entregas))
const canc = await chamar('POST', `/pedidos/${p2}/cancelar`)
conferir('cancelar pedido com entrega pendente', canc.json.status === 'CANCELADO')
const e2depois = (await chamar('GET', '/entregas?status=CANCELADA')).json.find((e) => e.id === e2.id)
conferir('entrega pendente é cancelada junto', !!e2depois)

const p3 = await pedidoFaturado()
const e3 = (await chamar('POST', '/entregas', { ...dadosEntrega, pedidoId: p3 })).json
await chamar('POST', `/entregas/${e3.id}/cancelar`)
disp = (await chamar('GET', '/entregas/pedidos-disponiveis')).json
conferir('entrega cancelada libera o pedido', disp.some((p) => p.id === p3))

encerrar()
