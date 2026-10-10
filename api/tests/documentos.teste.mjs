// Anexos: envio, validações, listagem, download e remoção.
import { BASE, chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

const b64 = (texto) => Buffer.from(texto).toString('base64')
await entrarComoAdmin()

const prod = (await chamar('POST', '/produtos', { nome: 'Produto doc', precoVenda: 100 })).json
const entrada = (await chamar('POST', '/entradas', { data: '2026-10-07', itens: [{ produtoId: prod.id, quantidade: 1, custoUnitario: 50 }] })).json
const url = `/documentos/ENTRADA_ESTOQUE/${entrada.id}`

conferir('lista vazia', (await chamar('GET', url)).json.length === 0)
conferir('origem desconhecida -> 400', (await chamar('GET', '/documentos/OUTRA/1')).status === 400)
conferir('registro inexistente -> 404', (await chamar('POST', '/documentos/ENTRADA_ESTOQUE/99999', { nome: 'a.pdf', conteudo: b64('x') })).status === 404)
conferir('tipo não aceito -> 400', (await chamar('POST', url, { nome: 'virus.exe', conteudo: b64('x') })).status === 400)
conferir('html não é aceito -> 400', (await chamar('POST', url, { nome: 'pagina.html', conteudo: b64('<script>alert(1)</script>') })).status === 400)
conferir('arquivo vazio -> 400', (await chamar('POST', url, { nome: 'vazio.pdf', conteudo: '' })).status === 400)
conferir('conteúdo que não é base64 -> 400', (await chamar('POST', url, { nome: 'a.pdf', conteudo: 'não é base64!' })).status === 400)
const grande = await chamar('POST', url, { nome: 'grande.pdf', conteudo: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') })
conferir('mais de 10 MB -> 400', grande.status === 400 && grande.json.erro.includes('10 MB'), `${grande.status} ${grande.json?.erro ?? ''}`)

const conteudo = 'Nota fiscal de teste — ação, ç, ü.'
const nota = await chamar('POST', url, { nome: 'Nota fiscal nº 123.pdf', conteudo: b64(conteudo) })
conferir('anexa arquivo', nota.status === 201 && nota.json.nome === 'Nota fiscal nº 123.pdf' && nota.json.tamanho === Buffer.byteLength(conteudo) && !('arquivo' in nota.json), JSON.stringify(nota.json))
const caminho = await chamar('POST', url, { nome: '..\\..\\api\\.env.xml', conteudo: b64('<a/>') })
conferir('nome com caminho vira só o nome do arquivo', caminho.status === 201 && caminho.json.nome === '.env.xml', caminho.json?.nome)
conferir('lista os dois anexos', (await chamar('GET', url)).json.map((d) => d.nome).join() === 'Nota fiscal nº 123.pdf,.env.xml')
conferir('entrada informa quantos anexos tem', (await chamar('GET', '/entradas')).json.find((e) => e.id === entrada.id).documentos === 2)

const download = await fetch(`${BASE}/documentos/arquivo/${nota.json.id}`, { headers: { Authorization: `Bearer ${sessao.token}` } })
const baixado = Buffer.from(await download.arrayBuffer()).toString()
conferir('download devolve o mesmo conteúdo', download.status === 200 && baixado === conteudo)
conferir('download vem como anexo, com tipo pela extensão', download.headers.get('content-type') === 'application/pdf' && download.headers.get('content-disposition').startsWith('attachment;') && download.headers.get('x-content-type-options') === 'nosniff', download.headers.get('content-disposition'))
conferir('download sem token -> 401', (await fetch(`${BASE}/documentos/arquivo/${nota.json.id}`)).status === 401)
conferir('download inexistente -> 404', (await chamar('GET', '/documentos/arquivo/99999')).status === 404)

conferir('remove anexo', (await chamar('DELETE', `/documentos/arquivo/${caminho.json.id}`)).status === 204 && (await chamar('GET', url)).json.length === 1)
conferir('remover de novo -> 404', (await chamar('DELETE', `/documentos/arquivo/${caminho.json.id}`)).status === 404)
conferir('anexo de outra origem não se mistura', (await chamar('GET', `/documentos/PEDIDO/${entrada.id}`)).json.length === 0)

// Os anexos seguem as permissões da tela de onde vêm: um perfil só de pedidos não vê nem apaga a nota
// da entrada de estoque, mas anexa e vê os do pedido.
const admin = sessao.token
const perfil = (await chamar('POST', '/perfis', { nome: 'Só pedidos', permissoes: ['PEDIDOS_VISUALIZAR', 'PEDIDOS_CADASTRAR'], dashboards: [] })).json
await chamar('POST', '/usuarios', { nome: 'Paula', email: 'paula@prumo.local', senha: 'senha-12345', perfilId: perfil.id })
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente doc' })).json
const pedido = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 100 }] })).json
sessao.token = (await chamar('POST', '/auth/login', { email: 'paula@prumo.local', senha: 'senha-12345' })).json.token
conferir('sem permissão de estoque: não lista anexos da entrada -> 403', (await chamar('GET', url)).status === 403)
conferir('sem permissão de estoque: não baixa a nota -> 403', (await chamar('GET', `/documentos/arquivo/${nota.json.id}`)).status === 403)
conferir('sem permissão de estoque: não apaga a nota -> 403', (await chamar('DELETE', `/documentos/arquivo/${nota.json.id}`)).status === 403)
conferir('sem permissão de estoque: não anexa na entrada -> 403', (await chamar('POST', url, { nome: 'b.pdf', conteudo: b64('x') })).status === 403)
const doPedido = await chamar('POST', `/documentos/PEDIDO/${pedido.id}`, { nome: 'comprovante.pdf', conteudo: b64('pix') })
conferir('com permissão de pedidos: anexa no pedido', doPedido.status === 201, JSON.stringify(doPedido.json))
conferir('com permissão de pedidos: lista e baixa o anexo do pedido', (await chamar('GET', `/documentos/PEDIDO/${pedido.id}`)).json.length === 1 && (await chamar('GET', `/documentos/arquivo/${doPedido.json.id}`)).status === 200)
sessao.token = admin
conferir('a nota da entrada continua lá', (await chamar('GET', url)).json.length === 1)

encerrar()
