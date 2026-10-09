// Importação de extrato OFX e conciliação bancária: baixa de títulos, vínculo com movimento já lançado,
// lançamento avulso, depósito a maior, ignorar, e a conciliação automática.
import { SENHA_ADMIN, chamar, conferir, encerrar, sessao } from './apoio.mjs'

const hoje = new Date().toLocaleDateString('sv-SE')
const ofxDia = hoje.replaceAll('-', '')
const admin = (await chamar('POST', '/auth/login', { email: 'admin@prumo.local', senha: SENHA_ADMIN })).json.token
sessao.token = admin

// Cenário: um banco, três títulos em aberto e um recebimento já lançado à mão
const banco = (await chamar('POST', '/contas-financeiras', { nome: 'Banco Verde', tipo: 'CONTA_CORRENTE', numeroConta: '12345-6', documentoTitular: '11222333000181' })).json
const outroBanco = (await chamar('POST', '/contas-financeiras', { nome: 'Banco Roxo', tipo: 'CONTA_CORRENTE', numeroConta: '999-0', documentoTitular: '529.982.247-25' })).json
const pessoa = async (dados) => (await chamar('POST', '/pessoas', dados)).json
const maria = await pessoa({ cliente: true, nome: 'Maria Souza' })
const pedro = await pessoa({ cliente: true, nome: 'Pedro Lima' })
const energia = await pessoa({ fornecedor: true, nome: 'Energia SA' })
const receber = async (dados) => (await chamar('POST', '/contas-receber', { vencimento: hoje, ...dados })).json
const contaMaria = await receber({ pessoaId: maria.id, descricao: 'Venda Maria', valor: 10000 })
const contaPedro = await receber({ pessoaId: pedro.id, descricao: 'Venda Pedro', valor: 5000 })
const contaLuz = (await chamar('POST', '/contas-pagar', { pessoaId: energia.id, descricao: 'Conta de luz', valor: 8000, vencimento: hoje })).json
const jaRecebida = await receber({ descricao: 'Venda balcão', valor: 2000 })
await chamar('POST', `/contas-receber/${jaRecebida.id}/baixar`, { contaFinanceiraId: banco.id })

// Extrato no formato antigo do OFX (sem fechamento de marcações), em Windows-1252, com uma linha de valor zero
const linha = (fitId, valor, memo) => `<STMTTRN>\r\n<TRNTYPE>OTHER\r\n<DTPOSTED>${ofxDia}120000[-3:BRT]\r\n<TRNAMT>${valor}\r\n<FITID>${fitId}\r\n<MEMO>${memo}\r\n</STMTTRN>\r\n`
const texto =
  'OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nENCODING:USASCII\r\nCHARSET:1252\r\n\r\n<OFX>\r\n<BANKMSGSRSV1><STMTTRNRS><STMTRS>\r\n' +
  '<BANKACCTFROM>\r\n<BANKID>0341\r\n<BRANCHID>0001\r\n<ACCTID>0012345-6\r\n</BANKACCTFROM>\r\n<BANKTRANLIST>\r\n' +
  linha('f1', '100.00', 'PIX RECEBIDO MARIA SOUZA') +
  linha('f2', '20.00', 'DEPOSITO EM DINHEIRO') +
  linha('f3', '-80,00', 'PGTO ENERGIA SA') +
  linha('f4', '-12.50', 'TARIFA BANCÁRIA') +
  linha('f5', '70.00', 'TED PEDRO LIMA') +
  linha('f6', '30.00', 'TRANSF ENTRE CONTAS') +
  linha('f7', '0.00', 'LINHA SEM VALOR') +
  '</BANKTRANLIST>\r\n</STMTRS></STMTTRNRS></BANKMSGSRSV1>\r\n</OFX>\r\n'
const arquivo = { nome: 'extrato-outubro.ofx', conteudo: Buffer.from(texto, 'latin1').toString('base64') }

// Leitura do arquivo
const lido = await chamar('POST', '/ofx/ler', arquivo)
conferir('lê as transações e os dados da conta', lido.status === 200 && lido.json.transacoes.length === 6 && lido.json.banco === '0341' && lido.json.agencia === '0001' && lido.json.conta === '0012345-6', JSON.stringify(lido.json?.erro ?? lido.json?.transacoes?.length))
conferir('sugere a conta financeira pelo número', lido.json.contaFinanceiraSugeridaId === banco.id)
const t = (fitId) => lido.json.transacoes.find((x) => x.fitId === fitId)
conferir('valores em centavos, com o sentido certo', t('f1').valor === 10000 && t('f1').tipo === 'ENTRADA' && t('f3').valor === 8000 && t('f3').tipo === 'SAIDA' && t('f4').valor === 1250)
conferir('acentos do arquivo em Windows-1252', t('f4').descricao === 'TARIFA BANCÁRIA')
conferir('data da transação', t('f1').data.slice(0, 10) === hoje && t('f1').duplicada === false)
conferir('arquivo que não é OFX -> 400', (await chamar('POST', '/ofx/ler', { nome: 'x.ofx', conteudo: Buffer.from('nada aqui').toString('base64') })).status === 400)
conferir('OFX sem transações -> 400', (await chamar('POST', '/ofx/ler', { nome: 'x.ofx', conteudo: Buffer.from('<OFX></OFX>').toString('base64') })).status === 400)

// Importação
conferir('conta financeira de outro número -> 400', (await chamar('POST', '/ofx/importar', { ...arquivo, contaFinanceiraId: outroBanco.id })).status === 400)
const importado = await chamar('POST', '/ofx/importar', { ...arquivo, contaFinanceiraId: banco.id })
conferir('importa as linhas do extrato', importado.status === 200 && importado.json.importadas === 6 && importado.json.duplicadas === 0)
const repetido = await chamar('POST', '/ofx/importar', { ...arquivo, contaFinanceiraId: banco.id })
conferir('importar de novo não duplica', repetido.json.importadas === 0 && repetido.json.duplicadas === 6 && (await chamar('POST', '/ofx/ler', arquivo)).json.transacoes.every((x) => x.duplicada))
const saldoBanco = async () => (await chamar('GET', '/contas-financeiras')).json.find((c) => c.id === banco.id).saldo
conferir('importar não mexe no saldo da conta', (await saldoBanco()) === 2000)

// Pendentes e sugestões
const pendentes = async () => (await chamar('GET', '/conciliacao/pendentes')).json
let p = await pendentes()
const l = (fitId) => p.find((x) => x.fitId === fitId)
conferir('seis linhas pendentes', p.length === 6 && l('f1').contaFinanceira.nome === 'Banco Verde')
conferir('sugere o título de mesmo valor, data e nome', l('f1').sugestoes[0].acao === 'BAIXA' && l('f1').sugestoes[0].contaId === contaMaria.id && l('f1').sugestoes[0].pontuacao === 100 && l('f1').sugestoes[0].pessoa === 'Maria Souza')
conferir('sugere vincular o recebimento já lançado', l('f2').sugestoes[0].acao === 'VINCULO' && l('f2').sugestoes[0].pontuacao >= 90)
conferir('sugere a conta a pagar na saída', l('f3').sugestoes[0].tipo === 'CONTA_PAGAR' && l('f3').sugestoes[0].contaId === contaLuz.id)
conferir('tarifa não tem sugestão', l('f4').sugestoes.length === 0)
conferir('depósito maior que o título vira sugestão de crédito', l('f5').sugestoes[0].acao === 'CREDITO' && l('f5').sugestoes[0].contaId === contaPedro.id)

// Conciliação automática: só o que tem uma única sugestão forte
const automatica = await chamar('POST', '/conciliacao/automatica')
conferir('automática resolve as três linhas sem dúvida', automatica.json.analisadas === 6 && automatica.json.conciliadas === 3, JSON.stringify(automatica.json))
conferir('títulos conciliados ficam pagos', (await chamar('GET', '/contas-receber?status=PAGA')).json.some((c) => c.id === contaMaria.id) && (await chamar('GET', '/contas-pagar?status=PAGA')).json.some((c) => c.id === contaLuz.id))
conferir('saldo: entra a Maria, sai a luz, o vínculo não conta duas vezes', (await saldoBanco()) === 2000 + 10000 - 8000)
p = await pendentes()
conferir('restam três pendentes', p.map((x) => x.fitId).sort().join() === 'f4,f5,f6')

// Avulso, crédito, ignorar e reabrir
const resolver = (fitId, acao, corpo) => chamar('POST', `/conciliacao/${l(fitId).id}/${acao}`, corpo ?? {})
conferir('avulso sem descrição -> 400', (await resolver('f4', 'avulso', { historico: '' })).status === 400)
const tarifa = await resolver('f4', 'avulso', { historico: 'Tarifa bancária' })
conferir('lançamento avulso sai da conta', tarifa.json.status === 'CONCILIADA' && tarifa.json.resolucao === 'AVULSO' && tarifa.json.movimentos[0].origem === 'AVULSO' && (await saldoBanco()) === 4000 - 1250)
conferir('linha já resolvida -> 409', (await resolver('f4', 'ignorar')).status === 409)
conferir('saída não vira crédito -> 400 ou 409', [400, 409].includes((await resolver('f4', 'credito', { clienteId: pedro.id })).status))
conferir('depósito a maior exige conta do próprio cliente -> 400', (await resolver('f5', 'credito', { clienteId: maria.id, contaReceberId: contaPedro.id })).status === 400)
const deposito = await resolver('f5', 'credito', { clienteId: pedro.id, contaReceberId: contaPedro.id })
conferir('depósito a maior quita a conta e gera crédito', deposito.json.resolucao === 'CREDITO' && deposito.json.movimentos.length === 2 && (await chamar('GET', '/contas-receber?status=PAGA')).json.some((c) => c.id === contaPedro.id))
const creditos = (await chamar('GET', '/creditos')).json
conferir('crédito do excedente fica com o cliente', creditos.length === 1 && creditos[0].pessoa.id === pedro.id && creditos[0].saldo === 2000 && creditos[0].elegiveis.length === 1)
conferir('o depósito inteiro entra na conta', (await saldoBanco()) === 2750 + 7000)
const ignorada = await resolver('f6', 'ignorar', { observacao: 'Transferência entre contas próprias' })
conferir('ignorar não mexe no saldo', ignorada.json.status === 'IGNORADA' && (await saldoBanco()) === 9750)
conferir('reabrir a linha ignorada', (await resolver('f6', 'reabrir')).json.status === 'PENDENTE' && (await resolver('f4', 'reabrir')).status === 409)

// Baixa manual de um título escolhido
const contaNova = await receber({ descricao: 'Venda avulsa', valor: 3000 })
conferir('entrada não baixa conta a pagar -> 400', (await resolver('f6', 'baixar', { tipo: 'CONTA_PAGAR', contaId: contaLuz.id })).status === 400)
const menor = await receber({ descricao: 'Menor que o depósito', valor: 1000 })
conferir('linha maior que o saldo do título -> 400', (await resolver('f6', 'baixar', { tipo: 'CONTA_RECEBER', contaId: menor.id })).status === 400)
const manual = await resolver('f6', 'baixar', { tipo: 'CONTA_RECEBER', contaId: contaNova.id })
conferir('baixa manual pelo extrato', manual.json.resolucao === 'BAIXA' && manual.json.movimentos[0].origem === 'RECEBIMENTO' && (await saldoBanco()) === 12750)
const baixas = (await chamar('GET', `/contas-receber/${contaNova.id}/baixas`)).json
conferir('baixa leva a data e a descrição do extrato', baixas[0].data.slice(0, 10) === hoje && baixas[0].observacao.includes('TRANSF ENTRE CONTAS'))

// Concluídas
const concluidas = (await chamar('GET', '/conciliacao/concluidas')).json
conferir('todas as linhas resolvidas', (await pendentes()).length === 0 && concluidas.length === 6 && concluidas.map((c) => c.resolucao).sort().join() === 'AVULSO,BAIXA,BAIXA,BAIXA,CREDITO,VINCULO' && concluidas[0].usuario.nome === 'Administrador')

// Permissões
const perfil = (await chamar('POST', '/perfis', { nome: 'Consulta conciliação', permissoes: ['CONCILIACAO_VISUALIZAR'], dashboards: [] })).json
await chamar('POST', '/usuarios', { nome: 'Caio', email: 'caio@prumo.local', senha: 'senha-12345', perfilId: perfil.id })
sessao.token = (await chamar('POST', '/auth/login', { email: 'caio@prumo.local', senha: 'senha-12345' })).json.token
conferir('quem só visualiza não importa nem concilia -> 403', (await chamar('GET', '/conciliacao/pendentes')).status === 200 && (await chamar('POST', '/ofx/ler', arquivo)).status === 403 && (await chamar('POST', '/conciliacao/automatica')).status === 403)

encerrar()
