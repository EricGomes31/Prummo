// Logística: motoristas, veículos, rotas com sequência de paradas, link do entregador e histórico da entrega.
import { BASE, chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

const dia = (deslocamento) => new Date(Date.now() + deslocamento * 864e5).toLocaleDateString('sv-SE')
const hoje = dia(0)
await entrarComoAdmin()
const admin = sessao.token

// Motoristas e veículos
const motorista = await chamar('POST', '/motoristas', { nome: 'Xavier', telefone: '27999990000', cnh: '123456', validadeCnh: dia(365) })
conferir('cadastra motorista', motorista.status === 201 && motorista.json.ativo === true && motorista.json.validadeCnh !== null)
conferir('motorista sem nome -> 400', (await chamar('POST', '/motoristas', { nome: '' })).status === 400)
const inativo = (await chamar('POST', '/motoristas', { nome: 'Antigo', ativo: false })).json
const veiculo = await chamar('POST', '/veiculos', { placa: 'abc1d23', descricao: 'Moto', capacidadeKg: 5 })
conferir('cadastra veículo com a placa em maiúsculas', veiculo.status === 201 && veiculo.json.placa === 'ABC1D23' && veiculo.json.capacidadeKg === 5)
conferir('placa repetida -> 409', (await chamar('POST', '/veiculos', { placa: 'ABC1D23', capacidadeKg: 1 })).status === 409)
conferir('capacidade zero -> 400', (await chamar('POST', '/veiculos', { placa: 'XYZ9A88', capacidadeKg: 0 })).status === 400)
conferir('listas de motoristas e veículos', (await chamar('GET', '/motoristas')).json.length === 2 && (await chamar('GET', '/veiculos')).json.length === 1)

// Rota
const novaRota = (dados) => chamar('POST', '/rotas', { nome: 'Rota Sul', data: hoje, motoristaId: motorista.json.id, veiculoId: veiculo.json.id, pontoSaida: 'Depósito', latitudeSaida: 0, longitudeSaida: 0, ...dados })
const rota = await novaRota({})
conferir('cadastra rota', rota.status === 201 && rota.json.motorista.nome === 'Xavier' && rota.json.veiculo.placa === 'ABC1D23' && rota.json.linkAtivo === false && rota.json.cargaKg === 0, JSON.stringify(rota.json?.erro ?? ''))
conferir('rota não devolve a chave do link', !('linkHash' in rota.json))
conferir('motorista inativo -> 400', (await novaRota({ motoristaId: inativo.id })).status === 400)
conferir('rota sem ponto de saída -> 400', (await novaRota({ pontoSaida: '' })).status === 400)
const outraRota = (await novaRota({ nome: 'Rota Norte' })).json

// Três vendas faturadas, cada uma com sua entrega de 2 kg
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente Rota', logradouro: 'Rua A', cidade: 'Serra', uf: 'ES' })).json
const prod = (await chamar('POST', '/produtos', { sku: 'LG1', nome: 'Produto rota', precoCusto: 100, precoVenda: 1000 })).json
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: prod.id, quantidade: 20, custoUnitario: 100 }] })
async function entrega(longitude, extra) {
  const pedido = (await chamar('POST', '/pedidos', { clienteId: cliente.id, observacao: 'Frágil', itens: [{ produtoId: prod.id, quantidade: 2, precoUnitario: 1000 }] })).json
  await chamar('POST', `/pedidos/${pedido.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'PIX' })
  return chamar('POST', '/entregas', { pedidoId: pedido.id, dataPrevista: hoje, destinatario: 'Fulano', telefone: '27988887777', logradouro: 'Rua A', numero: '10', cidade: 'Serra', uf: 'ES', pesoKg: 2, latitude: 0, longitude, ...extra })
}
const e1 = (await entrega(3, { inicioRecebimento: '08:00', fimRecebimento: '12:30', observacao: 'Portaria' })).json
const e2 = (await entrega(1)).json
const e3 = (await entrega(2)).json
conferir('entrega guarda peso, coordenadas e janela', e1.pesoKg === 2 && e1.longitude === 3 && e1.inicioRecebimento === '08:00' && e1.fimRecebimento === '12:30' && e1.rota === null)
conferir('horário inválido -> 400', (await entrega(4, { inicioRecebimento: '25:00' })).status === 400)

// Entregas na rota: capacidade do veículo e sequência
const naRota = (id, rotaId) => chamar('PUT', `/entregas/${id}/rota`, { rotaId })
const primeira = await naRota(e1.id, rota.json.id)
conferir('entrega entra no fim da sequência', primeira.json.rota.id === rota.json.id && primeira.json.sequencia === 1 && (await naRota(e2.id, rota.json.id)).json.sequencia === 2)
conferir('carga acima da capacidade -> 400', (await naRota(e3.id, rota.json.id)).status === 400)
await chamar('PUT', `/veiculos/${veiculo.json.id}`, { placa: 'ABC1D23', descricao: 'Furgão', capacidadeKg: 10 })
conferir('com mais capacidade a terceira entra', (await naRota(e3.id, rota.json.id)).json.sequencia === 3)
const rotas = async () => (await chamar('GET', '/rotas')).json
const aRota = async () => (await rotas()).find((r) => r.id === rota.json.id)
conferir('rota soma a carga e lista as paradas em ordem', (await aRota()).cargaKg === 6 && (await aRota()).entregas.map((e) => e.id).join() === [e1.id, e2.id, e3.id].join())
const reordenada = await chamar('PUT', `/rotas/${rota.json.id}/sequencia`, { entregaIds: [e3.id, e1.id, e2.id] })
conferir('sequência manual', reordenada.json.entregas.map((e) => e.id).join() === [e3.id, e1.id, e2.id].join())
conferir('sequência incompleta -> 400', (await chamar('PUT', `/rotas/${rota.json.id}/sequencia`, { entregaIds: [e1.id, e2.id] })).status === 400)
const organizada = await chamar('POST', `/rotas/${rota.json.id}/organizar`)
conferir('organizar ordena pela parada mais próxima da saída', organizada.json.entregas.map((e) => e.id).join() === [e2.id, e3.id, e1.id].join(), organizada.json.entregas?.map((e) => e.id).join())
conferir('organizar pede ao menos duas entregas com coordenadas -> 400', (await chamar('POST', `/rotas/${outraRota.id}/organizar`)).status === 400)

// Link do entregador: público, só com a chave
const link = await chamar('POST', `/rotas/${rota.json.id}/link`, { horas: 2 })
conferir('gera o link com validade', link.status === 200 && link.json.chave.length >= 24 && new Date(link.json.expiraEm) > new Date() && (await aRota()).linkAtivo === true)
conferir('validade fora de 1 a 168 horas -> 400', (await chamar('POST', `/rotas/${rota.json.id}/link`, { horas: 0 })).status === 400 && (await chamar('POST', `/rotas/${rota.json.id}/link`, { horas: 169 })).status === 400)
const entregador = async (chave, caminho = '', corpo) => {
  const res = await fetch(`${BASE}/entregador/rotas/${rota.json.id}${caminho}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(chave ? { 'X-Rota-Token': chave } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
sessao.token = ''
conferir('sem login o sistema continua fechado -> 401', (await chamar('GET', '/rotas')).status === 401)
conferir('link sem chave ou com chave errada -> 401', (await entregador('')).status === 401 && (await entregador('chave-errada')).status === 401)
const vista = await entregador(link.json.chave)
conferir('entregador vê a rota com as paradas em ordem', vista.status === 200 && vista.json.nome === 'Rota Sul' && vista.json.entregas.map((e) => e.id).join() === [e2.id, e3.id, e1.id].join())
const parada = vista.json.entregas.find((e) => e.id === e1.id)
conferir('parada traz endereço, itens, valor, pagamento e janela', parada.endereco.includes('Rua A, 10') && parada.itens[0].quantidade === 2 && parada.itens[0].produto === 'Produto rota' && parada.valorPedido === 2000 && parada.pagamento === 'PIX' && parada.inicioRecebimento === '08:00' && parada.observacaoEntrega === 'Portaria' && parada.observacaoVenda === 'Frágil')
const acao = (id, corpo) => entregador(link.json.chave, `/entregas/${id}`, corpo)
conferir('entregador inicia a entrega', (await acao(e2.id, { status: 'EM_ROTA' })).json.entregas.find((e) => e.id === e2.id).status === 'EM_ROTA')
conferir('entrega sem quem recebeu -> 400', (await acao(e2.id, { status: 'ENTREGUE' })).status === 400)
conferir('entregador confirma a entrega', (await acao(e2.id, { status: 'ENTREGUE', recebedor: 'Porteiro José', observacao: 'Deixado na portaria' })).json.entregas.find((e) => e.id === e2.id).status === 'ENTREGUE')
conferir('pular etapa não é aceito -> 409', (await acao(e3.id, { status: 'ENTREGUE', recebedor: 'Alguém' })).status === 409)
await acao(e3.id, { status: 'EM_ROTA' })
conferir('tentativa sem sucesso exige o motivo -> 400', (await acao(e3.id, { status: 'FALHOU' })).status === 400)
conferir('entregador registra a tentativa sem sucesso', (await acao(e3.id, { status: 'FALHOU', observacao: 'Ninguém em casa' })).json.entregas.find((e) => e.id === e3.id).motivoFalha === 'Ninguém em casa')
conferir('entrega de outra rota -> 404', (await acao(999999, { status: 'EM_ROTA' })).status === 404)

// De volta ao sistema: histórico e efeitos
sessao.token = admin
const historico = (await chamar('GET', `/entregas/${e2.id}/historico`)).json
conferir('histórico registra cada passo e quem fez', historico.length === 4 && historico[0].status === 'ENTREGUE' && historico[0].origem === 'ENTREGADOR' && historico[0].observacao.includes('Porteiro José') && historico[3].usuario.nome === 'Administrador' && historico[2].observacao.includes('Rota Sul'), JSON.stringify(historico.map((h) => h.status)))
conferir('entrega em rota não troca de rota -> 409', (await naRota(e2.id, null)).status === 409)
const reprogramada = await chamar('POST', `/entregas/${e3.id}/reprogramar`, { dataPrevista: dia(1) })
conferir('reprogramar tira a entrega da rota', reprogramada.json.status === 'PENDENTE' && reprogramada.json.rota === null && (await aRota()).entregas.length === 2)
conferir('entrega pendente sai da rota', (await naRota(e1.id, null)).json.rota === null && (await aRota()).cargaKg === 2)

// Gerar de novo invalida a chave antiga; revogar fecha o link
const novoLink = (await chamar('POST', `/rotas/${rota.json.id}/link`, {})).json
conferir('nova chave invalida a anterior', (await entregador(link.json.chave)).status === 401 && (await entregador(novoLink.chave)).status === 200)
conferir('revogar o link', (await chamar('DELETE', `/rotas/${rota.json.id}/link`)).status === 204 && (await entregador(novoLink.chave)).status === 401 && (await aRota()).linkAtivo === false)

encerrar()
