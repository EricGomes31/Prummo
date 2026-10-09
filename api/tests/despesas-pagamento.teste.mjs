// Despesa paga no lançamento, despesas no dashboard financeiro e no relatório por elemento e competência.
import { chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

const agora = new Date()
const hoje = agora.toLocaleDateString('sv-SE')
const mes = hoje.slice(0, 7)
const mesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, 15).toLocaleDateString('sv-SE')

await entrarComoAdmin()
const admin = sessao.token
const fornecedor = (await chamar('POST', '/pessoas', { fornecedor: true, nome: 'Papelaria Central' })).json
const banco = (await chamar('POST', '/contas-financeiras', { nome: 'Banco Azul', tipo: 'CONTA_CORRENTE', documentoTitular: '11222333000181' })).json
const inativa = (await chamar('POST', '/contas-financeiras', { nome: 'Conta Antiga', tipo: 'CONTA_CORRENTE', documentoTitular: '11222333000181', ativa: false })).json
const base = { fornecedorId: fornecedor.id, elemento: 'Material de escritório', descricao: 'Papel e toner', dataEmissao: hoje, dataCompetencia: hoje, valor: 25000, formaPagamento: 'PIX' }
const lancar = (dados) => chamar('POST', '/despesas', { ...base, ...dados })
const saldoBanco = async () => (await chamar('GET', '/contas-financeiras')).json.find((c) => c.id === banco.id).saldo

// Pagar no lançamento
const paga = await lancar({ pagamento: { contaFinanceiraId: banco.id } })
conferir('despesa à vista paga no lançamento', paga.status === 201 && paga.json.valorPago === 25000 && paga.json.dataCaixa !== null && paga.json.contasPagar[0].status === 'PAGA', JSON.stringify(paga.json?.erro ?? ''))
conferir('a saída cai na conta escolhida', (await saldoBanco()) === -25000)
const baixas = (await chamar('GET', `/contas-pagar/${paga.json.contasPagar[0].id}/baixas`)).json
conferir('o pagamento fica no histórico da conta a pagar', baixas.length === 1 && baixas[0].contaFinanceira.id === banco.id && baixas[0].origem === 'PAGAMENTO')
conferir('a prazo não é paga no lançamento -> 400', (await lancar({ condicaoPagamento: 'A_PRAZO', parcelas: [{ vencimento: hoje, valor: 25000 }], pagamento: { contaFinanceiraId: banco.id } })).status === 400)
const recusada = await lancar({ descricao: 'Não deve ficar', pagamento: { contaFinanceiraId: inativa.id } })
conferir('conta financeira inativa -> 400 e nada é gravado', recusada.status === 400 && !(await chamar('GET', '/despesas')).json.linhas.some((d) => d.descricao === 'Não deve ficar'))
conferir('estornar o pagamento reabre a despesa', (await chamar('POST', `/contas-pagar/${paga.json.contasPagar[0].id}/estornar`)).status === 200 && (await saldoBanco()) === 0)

// Mais despesas para os totais: duas no mês (uma com o elemento em minúsculas) e uma no mês passado
await lancar({ elemento: 'material de escritório', valor: 5000 })
await lancar({ elemento: 'Aluguel', valor: 200000, dataCompetencia: mesPassado })
await lancar({ elemento: 'Energia', valor: 30000 })
const cancelar = (await lancar({ elemento: 'Energia', valor: 99999 })).json
await chamar('POST', `/despesas/${cancelar.id}/cancelar`)

// Dashboard financeiro
const f = (await chamar('GET', `/dashboards/financeiro?mes=${mes}`)).json
conferir('despesas do mês pela competência', f.kpis.despesas === 25000 + 5000 + 30000, JSON.stringify(f.kpis))
conferir('despesas por mês no histórico', f.historico[5].despesas === 60000 && f.historico[4].despesas === 200000)
conferir('despesas por elemento, juntando maiúsculas', f.despesasPorElemento.length === 2 && f.despesasPorElemento[0].nome === 'Material de escritório' && f.despesasPorElemento[0].total === 30000 && f.despesasPorElemento[1].total === 30000, JSON.stringify(f.despesasPorElemento))

// Relatório de despesas
const rel = async (qs = '') => (await chamar('GET', `/relatorios/despesas${qs}`)).json
const tudo = await rel()
conferir('relatório traz as despesas ativas', tudo.linhas.length === 4 && tudo.resumo.total === 260000 && tudo.resumo.pago === 0 && tudo.resumo.aPagar === 260000)
conferir('agrupa por elemento', tudo.porElemento.length === 3 && tudo.porElemento[0].nome === 'Aluguel' && tudo.porElemento.find((g) => g.nome === 'Material de escritório').quantidade === 2)
conferir('agrupa por competência', tudo.porCompetencia.length === 2 && tudo.porCompetencia[1].nome === mes && tudo.porCompetencia[1].total === 60000 && tudo.porCompetencia[0].total === 200000)
conferir('filtro pela competência', (await rel(`?inicio=${hoje}`)).linhas.length === 3)
conferir('filtro por elemento e busca', (await rel('?elemento=energia')).linhas.length === 1 && (await rel('?busca=papelaria')).linhas.length === 4)

// Permissões: quem lança despesa sem poder pagar contas não paga no lançamento
const perfil = (await chamar('POST', '/perfis', { nome: 'Lança despesas', permissoes: ['DESPESAS_LANCAR'], dashboards: [] })).json
await chamar('POST', '/usuarios', { nome: 'Lia', email: 'lia@prumo.local', senha: 'senha-12345', perfilId: perfil.id })
sessao.token = (await chamar('POST', '/auth/login', { email: 'lia@prumo.local', senha: 'senha-12345' })).json.token
conferir('sem permissão de pagar, não paga no lançamento -> 403', (await lancar({ pagamento: { contaFinanceiraId: banco.id } })).status === 403)
conferir('mas lança sem pagar e vê as contas financeiras', (await lancar({})).status === 201 && (await chamar('GET', '/contas-financeiras')).status === 200)
conferir('relatório exige permissão -> 403', (await chamar('GET', '/relatorios/despesas')).status === 403)
sessao.token = admin

encerrar()
