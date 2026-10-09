// Créditos: avulso, uso no faturamento, estorno do uso e da devolução; devoluções abatendo o faturamento;
// filtros das contas a receber e relatório de cobrança.
import { chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

const dia = (deslocamento) => new Date(Date.now() + deslocamento * 864e5).toLocaleDateString('sv-SE')
const hoje = dia(0)
const mes = hoje.slice(0, 7)
await entrarComoAdmin()
const admin = sessao.token
const pessoa = async (dados) => (await chamar('POST', '/pessoas', dados)).json
const cliente = await pessoa({ cliente: true, nome: 'Carla Cliente', celular: '(11) 99999-0000' })
const outro = await pessoa({ cliente: true, nome: 'Otávio Outro' })
const vendedora = await pessoa({ vendedor: true, nome: 'Valéria Vendas' })
const medico = await pessoa({ medico: true, nome: 'Dr. Paulo' })
const prod = (await chamar('POST', '/produtos', { sku: 'CR1', nome: 'Produto crédito', precoCusto: 2000, precoVenda: 10000 })).json
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: prod.id, quantidade: 20, custoUnitario: 2000 }] })
const saldoProduto = async () => (await chamar('GET', '/produtos')).json.find((p) => p.id === prod.id).saldo
const vender = async (dados, faturar) => {
  const pedido = (await chamar('POST', '/pedidos', { clienteId: cliente.id, itens: [{ produtoId: prod.id, quantidade: 1, precoUnitario: 10000 }], ...dados })).json
  const faturado = await chamar('POST', `/pedidos/${pedido.id}/faturar`, { formaPagamento: 'PIX', primeiroVencimento: hoje, ...faturar })
  return { pedido, faturado }
}
const creditos = async (qs = '') => (await chamar('GET', `/creditos${qs}`)).json

// Crédito avulso
conferir('crédito avulso sem motivo -> 400', (await chamar('POST', '/creditos', { pessoaId: cliente.id, valor: 1000, descricao: '' })).status === 400)
const avulso = await chamar('POST', '/creditos', { pessoaId: cliente.id, valor: 3000, descricao: 'Acordo comercial' })
conferir('lança crédito avulso', avulso.status === 201 && avulso.json.origem === 'AVULSO' && avulso.json.saldo === 3000 && avulso.json.elegiveis.length === 1, JSON.stringify(avulso.json?.erro ?? ''))
const cancelavel = (await chamar('POST', '/creditos', { pessoaId: outro.id, valor: 500, descricao: 'Lançado errado' })).json
conferir('cancela crédito avulso não usado', (await chamar('POST', `/creditos/${cancelavel.id}/cancelar`)).json.status === 'CANCELADO')
conferir('não cancela duas vezes -> 409', (await chamar('POST', `/creditos/${cancelavel.id}/cancelar`)).status === 409)
conferir('filtro pela pessoa elegível', (await creditos(`?pessoaId=${cliente.id}`)).length === 1 && (await creditos(`?pessoaId=${outro.id}`)).length === 1)

// Crédito usado no faturamento, em duas parcelas de 50,00
const comCredito = await vender({ vendedorId: vendedora.id, medicoId: medico.id }, { parcelas: 2, creditos: [{ creditoId: avulso.json.id, valor: 6000 }] })
conferir('crédito maior que o saldo dele -> 400 e nada faturado', comCredito.faturado.status === 400 && (await chamar('GET', `/pedidos/${comCredito.pedido.id}`)).json.status === 'ABERTO')
const faturado = await chamar('POST', `/pedidos/${comCredito.pedido.id}/faturar`, { formaPagamento: 'PIX', primeiroVencimento: hoje, parcelas: 2, creditos: [{ creditoId: avulso.json.id, valor: 3000 }] })
const parcelas = (await chamar('GET', `/pedidos/${comCredito.pedido.id}`)).json.contasReceber
conferir('crédito abate as parcelas da primeira para a última', faturado.status === 200 && parcelas[0].valorPago === 3000 && parcelas[0].status === 'ABERTA' && parcelas[1].valorPago === 0, JSON.stringify(faturado.json?.erro ?? parcelas))
conferir('crédito esgotado depois do faturamento', (await creditos()).find((c) => c.id === avulso.json.id).status === 'ESGOTADO')
const outroCredito = (await chamar('POST', '/creditos', { pessoaId: outro.id, valor: 1000, descricao: 'De outra pessoa' })).json
const { faturado: alheio } = await vender({}, { creditos: [{ creditoId: outroCredito.id, valor: 1000 }] })
conferir('crédito de outra pessoa não vale -> 400', alheio.status === 400)

// Estorno do uso do crédito
const usos = (await creditos()).find((c) => c.id === avulso.json.id).usos
const estorno = await chamar('POST', `/creditos/usos/${usos[0].id}/estornar`)
conferir('estornar o uso devolve o saldo do crédito', estorno.status === 200 && estorno.json.saldo === 3000 && estorno.json.status === 'DISPONIVEL', JSON.stringify(estorno.json?.erro ?? ''))
conferir('a parcela volta a ter saldo', (await chamar('GET', `/pedidos/${comCredito.pedido.id}`)).json.contasReceber[0].valorPago === 0)
conferir('uso estornado não estorna de novo -> 409', (await chamar('POST', `/creditos/usos/${usos[0].id}/estornar`)).status === 409)
const historico = (await chamar('GET', `/contas-receber/${parcelas[0].id}/baixas`)).json
conferir('o uso estornado aparece no histórico da conta', historico.some((m) => m.origem === 'CREDITO' && m.estornado))

// Devolução e estorno da devolução
const pedidoId = comCredito.pedido.id
const item = (await chamar('GET', `/pedidos/${pedidoId}`)).json.itens[0]
const antes = await saldoProduto()
const devolucao = (await chamar('POST', '/devolucoes', { pedidoId, itens: [{ pedidoItemId: item.id, quantidade: 1 }] })).json
conferir('devolução gera crédito e devolve o estoque', devolucao.credito.valorOriginal === 10000 && (await saldoProduto()) === antes + 1)

// Dashboard e relatório abatem a devolução
let painel = (await chamar('GET', `/dashboards/comercial?mes=${mes}`)).json
conferir('faturamento líquido das devoluções', painel.kpis.vendasBrutas === 10000 && painel.kpis.devolucoes === 10000 && painel.kpis.faturamento === 0, JSON.stringify(painel.kpis))
conferir('custo devolvido sai do custo', painel.kpis.custo === 0 && painel.kpis.margem === 0)
conferir('rankings sem a venda devolvida', painel.topClientes.length === 0 && painel.topProdutos.length === 0)
conferir('histórico mostra o devolvido', painel.historico[5].devolvido === 10000 && painel.historico[5].total === 0)
conferir('início abate a devolução', (await chamar('GET', '/dashboard/resumo')).json.vendas.total === 0)
conferir('relatório de vendas mostra o devolvido', (await chamar('GET', '/relatorios/vendas')).json.resumo.devolvido === 10000)
conferir('pedido com devolução não cancela -> 409', (await chamar('POST', `/pedidos/${pedidoId}/cancelar`)).status === 409)

// Crédito da devolução usado impede o estorno; estornado o uso, a devolução é estornada
const credDev = devolucao.credito
await chamar('POST', `/creditos/${credDev.id}/utilizar`, { contaReceberId: parcelas[1].id, pessoaId: cliente.id, valor: 1000 })
conferir('com o crédito usado, não estorna a devolução -> 409', (await chamar('POST', `/devolucoes/${devolucao.id}/estornar`)).status === 409)
const usoDev = (await creditos()).find((c) => c.id === credDev.id).usos[0]
await chamar('POST', `/creditos/usos/${usoDev.id}/estornar`)
const estornada = await chamar('POST', `/devolucoes/${devolucao.id}/estornar`)
conferir('estorna a devolução', estornada.status === 200 && estornada.json.estornada === true && estornada.json.credito.status === 'CANCELADO', JSON.stringify(estornada.json?.erro ?? ''))
conferir('o estoque volta a sair', (await saldoProduto()) === antes)
conferir('não estorna duas vezes -> 409', (await chamar('POST', `/devolucoes/${devolucao.id}/estornar`)).status === 409)
const saldos = (await chamar('GET', `/devolucoes/pedido/${pedidoId}/saldos`)).json
conferir('o item volta a poder ser devolvido', saldos[0].disponivel === 1)
painel = (await chamar('GET', `/dashboards/comercial?mes=${mes}`)).json
conferir('faturamento volta ao valor da venda', painel.kpis.faturamento === 10000 && painel.kpis.devolucoes === 0)
const movimentos = (await chamar('GET', `/produtos/${prod.id}/movimentos`)).json
conferir('estoque registra o estorno da devolução', movimentos[0].origem === 'ESTORNO_DEVOLUCAO' && movimentos[0].tipo === 'SAIDA')

// Estoque insuficiente para estornar a devolução
const dev2 = (await chamar('POST', '/devolucoes', { pedidoId, itens: [{ pedidoItemId: item.id, quantidade: 1 }] })).json
const tudo = await saldoProduto()
await chamar('POST', `/produtos/${prod.id}/ajuste`, { novoSaldo: 0, observacao: 'Zerado para o teste' })
conferir('sem estoque, não estorna a devolução -> 409', (await chamar('POST', `/devolucoes/${dev2.id}/estornar`)).status === 409)
await chamar('POST', `/produtos/${prod.id}/ajuste`, { novoSaldo: tudo, observacao: 'Volta' })

// Filtros das contas a receber e relatório de cobrança
const vencida = (await chamar('POST', '/contas-receber', { pessoaId: outro.id, descricao: 'Antiga', valor: 2500, vencimento: dia(-10) })).json
const receber = async (qs) => (await chamar('GET', `/contas-receber?${qs}`)).json
conferir('filtro por cliente', (await receber(`pessoaId=${outro.id}`)).length === 1)
conferir('filtro por vendedor e médico da venda', (await receber(`vendedorId=${vendedora.id}`)).length === 2 && (await receber(`medicoId=${medico.id}`)).every((c) => c.pedido.medico.id === medico.id))
conferir('filtro pelo vencimento', (await receber(`fim=${dia(-1)}`)).length === 1 && (await receber(`inicio=${hoje}&fim=${hoje}`)).every((c) => c.vencimento.slice(0, 10) === hoje))
const cobranca = (await chamar('GET', '/relatorios/cobranca?vencidas=1')).json
conferir('cobrança só das vencidas', cobranca.linhas.length === 1 && cobranca.linhas[0].id === vencida.id && cobranca.linhas[0].diasAtraso === 10 && cobranca.resumo.vencido === 2500 && cobranca.resumo.aVencer === 0, JSON.stringify(cobranca.resumo))
const todas = (await chamar('GET', '/relatorios/cobranca')).json
const daCarla = todas.porCliente.find((g) => g.cliente === 'Carla Cliente')
conferir('cobrança agrupa por cliente com o contato', daCarla.telefone === '(11) 99999-0000' && daCarla.vencido === 0 && todas.porCliente[0].cliente === 'Otávio Outro')
conferir('cobrança por vendedor', (await chamar('GET', `/relatorios/cobranca?vendedorId=${vendedora.id}`)).json.linhas.every((l) => l.vendedor === 'Valéria Vendas'))

// Permissões
const perfil = (await chamar('POST', '/perfis', { nome: 'Usa crédito', permissoes: ['CREDITOS_UTILIZAR', 'CONTAS_RECEBER_VISUALIZAR'], dashboards: [] })).json
await chamar('POST', '/usuarios', { nome: 'Rui', email: 'rui@prumo.local', senha: 'senha-12345', perfilId: perfil.id })
sessao.token = (await chamar('POST', '/auth/login', { email: 'rui@prumo.local', senha: 'senha-12345' })).json.token
conferir('quem só usa crédito não lança avulso -> 403', (await chamar('POST', '/creditos', { pessoaId: cliente.id, valor: 100, descricao: 'x' })).status === 403)
conferir('quem vê contas a receber vê a cobrança e as pessoas', (await chamar('GET', '/relatorios/cobranca')).status === 200 && (await chamar('GET', '/pessoas')).status === 200)
sessao.token = admin

encerrar()
