// Entradas de estoque: natureza, condição de pagamento, frete, despesas e CFOP.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

await entrarComoAdmin()

const forn = (await chamar('POST', '/pessoas', { fornecedor: true, nome: 'Fornecedor Entrada' })).json
const A = (await chamar('POST', '/produtos', { nome: 'Item A', unidade: 'CX', precoVenda: 5000 })).json
const B = (await chamar('POST', '/produtos', { nome: 'Item B', precoVenda: 900 })).json
const itens = [{ produtoId: A.id, quantidade: 4, custoUnitario: 2500 }, { produtoId: B.id, quantidade: 10, custoUnitario: 300 }]
const base = { fornecedorId: forn.id, data: '2026-10-31', itens }

conferir('condição sem fornecedor -> 400', (await chamar('POST', '/entradas', { data: '2026-10-31', condicaoPagamento: '30', itens })).status === 400)
conferir('condição inválida -> 400', (await chamar('POST', '/entradas', { ...base, condicaoPagamento: '30 dias' })).status === 400)
conferir('CFOP inválido -> 400', (await chamar('POST', '/entradas', { ...base, cfop: '11' })).status === 400)
conferir('natureza inválida -> 400', (await chamar('POST', '/entradas', { ...base, natureza: 'DOACAO' })).status === 400)
conferir('bonificação com condição -> 400', (await chamar('POST', '/entradas', { ...base, natureza: 'BONIFICACAO', condicaoPagamento: '30' })).status === 400)
conferir('produto repetido -> 400', (await chamar('POST', '/entradas', { ...base, itens: [itens[0], itens[0]] })).status === 400)
conferir('nada foi gravado pelas tentativas inválidas', (await chamar('GET', '/entradas')).json.length === 0 && (await chamar('GET', '/produtos')).json.every((p) => p.saldo === 0))

// Compra: itens 13.000 + frete 1.000 + despesas 1 = 14.001 em 3 parcelas
const compra = await chamar('POST', '/entradas', { ...base, condicaoPagamento: '30/60/90', frete: 1000, outrasDespesas: 1, cfop: '1102', numeroDocumento: 'NF 123' })
const e = compra.json
conferir('compra grava os campos', compra.status === 201 && e.natureza === 'COMPRA_REVENDA' && e.condicaoPagamento === '30/60/90' && e.frete === 1000 && e.outrasDespesas === 1 && e.cfop === '1102' && e.numeroDocumento === 'NF 123' && e.fornecedor.nome === 'Fornecedor Entrada', JSON.stringify(e?.erro ?? ''))
conferir('total inclui frete e despesas', e.total === 14001)
const detalhe = (await chamar('GET', `/entradas/${e.id}`)).json
const parcelas = detalhe.contasPagar
conferir('3 parcelas somam o total', parcelas.length === 3 && parcelas.reduce((s, c) => s + c.valor, 0) === 14001 && parcelas[0].valor === 4667, parcelas.map((c) => c.valor).join('+'))
conferir('vencimentos pelos prazos em dias', parcelas.map((c) => c.vencimento.slice(0, 10)).join(',') === '2026-11-30,2026-12-30,2027-01-29', parcelas.map((c) => c.vencimento.slice(0, 10)).join(','))
conferir('parcelas ficam no fornecedor', (await chamar('GET', '/contas-pagar')).json.filter((c) => c.pessoa?.id === forn.id).length === 3)
let prods = (await chamar('GET', '/produtos')).json
conferir('compra soma saldo e atualiza custo', prods.find((p) => p.id === A.id).saldo === 4 && prods.find((p) => p.id === A.id).precoCusto === 2500 && prods.find((p) => p.id === B.id).precoCusto === 300)

// Bonificação: soma saldo, não muda custo, não gera conta
const bonus = await chamar('POST', '/entradas', { fornecedorId: forn.id, natureza: 'BONIFICACAO', data: '2026-10-31', itens: [{ produtoId: A.id, quantidade: 2, custoUnitario: 0 }] })
prods = (await chamar('GET', '/produtos')).json
conferir('bonificação soma saldo sem mudar custo', bonus.status === 201 && prods.find((p) => p.id === A.id).saldo === 6 && prods.find((p) => p.id === A.id).precoCusto === 2500)
conferir('bonificação não gera conta a pagar', (await chamar('GET', `/entradas/${bonus.json.id}`)).json.contasPagar.length === 0)

// À vista vence na data da entrada; sem condição não gera conta
const vista = await chamar('POST', '/entradas', { ...base, condicaoPagamento: '0', itens: [itens[1]] })
const contaVista = (await chamar('GET', `/entradas/${vista.json.id}`)).json.contasPagar
conferir('à vista: uma parcela na data da entrada', contaVista.length === 1 && contaVista[0].vencimento.startsWith('2026-10-31') && contaVista[0].valor === 3000)
const carga = await chamar('POST', '/entradas', { data: '2026-10-31', itens: [itens[1]] })
conferir('carga sem fornecedor e sem conta', carga.status === 201 && carga.json.fornecedor === null && (await chamar('GET', `/entradas/${carga.json.id}`)).json.contasPagar.length === 0)

encerrar()
