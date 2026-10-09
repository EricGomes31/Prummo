// Links públicos: comprovante anexado pelo entregador, aviso de abertura do link, limite de tentativas
// e o link para o cliente atualizar o próprio cadastro.
import { BASE, chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

const hoje = new Date().toLocaleDateString('sv-SE')
await entrarComoAdmin()
const admin = sessao.token

// Rota com uma entrega
const motorista = (await chamar('POST', '/motoristas', { nome: 'Davi' })).json
const veiculo = (await chamar('POST', '/veiculos', { placa: 'LNK1A23', capacidadeKg: 50 })).json
const rota = (await chamar('POST', '/rotas', { nome: 'Rota Centro', data: hoje, motoristaId: motorista.id, veiculoId: veiculo.id, pontoSaida: 'Loja' })).json
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Clara Cadastro', email: 'antigo@exemplo.com', cidade: 'Vitória' })).json
const prod = (await chamar('POST', '/produtos', { sku: 'LK1', nome: 'Produto link', precoCusto: 100, precoVenda: 1000 })).json
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: prod.id, quantidade: 5, custoUnitario: 100 }] })
const pedido = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 1000 }] })).json
await chamar('POST', `/pedidos/${pedido.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'PIX' })
const entrega = (await chamar('POST', '/entregas', { pedidoId: pedido.id, dataPrevista: hoje, destinatario: 'Clara', logradouro: 'Rua B', cidade: 'Vitória' })).json
await chamar('PUT', `/entregas/${entrega.id}/rota`, { rotaId: rota.id })
const { chave } = (await chamar('POST', `/rotas/${rota.id}/link`, { horas: 2 })).json

const doEntregador = async (caminho, corpo, token = chave) => {
  const res = await fetch(`${BASE}/entregador/rotas/${rota.id}${caminho}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Rota-Token': token },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const rotaNoSistema = async () => (await chamar('GET', '/rotas')).json.find((r) => r.id === rota.id)

// Aviso de abertura
let r = await rotaNoSistema()
conferir('link ainda não aberto', r.linkAbertoEm === null && r.linkAcessos === 0)
conferir('entregador abre a rota', (await doEntregador('')).status === 200)
await doEntregador('')
r = await rotaNoSistema()
conferir('rota registra a abertura e os acessos', r.linkAbertoEm !== null && r.linkUltimoAcesso !== null && r.linkAcessos === 2)
conferir('início avisa que o link foi aberto', (await chamar('GET', '/dashboard/resumo')).json.avisos.linksAbertos.some((x) => x.id === rota.id))

// Comprovante da entrega
const foto = { nome: 'comprovante.jpg', conteudo: Buffer.from('imagem de teste').toString('base64') }
const enviado = await doEntregador(`/entregas/${entrega.id}/documentos`, foto)
conferir('entregador anexa o comprovante', enviado.status === 201 && enviado.json.entregas[0].documentos.length === 1 && enviado.json.entregas[0].documentos[0].nome === 'comprovante.jpg', JSON.stringify(enviado.json?.erro ?? ''))
conferir('entregador só envia imagem ou PDF -> 400', (await doEntregador(`/entregas/${entrega.id}/documentos`, { nome: 'nota.txt', conteudo: foto.conteudo })).status === 400)
conferir('entrega de outra rota -> 404', (await doEntregador('/entregas/999999/documentos', foto)).status === 404)
const anexos = (await chamar('GET', `/documentos/ENTREGA/${entrega.id}`)).json
conferir('o comprovante aparece nos documentos da entrega', anexos.length === 1)
conferir('o sistema também anexa documentos à entrega', (await chamar('POST', `/documentos/ENTREGA/${entrega.id}`, { nome: 'canhoto.pdf', conteudo: foto.conteudo })).status === 201)
const historico = (await chamar('GET', `/entregas/${entrega.id}/historico`)).json
conferir('o envio fica no histórico da entrega', historico.some((h) => h.origem === 'ENTREGADOR' && h.observacao.includes('Comprovante')))
const novo = (await chamar('POST', `/rotas/${rota.id}/link`, { horas: 2 })).json
conferir('link novo zera os acessos', (await rotaNoSistema()).linkAcessos === 0 && (await doEntregador('', undefined, novo.chave)).status === 200)

// Link de cadastro do cliente
const gerado = await chamar('POST', `/pessoas/${cliente.id}/link-cadastro`, { dias: 3 })
conferir('gera o link de cadastro', gerado.status === 200 && gerado.json.chave.length > 20, JSON.stringify(gerado.json?.erro ?? ''))
const pessoas = (await chamar('GET', '/pessoas')).json
conferir('o hash do link não aparece na lista', !pessoas.some((p) => 'cadastroLinkHash' in p) && pessoas.find((p) => p.id === cliente.id).cadastroLinkExpiraEm !== null)
const doCliente = async (metodo, corpo, token = gerado.json.chave) => {
  const res = await fetch(`${BASE}/cadastro/${cliente.id}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Cadastro-Token': token },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const aberto = await doCliente('GET')
conferir('cliente vê os próprios dados e o nome da empresa', aberto.status === 200 && aberto.json.nome === 'Clara Cadastro' && aberto.json.email === 'antigo@exemplo.com' && aberto.json.empresa.length > 0 && !('cliente' in aberto.json) && !('id' in aberto.json))
conferir('dados inválidos -> 400', (await doCliente('PUT', { nome: '' })).status === 400)
const salvo = await doCliente('PUT', { nome: 'Clara Cadastro Silva', email: 'novo@exemplo.com', celular: '27999998888', cidade: 'Serra', cliente: false, fornecedor: true })
conferir('cliente atualiza o cadastro', salvo.status === 200)
const atualizada = (await chamar('GET', '/pessoas')).json.find((p) => p.id === cliente.id)
conferir('dados gravados, classificação intocada', atualizada.nome === 'Clara Cadastro Silva' && atualizada.email === 'novo@exemplo.com' && atualizada.cidade === 'Serra' && atualizada.cliente === true && atualizada.fornecedor === false)
conferir('registra quando a pessoa atualizou', atualizada.cadastroAtualizadoEm !== null && atualizada.cadastroLinkExpiraEm === null)
conferir('o link vale uma vez -> 401', (await doCliente('GET')).status === 401)
conferir('início avisa da atualização', (await chamar('GET', '/dashboard/resumo')).json.avisos.cadastrosAtualizados.some((x) => x.id === cliente.id))
const outroLink = (await chamar('POST', `/pessoas/${cliente.id}/link-cadastro`, {})).json
await chamar('DELETE', `/pessoas/${cliente.id}/link-cadastro`)
conferir('link revogado -> 401', (await doCliente('GET', undefined, outroLink.chave)).status === 401)

// Permissão: quem só vê pessoas não gera link
const perfil = (await chamar('POST', '/perfis', { nome: 'Vê pessoas', permissoes: ['PESSOAS_VISUALIZAR'], dashboards: [] })).json
await chamar('POST', '/usuarios', { nome: 'Lia', email: 'lia@prumo.local', senha: 'senha-12345', perfilId: perfil.id })
sessao.token = (await chamar('POST', '/auth/login', { email: 'lia@prumo.local', senha: 'senha-12345' })).json.token
conferir('sem permissão de alterar pessoas, não gera link -> 403', (await chamar('POST', `/pessoas/${cliente.id}/link-cadastro`, {})).status === 403)
sessao.token = admin

// Limite de tentativas: depois de 10 chaves erradas (contando as dos testes acima), até a chave certa
// é recusada por um tempo, nos dois tipos de link
const respostas = []
for (let n = 0; n < 10; n++) respostas.push((await doEntregador('', undefined, `errada-${n}`)).status)
conferir('chave errada é recusada até o limite, depois bloqueia', respostas[0] === 401 && respostas.at(-1) === 429, respostas.join())
conferir('bloqueado, nem a chave certa entra -> 429', (await doEntregador('', undefined, novo.chave)).status === 429 && (await doCliente('GET', undefined, 'qualquer')).status === 429)

encerrar()
