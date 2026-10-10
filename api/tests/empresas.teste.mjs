// Separação por empresa: cada empresa só vê e só altera os próprios dados, inclusive quando recebe o id
// de um registro de outra. Também cobre a administração das empresas pelo administrador do sistema.
import { chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

await entrarComoAdmin()
const admin = sessao.token
const eu = (await chamar('GET', '/auth/me')).json
conferir('sessão traz a empresa e o administrador do sistema', eu.sistema === true && !!eu.empresa?.id && !!eu.empresa?.nome)

// Dados da primeira empresa.
const cliente1 = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente da Empresa 1' })).json
const produto1 = (await chamar('POST', '/produtos', { sku: 'ISO-1', nome: 'Produto da Empresa 1', precoCusto: 100, precoVenda: 500 })).json
const perfil1 = (await chamar('POST', '/perfis', { nome: 'Vendas', permissoes: ['PEDIDOS_VISUALIZAR'], dashboards: [] })).json
const pedirNa1 = async () => (await chamar('POST', '/pedidos', { clienteId: cliente1.id, itens: [{ produtoId: produto1.id, quantidade: 1, precoUnitario: 500 }] })).json
const pedidosDa1 = [await pedirNa1(), await pedirNa1()]
conferir('pedidos numerados em sequência', pedidosDa1[0].numero === 1 && pedidosDa1[1].numero === 2, pedidosDa1.map((p) => p.numero).join())

// Criação de outra empresa.
const corpo = { nome: 'Empresa Dois', documento: '12345678000199', administrador: { nome: 'Dona da Dois', email: 'dona@dois.test', senha: 'senha-da-dois' } }
const criada = await chamar('POST', '/sistema/empresas', corpo)
conferir('criar empresa', criada.status === 201 && criada.json.nome === 'Empresa Dois' && criada.json.usuarios === 1, JSON.stringify(criada.json))
conferir('e-mail já usado -> 409', (await chamar('POST', '/sistema/empresas', { ...corpo, nome: 'Três' })).status === 409)
const empresas = (await chamar('GET', '/sistema/empresas')).json
conferir('lista de empresas', empresas.length === 2 && empresas.some((e) => e.id === criada.json.id))
conferir('não desativa a própria empresa -> 400', (await chamar('PUT', `/sistema/empresas/${eu.empresa.id}`, { nome: eu.empresa.nome, ativa: false })).status === 400)

// Entrando na empresa nova.
const login2 = await chamar('POST', '/auth/login', { email: 'dona@dois.test', senha: 'senha-da-dois' })
conferir('administrador da empresa nova entra', login2.status === 200)
sessao.token = login2.json.token
const eu2 = (await chamar('GET', '/auth/me')).json
conferir('sessão na empresa nova', eu2.empresa.id === criada.json.id && eu2.sistema === false && eu2.perfil === 'ADMIN')
conferir('quem não é do sistema não vê as empresas -> 403', (await chamar('GET', '/sistema/empresas')).status === 403)
conferir('não cria empresa -> 403', (await chamar('POST', '/sistema/empresas', { ...corpo, administrador: { ...corpo.administrador, email: 'x@x.test' } })).status === 403)

// Nada da primeira empresa aparece.
conferir('pessoas vazias', (await chamar('GET', '/pessoas')).json.length === 0)
conferir('produtos vazios', (await chamar('GET', '/produtos')).json.length === 0)
conferir('pedidos vazios', (await chamar('GET', '/pedidos')).json.length === 0)
const usuarios2 = (await chamar('GET', '/usuarios')).json
conferir('só os usuários da própria empresa', usuarios2.length === 1 && usuarios2[0].email === 'dona@dois.test')
const perfis2 = (await chamar('GET', '/perfis')).json
conferir('só os perfis da própria empresa', perfis2.personalizados.length === 0)
const contas2 = (await chamar('GET', '/contas-financeiras')).json
conferir('empresa nova já vem com o próprio caixa', contas2.length === 1 && contas2[0].nome === 'Caixa', JSON.stringify(contas2))

// Ids de outra empresa não servem para nada.
conferir('alterar pessoa alheia -> 404', (await chamar('PUT', `/pessoas/${cliente1.id}`, { cliente: true, nome: 'Invadido' })).status === 404)
conferir('apagar pessoa alheia -> 404', (await chamar('DELETE', `/pessoas/${cliente1.id}`)).status === 404)
conferir('alterar produto alheio -> 404', (await chamar('PUT', `/produtos/${produto1.id}`, { sku: 'ISO-1', nome: 'Invadido', precoCusto: 0, precoVenda: 1 })).status === 404)
conferir('movimentos de produto alheio -> 404', (await chamar('GET', `/produtos/${produto1.id}/movimentos`)).status === 404)

// Os mesmos códigos podem existir em empresas diferentes.
const produto2 = await chamar('POST', '/produtos', { sku: 'ISO-1', nome: 'Produto da Empresa 2', precoCusto: 100, precoVenda: 700 })
conferir('mesmo SKU em outra empresa', produto2.status === 201)
conferir('mesmo nome de perfil em outra empresa', (await chamar('POST', '/perfis', { nome: 'Vendas', permissoes: [], dashboards: [] })).status === 201)
const cliente2 = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente da Empresa 2' })).json

// Ligar registros próprios a registros alheios é recusado (pela API ou pela trava do banco).
const comClienteAlheio = await chamar('POST', '/pedidos', { clienteId: cliente1.id, itens: [{ produtoId: produto2.json.id, quantidade: 1, precoUnitario: 700 }] })
conferir('pedido com cliente alheio -> recusado', comClienteAlheio.status >= 400 && comClienteAlheio.status < 500, `${comClienteAlheio.status}`)
const comProdutoAlheio = await chamar('POST', '/pedidos', { clienteId: cliente2.id, itens: [{ produtoId: produto1.id, quantidade: 1, precoUnitario: 500 }] })
conferir('pedido com produto alheio -> recusado', comProdutoAlheio.status >= 400 && comProdutoAlheio.status < 500, `${comProdutoAlheio.status}`)
const usuarioPerfilAlheio = await chamar('POST', '/usuarios', { nome: 'Vendedor', email: 'vend@dois.test', senha: 'senha-vendedor', perfilId: perfil1.id })
conferir('usuário com perfil alheio -> recusado', usuarioPerfilAlheio.status === 400, `${usuarioPerfilAlheio.status}`)
const pedido2 = await chamar('POST', '/pedidos', { clienteId: cliente2.id, itens: [{ produtoId: produto2.json.id, quantidade: 1, precoUnitario: 700 }] })
conferir('pedido com dados próprios', pedido2.status === 201, JSON.stringify(pedido2.json))
conferir('empresa nova começa no pedido nº 1', pedido2.json.numero === 1, `${pedido2.json.numero}`)
const outroPedido2 = await chamar('POST', '/pedidos', { clienteId: cliente2.id, itens: [{ produtoId: produto2.json.id, quantidade: 1, precoUnitario: 700 }] })
conferir('e segue a própria contagem', outroPedido2.json.numero === 2, `${outroPedido2.json.numero}`)

// A trava do banco, direto, sem a API: gravar ligando registros de empresas diferentes é recusado,
// e gravar sem informar a empresa também.
const banco = process.env.TESTE_BANCO ?? ''
if (/^postgresql:\/\/prumo:prumo@127\.0\.0\.1:\d+\/suite_/.test(banco)) {
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient({ datasourceUrl: banco })
  const recusa = async (gravar) => gravar.then(() => '', (e) => String(e.message))
  const misturado = await recusa(db.pedido.create({ data: { empresaId: criada.json.id, numero: 900, clienteId: cliente1.id, subtotal: 0, total: 0 } }))
  conferir('banco recusa pedido ligado a cliente de outra empresa', misturado.includes('PRUMO_OUTRA_EMPRESA'), misturado.slice(0, 200))
  const semEmpresa = await recusa(db.pessoa.create({ data: { nome: 'Sem empresa' } }))
  conferir('banco recusa gravação sem empresa', semEmpresa.includes('prumo.empresa'), semEmpresa.slice(0, 200))
  const mesmo = await recusa(db.pedido.create({ data: { empresaId: criada.json.id, numero: 901, clienteId: cliente2.id, subtotal: 0, total: 0 } }))
  conferir('banco aceita ligação dentro da mesma empresa', mesmo === '', mesmo.slice(0, 200))
  const repetido = await recusa(db.pedido.create({ data: { empresaId: criada.json.id, numero: 1, clienteId: cliente2.id, subtotal: 0, total: 0 } }))
  conferir('banco recusa número de pedido repetido na mesma empresa', repetido.includes('Unique constraint'), repetido.slice(0, 200))
  await db.$disconnect()
} else {
  conferir('endereço do banco de teste recebido do executor', false, banco)
}

// De volta à primeira empresa: nada da segunda aparece e nada da primeira mudou.
sessao.token = admin
conferir('primeira empresa não vê o pedido da segunda', !(await chamar('GET', '/pedidos')).json.some((p) => p.id === pedido2.json.id))
const produtos1 = (await chamar('GET', '/produtos')).json
conferir('produto da primeira empresa intacto', produtos1.some((p) => p.id === produto1.id && p.nome === 'Produto da Empresa 1') && !produtos1.some((p) => p.id === produto2.json.id))
conferir('pessoa da primeira empresa intacta', (await chamar('GET', '/pessoas')).json.some((p) => p.id === cliente1.id && p.nome === 'Cliente da Empresa 1'))
conferir('usuários da primeira empresa sem os da segunda', !(await chamar('GET', '/usuarios')).json.some((u) => u.email === 'dona@dois.test'))

// Desativar a empresa tira o acesso, inclusive de quem já estava logado.
conferir('desativar empresa', (await chamar('PUT', `/sistema/empresas/${criada.json.id}`, { nome: 'Empresa Dois', ativa: false })).json.ativa === false)
sessao.token = login2.json.token
conferir('sessão aberta de empresa inativa -> 401', (await chamar('GET', '/auth/me')).status === 401)
conferir('login de empresa inativa -> 401', (await chamar('POST', '/auth/login', { email: 'dona@dois.test', senha: 'senha-da-dois' })).status === 401)
sessao.token = admin
await chamar('PUT', `/sistema/empresas/${criada.json.id}`, { nome: 'Empresa Dois', ativa: true })
conferir('reativada, volta a entrar', (await chamar('POST', '/auth/login', { email: 'dona@dois.test', senha: 'senha-da-dois' })).status === 200)

// O administrador do sistema redefine a senha de quem esqueceu, em qualquer empresa.
const usuariosDaDois = await chamar('GET', `/sistema/empresas/${criada.json.id}/usuarios`)
conferir('lista os usuários da outra empresa', usuariosDaDois.status === 200 && usuariosDaDois.json.length === 1 && usuariosDaDois.json[0].email === 'dona@dois.test', JSON.stringify(usuariosDaDois.json))
conferir('a lista não traz a senha', !('senhaHash' in usuariosDaDois.json[0]))
const dona = usuariosDaDois.json[0]
conferir('senha curta -> 400', (await chamar('PUT', `/sistema/empresas/${criada.json.id}/usuarios/${dona.id}/senha`, { senha: 'curta' })).status === 400)
conferir('usuário de outra empresa pelo caminho errado -> 404', (await chamar('PUT', `/sistema/empresas/${eu.empresa.id}/usuarios/${dona.id}/senha`, { senha: 'senha-provisoria' })).status === 404)
conferir('empresa que não existe -> 404', (await chamar('GET', '/sistema/empresas/99999/usuarios')).status === 404)
conferir('redefinir senha', (await chamar('PUT', `/sistema/empresas/${criada.json.id}/usuarios/${dona.id}/senha`, { senha: 'senha-provisoria' })).status === 204)
conferir('a senha antiga não entra mais', (await chamar('POST', '/auth/login', { email: 'dona@dois.test', senha: 'senha-da-dois' })).status === 401)
const comProvisoria = await chamar('POST', '/auth/login', { email: 'dona@dois.test', senha: 'senha-provisoria' })
conferir('entra com a senha provisória', comProvisoria.status === 200)
sessao.token = comProvisoria.json.token
conferir('quem não é do sistema não lista usuários de empresas -> 403', (await chamar('GET', `/sistema/empresas/${eu.empresa.id}/usuarios`)).status === 403)
conferir('nem redefine senhas -> 403', (await chamar('PUT', `/sistema/empresas/${criada.json.id}/usuarios/${dona.id}/senha`, { senha: 'outra-senha-1' })).status === 403)
sessao.token = admin

encerrar()
