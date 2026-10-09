// Cadastro de pessoas: campos, classificações, busca e exclusão.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

await entrarComoAdmin()

const semente = (await chamar('GET', '/pessoas')).json
conferir('seed traz cliente e fornecedor classificados', semente.some((p) => p.cliente && !p.fornecedor) && semente.some((p) => p.fornecedor && !p.cliente))
conferir('sem classificação -> 400', (await chamar('POST', '/pessoas', { nome: 'Sem classe' })).status === 400)

const completo = {
  nome: 'Zeta Comércio Ltda', nomeFantasia: 'Zeta', documento: '12.345.678/0001-90', rgIe: '123.456.789.000',
  email: 'contato@zeta.example', telefone: '(11) 3333-4444', celular: '(11) 98888-7777', cep: '01000-000',
  logradouro: 'Rua A', numero: '10', complemento: 'Sala 2', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP',
  cliente: true, fornecedor: true, medico: true,
}
const criada = await chamar('POST', '/pessoas', completo)
// Documento, telefones e CEP ficam só com os dígitos; a tela formata ao mostrar.
const soDigitos = { documento: '12345678000190', telefone: '1133334444', celular: '11988887777', cep: '01000000' }
conferir('grava todos os campos', criada.status === 201 && Object.entries({ ...completo, ...soDigitos }).every(([k, v]) => criada.json[k] === v), JSON.stringify(criada.json?.erro ?? criada.json))
conferir('classificações não marcadas ficam falsas', criada.json.paciente === false && criada.json.vendedor === false && criada.json.prestador === false && criada.json.ativo === true)
const id = criada.json.id

const filtro = async (c) => (await chamar('GET', `/pessoas?classificacao=${c}`)).json
conferir('filtra por cada classificação', (await filtro('medico')).some((p) => p.id === id) && (await filtro('fornecedor')).some((p) => p.id === id) && !(await filtro('paciente')).some((p) => p.id === id))
conferir('classificação inválida -> 400', (await chamar('GET', '/pessoas?classificacao=chefe')).status === 400)
// No PostgreSQL a busca só ignora maiúsculas se a consulta pedir; no SQLite isso vinha de graça.
conferir('busca ignora maiúsculas e minúsculas', (await chamar('GET', `/pessoas?busca=${encodeURIComponent('zeta COMÉRCIO')}`)).json.some((p) => p.id === id))
conferir('busca por nome fantasia e celular',(await chamar('GET', '/pessoas?busca=Zeta')).json.some((p) => p.id === id) && (await chamar('GET', `/pessoas?busca=${encodeURIComponent('98888')}`)).json.some((p) => p.id === id))
conferir('busca pelo documento formatado acha o gravado só com dígitos', (await chamar('GET', `/pessoas?busca=${encodeURIComponent('345.678/0001')}`)).json.some((p) => p.id === id))
conferir('documento só com pontuação fica vazio', (await chamar('POST', '/pessoas', { nome: 'Sem documento', cliente: true, documento: '.-/' })).json.documento === null)

const editada = await chamar('PUT', `/pessoas/${id}`, { ...completo, complemento: '', medico: false, vendedor: true, ativo: false })
conferir('editar troca classificações e limpa campo', editada.json.medico === false && editada.json.vendedor === true && editada.json.complemento === null && editada.json.ativo === false)

// Exclusão
const livre = (await chamar('POST', '/pessoas', { nome: 'Para excluir', paciente: true })).json
conferir('exclui cadastro sem uso', (await chamar('DELETE', `/pessoas/${livre.id}`)).status === 204 && !(await chamar('GET', '/pessoas')).json.some((p) => p.id === livre.id))
conferir('excluir inexistente -> 404', (await chamar('DELETE', `/pessoas/${livre.id}`)).status === 404)
const prod = (await chamar('POST', '/produtos', { sku: 'PES-1', nome: 'Produto', precoCusto: 1, precoVenda: 100 })).json
const pedido = await chamar('POST', '/pedidos', { clienteId: id, itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 100 }] })
const bloqueio = await chamar('DELETE', `/pessoas/${id}`)
conferir('não exclui cadastro com pedido', pedido.status === 201 && bloqueio.status === 409 && bloqueio.json.erro.includes('desativ'), bloqueio.json?.erro)
conferir('cadastro continua lá', (await chamar('GET', '/pessoas?busca=Zeta')).json.length === 1)

// Entrega herda complemento e celular
await chamar('POST', `/pessoas/${id}`, {})
await chamar('PUT', `/pessoas/${id}`, { ...completo, ativo: true })
await chamar('POST', '/entradas', { data: '2026-10-07', itens: [{ produtoId: prod.id, quantidade: 5, custoUnitario: 1 }] })
await chamar('POST', `/pedidos/${pedido.json.id}/faturar`, { primeiroVencimento: '2026-11-07', formaPagamento: 'PIX' })
const disponivel = (await chamar('GET', '/entregas/pedidos-disponiveis')).json.find((p) => p.id === pedido.json.id)
conferir('pedido disponível traz complemento e celular do cliente', disponivel?.cliente.complemento === 'Sala 2' && disponivel.cliente.celular === '11988887777')
const entrega = await chamar('POST', '/entregas', { pedidoId: pedido.json.id, dataPrevista: '2026-10-08', destinatario: 'Zeta', logradouro: 'Rua A', complemento: 'Sala 2', cidade: 'São Paulo' })
conferir('entrega grava complemento', entrega.status === 201 && entrega.json.complemento === 'Sala 2')

encerrar()
