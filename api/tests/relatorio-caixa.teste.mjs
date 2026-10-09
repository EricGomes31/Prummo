// Relatório de caixa e conciliação: movimentos por período, conta, tipo e situação da conciliação.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

const diaLocal = (d) => d.toLocaleDateString('sv-SE')
const hoje = diaLocal(new Date())
const ontem = diaLocal(new Date(Date.now() - 864e5))
await entrarComoAdmin()
const marca = `RC${Date.now().toString(36)}`
const caixa = (await chamar('POST', '/contas-financeiras', { nome: `${marca} Gaveta`, tipo: 'CAIXA' })).json
const outra = (await chamar('POST', '/contas-financeiras', { nome: `${marca} Cofre`, tipo: 'CAIXA' })).json

await chamar('POST', '/movimentos-financeiros', { contaFinanceiraId: caixa.id, tipo: 'ENTRADA', valor: 10000, data: hoje, historico: `${marca} suprimento` })
await chamar('POST', '/movimentos-financeiros', { contaFinanceiraId: caixa.id, tipo: 'SAIDA', valor: 3000, data: hoje, historico: `${marca} sangria` })
await chamar('POST', '/movimentos-financeiros', { contaFinanceiraId: outra.id, tipo: 'ENTRADA', valor: 700, data: ontem, historico: `${marca} troco de ontem` })
const conta = (await chamar('POST', '/contas-receber', { descricao: `${marca} venda balcão`, valor: 2500, vencimento: hoje })).json
await chamar('POST', `/contas-receber/${conta.id}/baixar`, { valor: 2500, data: hoje, contaFinanceiraId: caixa.id })

const rel = async (qs) => (await chamar('GET', `/relatorios/caixa?${qs}`)).json
let r = await rel(`contaFinanceiraId=${caixa.id}`)
conferir('movimentos da conta', r.linhas.length === 3 && r.linhas.every((l) => l.conta === caixa.nome), JSON.stringify(r.linhas.map((l) => l.historico)))
conferir('resumo da conta', r.resumo.entradas === 12500 && r.resumo.saidas === 3000 && r.resumo.saldo === 9500, JSON.stringify(r.resumo))
conferir('baixa traz o título relacionado', r.linhas.find((l) => l.origem === 'RECEBIMENTO')?.titulo === `${marca} venda balcão`)
conferir('nada conciliado: todos pendentes', r.resumo.naoConciliados === 3 && r.linhas.every((l) => !l.conciliado))
conferir('filtro de conciliados', (await rel(`contaFinanceiraId=${caixa.id}&conciliacao=CONCILIADOS`)).linhas.length === 0 && (await rel(`contaFinanceiraId=${caixa.id}&conciliacao=PENDENTES`)).linhas.length === 3)
conferir('filtro por tipo', (await rel(`contaFinanceiraId=${caixa.id}&tipo=SAIDA`)).linhas.map((l) => l.valor).join() === '3000')
conferir('filtro por período', (await rel(`busca=${marca}&inicio=${ontem}&fim=${ontem}`)).linhas.map((l) => l.conta).join() === outra.nome)
conferir('busca no histórico', (await rel(`busca=${encodeURIComponent(marca + ' sangria')}`)).linhas.length === 1)
conferir('conciliação inválida -> 400', (await chamar('GET', '/relatorios/caixa?conciliacao=TALVEZ')).status === 400)

await encerrar()
