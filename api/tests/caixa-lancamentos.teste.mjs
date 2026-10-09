// Caixa e bancos: titular obrigatório, saldo inicial negativo, baixa com hora, lançamento avulso e
// transferência. Conciliação: vários títulos numa linha, transferência entre contas e desfazer.
import { chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

const hoje = new Date().toLocaleDateString('sv-SE')
const ofxDia = hoje.replaceAll('-', '')
await entrarComoAdmin()
const admin = sessao.token
const contas = async () => (await chamar('GET', '/contas-financeiras')).json
const saldo = async (id) => (await contas()).find((c) => c.id === id).saldo
const novaConta = (dados) => chamar('POST', '/contas-financeiras', { tipo: 'CONTA_CORRENTE', ...dados })

// Titular e saldo inicial
conferir('conta em banco sem titular -> 400', (await novaConta({ nome: 'Sem titular' })).status === 400)
conferir('CPF ou CNPJ inválido -> 400', (await novaConta({ nome: 'Titular errado', documentoTitular: '111.111.111-11' })).status === 400 && (await novaConta({ nome: 'Titular errado', documentoTitular: '11.222.333/0001-82' })).status === 400)
const banco = await novaConta({ nome: 'Banco Sol', instituicao: 'Banco do Brasil', codigoBanco: '001', numeroConta: '777-1', documentoTitular: '11.222.333/0001-81', saldoInicial: -15000 })
conferir('conta no cheque especial começa negativa', banco.status === 201 && banco.json.saldo === -15000, JSON.stringify(banco.json?.erro ?? ''))
const poupanca = (await novaConta({ nome: 'Poupança', tipo: 'CONTA_POUPANCA', numeroConta: '888-2', documentoTitular: '529.982.247-25' })).json
const [caixa] = (await contas()).filter((c) => c.tipo === 'CAIXA')
conferir('o caixa não pede titular', caixa && (await chamar('PUT', `/contas-financeiras/${caixa.id}`, { nome: 'Caixa', tipo: 'CAIXA' })).status === 200)

// Baixa com hora
const conta = (await chamar('POST', '/contas-receber', { descricao: 'Venda com hora', valor: 5000, vencimento: hoje })).json
const instante = new Date()
instante.setSeconds(0, 0)
await chamar('POST', `/contas-receber/${conta.id}/baixar`, { contaFinanceiraId: banco.json.id, data: instante.toISOString() })
let historico = (await chamar('GET', `/contas-receber/${conta.id}/baixas`)).json
conferir('baixa guarda a hora informada', historico[0].comHora === true && new Date(historico[0].data).getTime() === instante.getTime(), JSON.stringify(historico[0]))
conferir('data sem hora continua aceita', (await chamar('POST', '/contas-receber', { descricao: 'Outra', valor: 100, vencimento: hoje })).status === 201)
conferir('data com formato errado -> 400', (await chamar('POST', `/contas-receber/${conta.id}/baixar`, { data: '08/10/2026' })).status === 400)

// Lançamento avulso direto no extrato
const avulso = await chamar('POST', '/movimentos-financeiros', { contaFinanceiraId: banco.json.id, tipo: 'SAIDA', valor: 1990, data: hoje, historico: 'Tarifa do pacote de serviços' })
conferir('lançamento avulso sai da conta', avulso.status === 201 && avulso.json.origem === 'AVULSO' && (await saldo(banco.json.id)) === -15000 + 5000 - 1990, JSON.stringify(avulso.json?.erro ?? ''))
conferir('avulso sem histórico -> 400', (await chamar('POST', '/movimentos-financeiros', { contaFinanceiraId: banco.json.id, tipo: 'ENTRADA', valor: 100, data: hoje, historico: '' })).status === 400)
const estornoAvulso = await chamar('POST', `/movimentos-financeiros/${avulso.json.id}/estornar`)
conferir('estornar o avulso devolve o valor', estornoAvulso.status === 200 && (await saldo(banco.json.id)) === -10000)
conferir('não estorna duas vezes -> 409', (await chamar('POST', `/movimentos-financeiros/${avulso.json.id}/estornar`)).status === 409)
const recebimento = historico[0]
conferir('recebimento não se estorna por aqui -> 409', (await chamar('POST', `/movimentos-financeiros/${recebimento.id}/estornar`)).status === 409)

// Transferência entre contas
const transf = await chamar('POST', '/transferencias', { origemId: banco.json.id, destinoId: poupanca.id, valor: 3000, data: hoje, historico: 'Reserva' })
conferir('transferência tira de uma e põe na outra', transf.status === 201 && (await saldo(banco.json.id)) === -13000 && (await saldo(poupanca.id)) === 3000, JSON.stringify(transf.json?.erro ?? ''))
conferir('transferência para a mesma conta -> 400', (await chamar('POST', '/transferencias', { origemId: banco.json.id, destinoId: banco.json.id, valor: 100, data: hoje })).status === 400)
conferir('estornar uma ponta estorna as duas', (await chamar('POST', `/movimentos-financeiros/${transf.json.entrada.id}/estornar`)).json.estornados === 2 && (await saldo(banco.json.id)) === -10000 && (await saldo(poupanca.id)) === 0)

// Conciliação: extrato do Banco Sol
const linha = (fitId, valor, memo) => `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${ofxDia}120000<TRNAMT>${valor}<FITID>${fitId}<MEMO>${memo}</STMTTRN>`
const ofx = (conta, linhas) => ({
  nome: 'extrato.ofx',
  conteudo: Buffer.from(`<OFX><BANKACCTFROM><ACCTID>${conta}</BANKACCTFROM><BANKTRANLIST>${linhas.join('')}</BANKTRANLIST></OFX>`).toString('base64'),
})
const pessoa = async (nome) => (await chamar('POST', '/pessoas', { cliente: true, nome })).json
const ana = await pessoa('Ana Costa')
const bia = await pessoa('Bia Reis')
const receber = async (pessoaId, descricao, valor) => (await chamar('POST', '/contas-receber', { pessoaId, descricao, valor, vencimento: hoje })).json
const vendaAna = await receber(ana.id, 'Venda Ana', 7000)
const vendaBia = await receber(bia.id, 'Venda Bia', 3000)
const importado = await chamar('POST', '/ofx/importar', {
  ...ofx('777-1', [linha('s1', '100.00', 'DEPOSITO DUAS VENDAS'), linha('s2', '-50.00', 'TRANSF PARA POUPANCA'), linha('s3', '-9.90', 'TARIFA'), linha('s4', '40.00', 'PIX BIA REIS'), linha('s5', '15.00', 'PIX SEM DONO')]),
  contaFinanceiraId: banco.json.id,
})
conferir('extrato importado', importado.json.importadas === 5, JSON.stringify(importado.json))
// As linhas resolvidas saem da lista de pendentes; o id delas fica guardado para desfazer depois.
const ids = new Map()
const pendentes = async () => {
  const lista = (await chamar('GET', '/conciliacao/pendentes')).json
  for (const x of lista) ids.set(x.fitId, x.id)
  return lista
}
let p = await pendentes()
const l = (fitId) => p.find((x) => x.fitId === fitId)
const resolver = (fitId, acao, corpo) => chamar('POST', `/conciliacao/${ids.get(fitId)}/${acao}`, corpo ?? {})

// Vários títulos numa linha
const titulos = [{ tipo: 'CONTA_RECEBER', contaId: vendaAna.id, valor: 7000 }, { tipo: 'CONTA_RECEBER', contaId: vendaBia.id, valor: 2000 }]
conferir('títulos que não somam a linha -> 400', (await resolver('s1', 'baixar', { titulos })).status === 400)
conferir('título repetido -> 400', (await resolver('s1', 'baixar', { titulos: [{ ...titulos[0], valor: 5000 }, { ...titulos[0], valor: 5000 }] })).status === 400)
const duas = await resolver('s1', 'baixar', { titulos: [titulos[0], { ...titulos[1], valor: 3000 }] })
conferir('uma linha baixa dois títulos', duas.status === 200 && duas.json.resolucao === 'BAIXA' && duas.json.movimentos.length === 2, JSON.stringify(duas.json?.erro ?? ''))
const pagas = (await chamar('GET', '/contas-receber?status=PAGA')).json.map((c) => c.id)
conferir('os dois títulos ficam pagos', pagas.includes(vendaAna.id) && pagas.includes(vendaBia.id))
conferir('baixa conciliada não se estorna pela conta -> 409', (await chamar('POST', `/contas-receber/${vendaAna.id}/estornar`)).status === 409)

// Desfazer a baixa de vários títulos
const saldoAntes = await saldo(banco.json.id)
const desfeita = await resolver('s1', 'desfazer')
conferir('desfazer deixa a linha pendente', desfeita.status === 200 && desfeita.json.status === 'PENDENTE' && desfeita.json.movimentos.length === 0, JSON.stringify(desfeita.json?.erro ?? ''))
const abertas = (await chamar('GET', '/contas-receber?status=ABERTA')).json
conferir('os títulos voltam a ficar em aberto', abertas.find((c) => c.id === vendaAna.id)?.valorPago === 0 && abertas.find((c) => c.id === vendaBia.id)?.valorPago === 0)
conferir('o saldo da conta volta', (await saldo(banco.json.id)) === saldoAntes - 10000)
conferir('linha pendente não se desfaz -> 409', (await resolver('s1', 'desfazer')).status === 409)

// Transferência pela conciliação, depois vínculo da outra ponta no extrato da poupança
const transfConc = await resolver('s2', 'transferencia', { contaFinanceiraId: poupanca.id })
conferir('saída do extrato vira transferência para a poupança', transfConc.json.resolucao === 'TRANSFERENCIA' && (await saldo(poupanca.id)) === 5000, JSON.stringify(transfConc.json?.erro ?? ''))
await chamar('POST', '/ofx/importar', { ...ofx('888-2', [linha('p1', '50.00', 'TRANSF RECEBIDA')]), contaFinanceiraId: poupanca.id })
p = await pendentes()
conferir('a entrada na poupança sugere vínculo com a outra ponta', l('p1').sugestoes[0]?.acao === 'VINCULO')
await resolver('p1', 'vincular', { movimentoId: l('p1').sugestoes[0].movimentoId })
conferir('com a outra ponta conciliada, desfazer a transferência -> 409', (await resolver('s2', 'desfazer')).status === 409)
conferir('desfazer o vínculo só desliga', (await resolver('p1', 'desfazer')).json.status === 'PENDENTE' && (await saldo(poupanca.id)) === 5000)
conferir('agora a transferência se desfaz nas duas contas', (await resolver('s2', 'desfazer')).status === 200 && (await saldo(poupanca.id)) === 0)

// Avulso e crédito desfeitos
await resolver('s3', 'avulso', { historico: 'Tarifa' })
const comTarifa = await saldo(banco.json.id)
conferir('desfazer o avulso estorna o lançamento', (await resolver('s3', 'desfazer')).status === 200 && (await saldo(banco.json.id)) === comTarifa + 990)
const vendaBia2 = await receber(bia.id, 'Segunda venda Bia', 1000)
await resolver('s4', 'credito', { clienteId: bia.id, contaReceberId: vendaBia2.id })
const credito = (await chamar('GET', '/creditos')).json.find((c) => c.pessoa.id === bia.id)
conferir('depósito a maior gera crédito de origem DEPOSITO', credito?.origem === 'DEPOSITO' && credito.saldo === 3000)
await chamar('POST', `/creditos/${credito.id}/utilizar`, { contaReceberId: vendaBia.id, pessoaId: bia.id, valor: 500 })
conferir('crédito já usado impede desfazer -> 409', (await resolver('s4', 'desfazer')).status === 409)
const uso = (await chamar('GET', '/creditos')).json.find((c) => c.id === credito.id).usos[0]
await chamar('POST', `/creditos/usos/${uso.id}/estornar`)
const antesCredito = await saldo(banco.json.id)
const semCredito = await resolver('s4', 'desfazer')
conferir('com o uso estornado, desfaz e cancela o crédito', semCredito.status === 200 && (await chamar('GET', '/creditos')).json.find((c) => c.id === credito.id).status === 'CANCELADO' && (await saldo(banco.json.id)) === antesCredito - 4000, JSON.stringify(semCredito.json?.erro ?? ''))
conferir('a conta quitada pelo depósito volta a ficar em aberto', (await chamar('GET', '/contas-receber?status=ABERTA')).json.some((c) => c.id === vendaBia2.id))

// Permissões
const perfil = (await chamar('POST', '/perfis', { nome: 'Só vê o caixa', permissoes: ['CAIXA_VISUALIZAR'], dashboards: [] })).json
await chamar('POST', '/usuarios', { nome: 'Vera', email: 'vera@prumo.local', senha: 'senha-12345', perfilId: perfil.id })
sessao.token = (await chamar('POST', '/auth/login', { email: 'vera@prumo.local', senha: 'senha-12345' })).json.token
conferir('quem só vê o caixa não lança nem transfere -> 403', (await chamar('POST', '/movimentos-financeiros', { contaFinanceiraId: banco.json.id, tipo: 'SAIDA', valor: 100, data: hoje, historico: 'x' })).status === 403 && (await chamar('POST', '/transferencias', { origemId: banco.json.id, destinoId: poupanca.id, valor: 100, data: hoje })).status === 403)
sessao.token = admin

encerrar()
