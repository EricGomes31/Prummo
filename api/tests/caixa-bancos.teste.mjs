// Baixas parciais de contas a receber e a pagar, estorno, contas financeiras e extrato.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

const dia = (deslocamento) => new Date(Date.now() + deslocamento * 864e5).toLocaleDateString('sv-SE')
const hoje = dia(0)
const mes = hoje.slice(0, 7)

await entrarComoAdmin()
const contasFinanceiras = async () => (await chamar('GET', '/contas-financeiras')).json
const saldoDe = async (id) => (await contasFinanceiras()).find((c) => c.id === id).saldo
const [caixa] = await contasFinanceiras()
conferir('o caixa já vem criado, com saldo zero', caixa?.nome === 'Caixa' && caixa.tipo === 'CAIXA' && caixa.saldo === 0)

// Recebimento parcial: 100,00 em duas baixas de 40,00 e 60,00
const receber = (await chamar('POST', '/contas-receber', { descricao: 'Mensalidade', valor: 10000, vencimento: hoje })).json
conferir('conta nasce sem baixas', receber.valorPago === 0 && receber.status === 'ABERTA')
const baixar = (id, corpo, caminho = 'contas-receber') => chamar('POST', `/${caminho}/${id}/baixar`, corpo ?? {})
const parcial = await baixar(receber.id, { valor: 4000, observacao: 'primeira parte' })
conferir('baixa parcial mantém a conta aberta', parcial.status === 200 && parcial.json.status === 'ABERTA' && parcial.json.valorPago === 4000 && parcial.json.pagoEm === null, JSON.stringify(parcial.json?.erro ?? ''))
conferir('com uma só conta financeira ela é usada', (await saldoDe(caixa.id)) === 4000)
conferir('baixa maior que o saldo -> 400', (await baixar(receber.id, { valor: 6001 })).status === 400)
conferir('valor zero -> 400', (await baixar(receber.id, { valor: 0 })).status === 400)
conferir('conta com baixa parcial não cancela -> 409', (await chamar('POST', `/contas-receber/${receber.id}/cancelar`)).status === 409)
const quitada = await baixar(receber.id)
conferir('baixa sem valor quita o saldo', quitada.json.status === 'PAGA' && quitada.json.valorPago === 10000 && quitada.json.pagoEm !== null)
conferir('conta quitada não aceita outra baixa -> 409', (await baixar(receber.id, { valor: 100 })).status === 409)
conferir('caixa soma as duas baixas', (await saldoDe(caixa.id)) === 10000)
let historico = (await chamar('GET', `/contas-receber/${receber.id}/baixas`)).json
conferir('histórico traz as baixas com usuário e conta', historico.length === 2 && historico[0].valor === 6000 && historico[1].observacao === 'primeira parte' && historico[0].usuario.nome === 'Administrador' && historico[0].contaFinanceira.nome === 'Caixa')

// Estorno: desfaz a baixa mais recente e lança o movimento contrário
const estornada = await chamar('POST', `/contas-receber/${receber.id}/estornar`)
conferir('estorno reabre com o saldo da última baixa', estornada.json.status === 'ABERTA' && estornada.json.valorPago === 4000 && estornada.json.pagoEm === null)
conferir('estorno sai do caixa', (await saldoDe(caixa.id)) === 4000)
historico = (await chamar('GET', `/contas-receber/${receber.id}/baixas`)).json
conferir('estorno fica no histórico', historico.length === 3 && historico[0].origem === 'ESTORNO' && historico[0].tipo === 'SAIDA' && historico.filter((m) => m.estornado).length === 1)
await chamar('POST', `/contas-receber/${receber.id}/estornar`)
conferir('segundo estorno zera as baixas', (await chamar('GET', '/contas-receber?status=ABERTA')).json.find((c) => c.id === receber.id).valorPago === 0 && (await saldoDe(caixa.id)) === 0)
conferir('sem baixa para estornar -> 409', (await chamar('POST', `/contas-receber/${receber.id}/estornar`)).status === 409)
conferir('sem baixas a conta pode ser cancelada', (await chamar('POST', `/contas-receber/${receber.id}/cancelar`)).json.status === 'CANCELADA')

// Contas financeiras
const banco = await chamar('POST', '/contas-financeiras', { nome: 'Banco Azul', tipo: 'CONTA_CORRENTE', instituicao: 'Azul S.A.', agencia: '0001', numeroConta: '12345-6', saldoInicial: 50000 })
conferir('conta financeira nasce com o saldo inicial', banco.status === 201 && banco.json.saldo === 50000)
conferir('nome repetido -> 409', (await chamar('POST', '/contas-financeiras', { nome: 'Banco Azul' })).status === 409)
conferir('tipo inválido -> 400', (await chamar('POST', '/contas-financeiras', { nome: 'Outra', tipo: 'COFRE' })).status === 400)
const outra = (await chamar('POST', '/contas-receber', { descricao: 'Serviço', valor: 8000, vencimento: hoje })).json
conferir('com duas contas financeiras é preciso escolher -> 400', (await baixar(outra.id, { valor: 1000 })).status === 400)
conferir('recebe na conta escolhida', (await baixar(outra.id, { valor: 3000, contaFinanceiraId: banco.json.id })).json.valorPago === 3000 && (await saldoDe(banco.json.id)) === 53000)
const inativa = (await chamar('POST', '/contas-financeiras', { nome: 'Antiga', ativa: false })).json
conferir('conta financeira inativa não recebe -> 400', (await baixar(outra.id, { valor: 1000, contaFinanceiraId: inativa.id })).status === 400)

// Contas a pagar seguem o mesmo ciclo, no sentido contrário
const pagar = (await chamar('POST', '/contas-pagar', { descricao: 'Aluguel', valor: 20000, vencimento: hoje })).json
const paga = await baixar(pagar.id, { valor: 5000, contaFinanceiraId: banco.json.id }, 'contas-pagar')
conferir('pagamento parcial', paga.json.status === 'ABERTA' && paga.json.valorPago === 5000)
conferir('pagamento sai do banco', (await saldoDe(banco.json.id)) === 48000)
await chamar('POST', `/contas-pagar/${pagar.id}/estornar`)
conferir('estorno de pagamento devolve ao banco', (await saldoDe(banco.json.id)) === 53000)

// Extrato
const extrato = async (qs) => (await chamar('GET', `/movimentos-financeiros${qs}`)).json
const doBanco = await extrato(`?contaFinanceiraId=${banco.json.id}`)
conferir('extrato do banco', doBanco.linhas.length === 3 && doBanco.resumo.saldoInicial === 50000 && doBanco.resumo.entradas === 8000 && doBanco.resumo.saidas === 5000 && doBanco.resumo.saldoFinal === 53000, JSON.stringify(doBanco.resumo))
const geral = await extrato('')
conferir('extrato geral soma as contas', geral.resumo.saldoInicial === 50000 && geral.resumo.saldoFinal === 53000 && geral.linhas.length === 7)
conferir('filtro por tipo', (await extrato('?tipo=SAIDA')).linhas.every((l) => l.tipo === 'SAIDA'))
const futuro = await extrato(`?inicio=${dia(1)}`)
conferir('período futuro: saldo inicial já inclui o que veio antes', futuro.linhas.length === 0 && futuro.resumo.saldoInicial === 53000 && futuro.resumo.saldoFinal === 53000)
conferir('data inválida -> 400', (await chamar('GET', '/movimentos-financeiros?inicio=ontem')).status === 400)

// Totais: valem as baixas não estornadas e o saldo das contas abertas
const painel = (await chamar('GET', `/dashboards/financeiro?mes=${mes}`)).json.kpis
conferir('dashboard: recebido e pago sem os estornos', painel.recebido === 3000 && painel.pago === 0, JSON.stringify(painel))
conferir('dashboard: a receber e a pagar pelo saldo', painel.aReceber === 5000 && painel.aPagar === 20000)
const resumo = (await chamar('GET', '/relatorios/financeiro')).json.resumo
conferir('relatório: baixado e saldo', resumo.recebido === 3000 && resumo.aReceber === 5000 && resumo.pago === 0 && resumo.aPagar === 20000, JSON.stringify(resumo))
conferir('início: a receber pelo saldo', (await chamar('GET', '/dashboard/resumo')).json.receber.total === 5000)

// Pedido com parcela recebida em parte não pode ser cancelado
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente Caixa' })).json
const prod = (await chamar('POST', '/produtos', { sku: 'CB1', nome: 'Produto caixa', precoCusto: 100, precoVenda: 5000 })).json
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: prod.id, quantidade: 5, custoUnitario: 100 }] })
const pedido = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 5000 }] })).json
await chamar('POST', `/pedidos/${pedido.id}/faturar`, { primeiroVencimento: hoje, formaPagamento: 'PIX' })
const parcela = (await chamar('GET', `/pedidos/${pedido.id}`)).json.contasReceber[0]
await baixar(parcela.id, { valor: 1000, contaFinanceiraId: caixa.id })
conferir('pedido com recebimento parcial não cancela -> 409', (await chamar('POST', `/pedidos/${pedido.id}/cancelar`)).status === 409)
await chamar('POST', `/contas-receber/${parcela.id}/estornar`)
conferir('depois do estorno o pedido cancela', (await chamar('POST', `/pedidos/${pedido.id}/cancelar`)).json.status === 'CANCELADO')

encerrar()
