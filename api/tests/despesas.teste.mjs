// Despesas: lançamento à vista e a prazo, contas a pagar geradas, pagamento, correção, cancelamento e filtros.
import { SENHA_ADMIN, chamar, conferir, encerrar, sessao } from './apoio.mjs'

const dia = (deslocamento) => new Date(Date.now() + deslocamento * 864e5).toLocaleDateString('sv-SE')
const hoje = dia(0)
const admin = (await chamar('POST', '/auth/login', { email: 'admin@prumo.local', senha: SENHA_ADMIN })).json.token
sessao.token = admin
const pessoa = async (dados) => (await chamar('POST', '/pessoas', dados)).json
const imobiliaria = await pessoa({ fornecedor: true, nome: 'Imobiliária Centro' })
const eletricista = await pessoa({ prestador: true, nome: 'João Eletricista' })
const cliente = await pessoa({ cliente: true, nome: 'Só Cliente' })
const base = { fornecedorId: imobiliaria.id, elemento: 'Aluguel', descricao: 'Aluguel da loja', numeroDocumento: 'REC-10', dataEmissao: hoje, dataCompetencia: hoje, valor: 300000, formaPagamento: 'BOLETO' }
const lancar = (dados) => chamar('POST', '/despesas', { ...base, ...dados })

// À vista: uma conta a pagar, na data de emissão
const aVista = await lancar({})
conferir('lança despesa à vista', aVista.status === 201 && aVista.json.condicaoPagamento === 'A_VISTA' && aVista.json.valorPago === 0 && aVista.json.dataCaixa === null && aVista.json.usuario.nome === 'Administrador', JSON.stringify(aVista.json?.erro ?? ''))
conferir('gera uma conta a pagar pelo total', aVista.json.contasPagar.length === 1 && aVista.json.contasPagar[0].valor === 300000 && aVista.json.contasPagar[0].vencimento.slice(0, 10) === hoje)
const contas = async () => (await chamar('GET', '/contas-pagar')).json
const contaAluguel = (await contas()).find((c) => c.id === aVista.json.contasPagar[0].id)
conferir('conta a pagar leva o fornecedor e descreve a despesa', contaAluguel.pessoa.id === imobiliaria.id && contaAluguel.descricao.includes('Aluguel: Aluguel da loja') && contaAluguel.descricao.includes(`Despesa nº ${aVista.json.id}`))

// Validações
conferir('sem fornecedor -> 400', (await lancar({ fornecedorId: undefined })).status === 400)
conferir('pessoa que não é fornecedor nem prestador -> 400', (await lancar({ fornecedorId: cliente.id })).status === 400)
conferir('sem elemento -> 400', (await lancar({ elemento: '' })).status === 400)
conferir('valor zero -> 400', (await lancar({ valor: 0 })).status === 400)
conferir('forma de pagamento inválida -> 400', (await lancar({ formaPagamento: 'CHEQUE' })).status === 400)
conferir('a prazo sem parcelas -> 400', (await lancar({ condicaoPagamento: 'A_PRAZO' })).status === 400)
conferir('parcelas que não fecham com o total -> 400', (await lancar({ condicaoPagamento: 'A_PRAZO', parcelas: [{ vencimento: dia(30), valor: 100000 }, { vencimento: dia(60), valor: 100000 }] })).status === 400)

// A prazo: uma conta por parcela; prestador de serviço também vale
const aPrazo = await lancar({
  fornecedorId: eletricista.id,
  elemento: 'Manutenção',
  descricao: 'Troca do quadro elétrico',
  valor: 90000,
  formaPagamento: 'PIX',
  condicaoPagamento: 'A_PRAZO',
  dataCompetencia: dia(-40),
  parcelas: [{ vencimento: dia(30), valor: 30000 }, { vencimento: dia(60), valor: 60000 }],
})
conferir('lança despesa a prazo com as parcelas informadas', aPrazo.status === 201 && aPrazo.json.contasPagar.length === 2 && aPrazo.json.contasPagar.map((c) => c.valor).join() === '30000,60000' && aPrazo.json.contasPagar[1].vencimento.slice(0, 10) === dia(60))
conferir('parcelas são numeradas na descrição', (await contas()).some((c) => c.descricao.endsWith('parcela 2/2')))

// Pagamento pelas contas a pagar reflete na despesa
const lista = async (qs = '') => (await chamar('GET', `/despesas${qs}`)).json
await chamar('POST', `/contas-pagar/${aPrazo.json.contasPagar[0].id}/baixar`, {})
let d = (await lista()).linhas.find((x) => x.id === aPrazo.json.id)
conferir('pagamento de uma parcela aparece na despesa, sem data de caixa', d.valorPago === 30000 && d.dataCaixa === null)
await chamar('POST', `/contas-pagar/${aPrazo.json.contasPagar[1].id}/baixar`, {})
d = (await lista()).linhas.find((x) => x.id === aPrazo.json.id)
conferir('quitada, a despesa ganha a data de caixa', d.valorPago === 90000 && d.dataCaixa !== null)
conferir('pagamento sai do caixa', (await chamar('GET', '/contas-financeiras')).json[0].saldo === -90000)

// Lista, resumo e filtros
const tudo = await lista()
conferir('lista e resumo', tudo.linhas.length === 2 && tudo.resumo.quantidade === 2 && tudo.resumo.total === 390000 && tudo.resumo.pago === 90000)
conferir('filtro por competência', (await lista(`?inicio=${dia(-1)}`)).linhas.length === 1 && (await lista(`?fim=${dia(-30)}`)).linhas[0].id === aPrazo.json.id)
conferir('filtro por fornecedor e por elemento', (await lista(`?fornecedorId=${eletricista.id}`)).linhas.length === 1 && (await lista('?elemento=aluguel')).linhas[0].id === aVista.json.id)
conferir('elementos já usados', (await chamar('GET', '/despesas/elementos')).json.join() === 'Aluguel,Manutenção')

// Correção: muda o cadastro, não o valor nem as parcelas
const corrigida = await chamar('PUT', `/despesas/${aVista.json.id}`, { ...base, fornecedorId: eletricista.id, elemento: 'Aluguel', descricao: 'Aluguel de outubro', valor: 1, condicaoPagamento: 'A_PRAZO' })
conferir('corrige descrição e fornecedor, mantém o valor', corrigida.status === 200 && corrigida.json.descricao === 'Aluguel de outubro' && corrigida.json.fornecedor.id === eletricista.id && corrigida.json.valor === 300000 && corrigida.json.condicaoPagamento === 'A_VISTA')
conferir('conta a pagar acompanha o fornecedor', (await contas()).find((c) => c.id === contaAluguel.id).pessoa.id === eletricista.id)

// Cancelamento
conferir('despesa com pagamento não cancela -> 409', (await chamar('POST', `/despesas/${aPrazo.json.id}/cancelar`)).status === 409)
const cancelada = await chamar('POST', `/despesas/${aVista.json.id}/cancelar`)
conferir('cancelar a despesa cancela a conta a pagar', cancelada.json.status === 'CANCELADA' && cancelada.json.contasPagar[0].status === 'CANCELADA')
conferir('despesa cancelada sai da lista e não é alterada', (await lista()).linhas.length === 1 && (await lista('?status=CANCELADA')).linhas.length === 1 && (await chamar('PUT', `/despesas/${aVista.json.id}`, base)).status === 409 && (await chamar('POST', `/despesas/${aVista.json.id}/cancelar`)).status === 409)

// Anexos e permissões
const anexo = await chamar('POST', `/documentos/DESPESA/${aPrazo.json.id}`, { nome: 'recibo.txt', conteudo: Buffer.from('pago').toString('base64') })
conferir('despesa aceita anexo', anexo.status === 201 && (await chamar('GET', `/documentos/DESPESA/${aPrazo.json.id}`)).json.length === 1, JSON.stringify(anexo.json?.erro ?? ''))
const perfil = (await chamar('POST', '/perfis', { nome: 'Consulta despesas', permissoes: ['DESPESAS_VISUALIZAR'], dashboards: [] })).json
await chamar('POST', '/usuarios', { nome: 'Dani', email: 'dani@prumo.local', senha: 'senha-12345', perfilId: perfil.id })
sessao.token = (await chamar('POST', '/auth/login', { email: 'dani@prumo.local', senha: 'senha-12345' })).json.token
conferir('quem só visualiza vê mas não lança nem cancela -> 403', (await chamar('GET', '/despesas')).status === 200 && (await lancar({})).status === 403 && (await chamar('POST', `/despesas/${aPrazo.json.id}/cancelar`)).status === 403)

encerrar()
