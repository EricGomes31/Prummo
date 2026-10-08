// Perfis de acesso: perfis de fábrica, perfis personalizados e a permissão exigida por cada rota.
import { SENHA_ADMIN, chamar, conferir, encerrar, sessao } from './apoio.mjs'

const hoje = new Date().toLocaleDateString('sv-SE')
const entrar = async (email, senha) => (await chamar('POST', '/auth/login', { email, senha })).json
const admin = await entrar('admin@prumo.local', SENHA_ADMIN)
const comoAdmin = () => (sessao.token = admin.token)
comoAdmin()

// Perfis de fábrica e catálogo
conferir('login já traz os acessos', admin.usuario.perfilNome === 'Administrador' && admin.usuario.permissoes.includes('USUARIOS_GERENCIAR') && admin.usuario.dashboards.length === 2)
const perfis = (await chamar('GET', '/perfis')).json
const todas = perfis.catalogo.grupos.flatMap((g) => g.permissoes.map((p) => p.codigo))
const operadorPadrao = perfis.padrao.find((p) => p.codigo === 'OPERADOR')
conferir('administrador de fábrica tem todas as permissões', perfis.padrao.find((p) => p.codigo === 'ADMIN').permissoes.length === todas.length && todas.length > 20)
conferir('operador de fábrica não gerencia usuários nem campanhas', !operadorPadrao.permissoes.includes('USUARIOS_GERENCIAR') && !operadorPadrao.permissoes.includes('PROMOCOES_GERENCIAR') && operadorPadrao.permissoes.includes('PEDIDOS_FATURAR'))
conferir('catálogo traz os dashboards', perfis.catalogo.dashboards.map((d) => d.codigo).join() === 'COMERCIAL,FINANCEIRO')

// Cadastro de perfil personalizado
const novoPerfil = (dados) => chamar('POST', '/perfis', { nome: 'Vendas', descricao: 'Só pedidos', permissoes: ['PEDIDOS_VISUALIZAR', 'PEDIDOS_CADASTRAR'], dashboards: ['COMERCIAL'], ...dados })
const vendas = await novoPerfil({})
conferir('cria perfil personalizado', vendas.status === 201 && vendas.json.permissoes.length === 2 && vendas.json.ativo === true, JSON.stringify(vendas.json?.erro ?? ''))
conferir('permissão inexistente -> 400', (await novoPerfil({ nome: 'X', permissoes: ['VOAR'] })).status === 400)
conferir('dashboard inexistente -> 400', (await novoPerfil({ nome: 'Y', dashboards: ['SECRETO'] })).status === 400)
conferir('nome repetido -> 409', (await novoPerfil({})).status === 409)
conferir('usuário com perfil inexistente -> 400', (await chamar('POST', '/usuarios', { nome: 'Zé', email: 'ze@prumo.local', senha: 'senha-12345', perfilId: 9999 })).status === 400)
const vendedor = await chamar('POST', '/usuarios', { nome: 'Vânia', email: 'vania@prumo.local', senha: 'senha-12345', perfilId: vendas.json.id })
conferir('usuário recebe o perfil personalizado', vendedor.status === 201 && vendedor.json.perfilNome === 'Vendas' && vendedor.json.perfilId === vendas.json.id)
conferir('lista de perfis conta os usuários', (await chamar('GET', '/perfis')).json.personalizados.find((p) => p.id === vendas.json.id).usuarios === 1)

// O que o perfil "Vendas" pode e não pode
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente Perfis' })).json
const prod = (await chamar('POST', '/produtos', { sku: 'PF1', nome: 'Produto perfis', precoCusto: 100, precoVenda: 1000 })).json
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: prod.id, quantidade: 5, custoUnitario: 100 }] })
const vania = await entrar('vania@prumo.local', 'senha-12345')
sessao.token = vania.token
const status = async (metodo, caminho, corpo) => (await chamar(metodo, caminho, corpo)).status
conferir('sessão traz só os acessos do perfil', vania.usuario.permissoes.length === 2 && vania.usuario.dashboards.join() === 'COMERCIAL' && vania.usuario.perfilNome === 'Vendas')
conferir('vê pedidos', (await status('GET', '/pedidos')) === 200)
conferir('consulta pessoas e produtos para montar o pedido', (await status('GET', '/pessoas')) === 200 && (await status('GET', '/produtos')) === 200 && (await status('GET', '/promocoes')) === 200)
const pedido = await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 1000 }] })
conferir('cria pedido', pedido.status === 201)
conferir('não cadastra pessoa -> 403', (await status('POST', '/pessoas', { cliente: true, nome: 'Intruso' })) === 403)
conferir('não fatura -> 403', (await status('POST', `/pedidos/${pedido.json.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'PIX' })) === 403)
conferir('não cancela -> 403', (await status('POST', `/pedidos/${pedido.json.id}/cancelar`)) === 403)
conferir('não vê o financeiro -> 403', (await status('GET', '/contas-receber')) === 403 && (await status('GET', '/contas-financeiras')) === 403 && (await status('GET', '/movimentos-financeiros')) === 403)
conferir('não ajusta estoque nem vê relatórios -> 403', (await status('POST', `/produtos/${prod.id}/ajuste`, { novoSaldo: 1 })) === 403 && (await status('GET', '/relatorios/vendas')) === 403)
conferir('não gerencia usuários nem perfis -> 403', (await status('GET', '/usuarios')) === 403 && (await status('GET', '/perfis')) === 403 && (await status('PUT', `/perfis/${vendas.json.id}`, { nome: 'Vendas', permissoes: todas, dashboards: [] })) === 403)
conferir('dashboard liberado e dashboard bloqueado', (await status('GET', '/dashboards/comercial')) === 200 && (await status('GET', '/dashboards/financeiro')) === 403)
conferir('início e a própria sessão valem para todos', (await status('GET', '/dashboard/resumo')) === 200 && (await status('GET', '/auth/me')) === 200)

// Mudar o perfil vale na hora, sem novo login
comoAdmin()
const ampliado = await chamar('PUT', `/perfis/${vendas.json.id}`, { nome: 'Vendas', descricao: 'Pedidos e faturamento', permissoes: ['PEDIDOS_VISUALIZAR', 'PEDIDOS_CADASTRAR', 'PEDIDOS_FATURAR'], dashboards: [] })
conferir('altera o perfil', ampliado.status === 200 && ampliado.json.permissoes.length === 3)
sessao.token = vania.token
conferir('nova permissão vale na hora', (await status('POST', `/pedidos/${pedido.json.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'PIX' })) === 200)
conferir('dashboard retirado deixa de abrir', (await status('GET', '/dashboards/comercial')) === 403)
comoAdmin()
await chamar('PUT', `/perfis/${vendas.json.id}`, { nome: 'Vendas', permissoes: ['PEDIDOS_VISUALIZAR'], dashboards: [], ativo: false })
sessao.token = vania.token
conferir('perfil inativo deixa o usuário sem acessos', (await status('GET', '/pedidos')) === 403 && (await chamar('GET', '/auth/me')).json.permissoes.length === 0)

// Perfis de fábrica continuam valendo
comoAdmin()
await chamar('POST', '/usuarios', { nome: 'Olga', email: 'olga@prumo.local', senha: 'senha-12345', perfil: 'OPERADOR' })
const voltou = await chamar('PUT', `/usuarios/${vendedor.json.id}`, { nome: 'Vânia', email: 'vania@prumo.local', perfil: 'ADMIN', perfilId: null, ativo: true })
conferir('usuário volta para um perfil de fábrica', voltou.json.perfilId === null && voltou.json.perfil === 'ADMIN' && voltou.json.perfilNome === 'Administrador')
sessao.token = (await entrar('olga@prumo.local', 'senha-12345')).token
conferir('operador trabalha mas não gerencia', (await status('POST', '/pessoas', { cliente: true, nome: 'Cliente da Olga' })) === 201 && (await status('GET', '/usuarios')) === 403 && (await status('GET', '/contas-receber')) === 200)

// Ninguém tira de si mesmo o gerenciamento de usuários
comoAdmin()
const gerentes = (await chamar('POST', '/perfis', { nome: 'Gerentes', permissoes: ['USUARIOS_GERENCIAR', 'PESSOAS_VISUALIZAR'], dashboards: [] })).json
const gil = (await chamar('POST', '/usuarios', { nome: 'Gil', email: 'gil@prumo.local', senha: 'senha-12345', perfilId: gerentes.id })).json
sessao.token = (await entrar('gil@prumo.local', 'senha-12345')).token
conferir('perfil personalizado pode gerenciar usuários', (await status('GET', '/usuarios')) === 200)
conferir('não tira do próprio perfil o gerenciamento -> 400', (await status('PUT', `/perfis/${gerentes.id}`, { nome: 'Gerentes', permissoes: ['PESSOAS_VISUALIZAR'], dashboards: [] })) === 400)
conferir('não desativa o próprio perfil -> 400', (await status('PUT', `/perfis/${gerentes.id}`, { nome: 'Gerentes', permissoes: ['USUARIOS_GERENCIAR'], dashboards: [], ativo: false })) === 400)
conferir('não se rebaixa para operador -> 400', (await status('PUT', `/usuarios/${gil.id}`, { nome: 'Gil', email: 'gil@prumo.local', perfil: 'OPERADOR', perfilId: null, ativo: true })) === 400)
conferir('pode trocar o próprio nome mantendo o perfil', (await status('PUT', `/usuarios/${gil.id}`, { nome: 'Gilberto', email: 'gil@prumo.local', perfilId: gerentes.id, ativo: true })) === 200)

encerrar()
