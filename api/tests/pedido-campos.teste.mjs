// Campos do pedido: vendedor, médico e paciente, natureza da operação e desconto por item.
import { chamar, conferir, encerrar, entrarComoAdmin } from './apoio.mjs'

const dia = (deslocamento) => new Date(Date.now() + deslocamento * 864e5).toLocaleDateString('sv-SE')
const hoje = dia(0)
const mes = hoje.slice(0, 7)

await entrarComoAdmin()
const pessoa = async (dados) => (await chamar('POST', '/pessoas', dados)).json
const cliente = await pessoa({ cliente: true, nome: 'Cliente Campos' })
const vendedor = await pessoa({ vendedor: true, nome: 'Vera Vendedora' })
const medico = await pessoa({ medico: true, nome: 'Dr. Mauro' })
const paciente = await pessoa({ paciente: true, nome: 'Paula Paciente' })
const prod = (await chamar('POST', '/produtos', { sku: 'PC1', nome: 'Produto campos', precoCusto: 0, precoVenda: 10000 })).json
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: prod.id, quantidade: 20, custoUnitario: 4000 }] })
const saldo = async () => (await chamar('GET', '/produtos')).json.find((p) => p.id === prod.id).saldo
const item = (quantidade, extra) => ({ produtoId: prod.id, quantidade, precoUnitario: 10000, ...extra })
const pedir = (dados) => chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [item(1)], ...dados })

// Vendedor, médico e paciente
const completo = await pedir({ vendedorId: vendedor.id, medicoId: medico.id, pacienteId: paciente.id })
conferir('pedido grava vendedor, médico e paciente', completo.status === 201 && completo.json.vendedor.nome === 'Vera Vendedora' && completo.json.medico.nome === 'Dr. Mauro' && completo.json.paciente.nome === 'Paula Paciente', JSON.stringify(completo.json?.erro ?? ''))
conferir('quem lançou fica separado do vendedor', completo.json.usuario.nome === 'Administrador')
conferir('natureza padrão é venda', completo.json.natureza === 'VENDA')
const simples = await pedir({})
conferir('os três são opcionais', simples.status === 201 && simples.json.vendedor === null && simples.json.medico === null && simples.json.paciente === null)
conferir('vendedor sem a classificação -> 400', (await pedir({ vendedorId: cliente.id })).status === 400)
conferir('médico sem a classificação -> 400', (await pedir({ medicoId: vendedor.id })).status === 400)
conferir('paciente inexistente -> 400', (await pedir({ pacienteId: 999999 })).status === 400)
const trocado = await chamar('PUT', `/pedidos/${completo.json.id}`, { clienteId: cliente.id, vendedorId: null, medicoId: medico.id, itens: [item(1)] })
conferir('editar troca e remove as pessoas', trocado.json.vendedor === null && trocado.json.medico.nome === 'Dr. Mauro' && trocado.json.paciente === null)
conferir('pessoa usada como médico não pode ser excluída', (await chamar('DELETE', `/pessoas/${medico.id}`)).status === 409)

// Desconto por item: 2 × (100,00 − 15,00) + 5,00 de frete − 10,00 no total
const comDesconto = await pedir({ vendedorId: vendedor.id, desconto: 1000, frete: 500, itens: [item(2, { desconto: 1500 })] })
const d = comDesconto.json
conferir('desconto do item entra no total', comDesconto.status === 201 && d.subtotal === 20000 && d.descontoItens === 3000 && d.total === 20000 - 3000 - 1000 + 500, JSON.stringify(d?.erro ?? d?.total))
conferir('item guarda o desconto', d.itens[0].desconto === 1500)
conferir('desconto maior que o preço -> 400', (await pedir({ itens: [item(1, { desconto: 10001 })] })).status === 400)
conferir('desconto no total maior que o líquido -> 400', (await pedir({ desconto: 8001, itens: [item(1, { desconto: 2000 })] })).status === 400)
const promo = (await chamar('POST', '/promocoes', { nome: 'Dez', modalidade: 'PERCENTUAL', percentual: 1000, inicio: dia(-1), fim: dia(1), itens: [{ produtoId: prod.id, quantidade: 1 }] })).json
conferir('campanha com desconto no item -> 400', (await pedir({ promocaoId: promo.id, itens: [item(1, { desconto: 100 })] })).status === 400)
await chamar('POST', `/pedidos/${d.id}/faturar`, { parcelas: 2, primeiroVencimento: hoje, formaPagamento: 'PIX' })
const parcelas = (await chamar('GET', `/pedidos/${d.id}`)).json.contasReceber
conferir('parcelas pelo total com os descontos', parcelas.reduce((s, c) => s + c.valor, 0) === 16500)

// Bonificação: baixa o estoque, sem contas a receber e fora do faturamento
const antesBonificacao = await saldo()
const bonificacao = await pedir({ natureza: 'BONIFICACAO', frete: 900, itens: [item(3)] })
conferir('bonificação não tem frete', bonificacao.status === 201 && bonificacao.json.natureza === 'BONIFICACAO' && bonificacao.json.frete === 0 && bonificacao.json.total === 30000)
conferir('bonificação com campanha -> 400', (await pedir({ natureza: 'BONIFICACAO', promocaoId: promo.id })).status === 400)
const confirmada = await chamar('POST', `/pedidos/${bonificacao.json.id}/faturar`, {})
conferir('bonificação é confirmada sem forma de pagamento', confirmada.status === 200 && confirmada.json.status === 'FATURADO' && confirmada.json.formaPagamento === null, JSON.stringify(confirmada.json?.erro ?? ''))
conferir('bonificação baixa o estoque', (await saldo()) === antesBonificacao - 3)
conferir('bonificação não gera contas a receber', (await chamar('GET', `/pedidos/${bonificacao.json.id}`)).json.contasReceber.length === 0)

// Perda: exige motivo, não tem preço, baixa o estoque e o cancelamento devolve
conferir('perda sem motivo -> 400', (await pedir({ natureza: 'PERDA' })).status === 400)
conferir('perda por outros motivos exige observação -> 400', (await pedir({ natureza: 'PERDA', motivoPerda: 'OUTROS' })).status === 400)
const perda = await pedir({ natureza: 'PERDA', motivoPerda: 'QUEBRA', desconto: 500, frete: 500, itens: [item(2, { desconto: 100 })] })
conferir('perda zera preço, desconto e frete', perda.status === 201 && perda.json.total === 0 && perda.json.subtotal === 0 && perda.json.desconto === 0 && perda.json.frete === 0 && perda.json.itens[0].precoUnitario === 0 && perda.json.motivoPerda === 'QUEBRA', JSON.stringify(perda.json?.erro ?? perda.json?.total))
const antesPerda = await saldo()
await chamar('POST', `/pedidos/${perda.json.id}/faturar`, {})
conferir('perda baixa o estoque', (await saldo()) === antesPerda - 2)
await chamar('POST', `/pedidos/${perda.json.id}/cancelar`)
conferir('cancelar a perda devolve o estoque', (await saldo()) === antesPerda)
conferir('venda continua exigindo forma de pagamento', (await chamar('POST', `/pedidos/${simples.json.id}/faturar`, {})).status === 400)

// Dashboard e relatório: só a venda faturada conta (pedido de 165,00)
const painel = (await chamar('GET', `/dashboards/comercial?mes=${mes}`)).json
conferir('faturamento só com vendas', painel.kpis.faturamento === 16500 && painel.kpis.vendas === 1, JSON.stringify(painel.kpis))
conferir('descontos somam itens e total', painel.kpis.descontos === 4000)
conferir('top vendedores usa a pessoa do pedido', painel.topVendedores.length === 1 && painel.topVendedores[0].nome === 'Vera Vendedora' && painel.topVendedores[0].total === 16500)
conferir('top produtos pelo valor líquido', painel.topProdutos[0].total === 17000, JSON.stringify(painel.topProdutos))
conferir('início conta só vendas', (await chamar('GET', '/dashboard/resumo')).json.vendas.quantidade === 1)
const rel = async (qs) => (await chamar('GET', `/relatorios/vendas${qs}`)).json
const todas = await rel('')
conferir('relatório lista todas as naturezas, valor só das vendas', todas.linhas.some((l) => l.natureza === 'BONIFICACAO') && todas.linhas.some((l) => l.natureza === 'PERDA') && todas.resumo.total === todas.linhas.filter((l) => l.natureza === 'VENDA' && l.status !== 'CANCELADO').reduce((s, l) => s + l.total, 0))
conferir('filtro por natureza', (await rel('?natureza=BONIFICACAO')).linhas.length === 1 && (await rel('?natureza=PERDA')).linhas.length === 1)
conferir('busca acha pelo médico', (await rel('?busca=Mauro')).linhas.some((l) => l.id === completo.json.id && l.medico === 'Dr. Mauro'))
conferir('perda não aparece para entrega', !(await chamar('GET', '/entregas/pedidos-disponiveis')).json.some((p) => p.id === perda.json.id))

encerrar()
