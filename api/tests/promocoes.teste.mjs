// Promoções: cálculo de cada modalidade, vigência, permissões e uso no pedido.
import { SENHA_ADMIN, chamar, conferir, encerrar, sessao } from './apoio.mjs'

const dia = (deslocamento) => new Date(Date.now() + deslocamento * 864e5).toLocaleDateString('sv-SE')
const hoje = dia(0)

const admin = (await chamar('POST', '/auth/login', { email: 'admin@prumo.local', senha: SENHA_ADMIN })).json.token
sessao.token = admin
const cliente = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente Promo' })).json
const [A, B, C] = await Promise.all(
  [['PA', 1000], ['PB', 2500], ['PC', 400]].map(async ([sku, preco]) => (await chamar('POST', '/produtos', { sku, nome: `Produto ${sku}`, precoCusto: 100, precoVenda: preco })).json),
)
const item = (p, quantidade) => ({ produtoId: p.id, quantidade, precoUnitario: p.precoVenda })
const base = { inicio: dia(-1), fim: dia(1) }
const criar = async (dados) => chamar('POST', '/promocoes', { ...base, ...dados })
const simular = async (id, itens) => chamar('POST', `/promocoes/${id}/simular`, { itens })

// Validação do cadastro
conferir('percentual sem valor -> 400', (await criar({ nome: 'X', modalidade: 'PERCENTUAL', itens: [{ produtoId: A.id }] })).status === 400)
conferir('leve menor que pague -> 400', (await criar({ nome: 'X1', modalidade: 'LEVE_PAGUE', leve: 2, pague: 3, itens: [{ produtoId: A.id }] })).status === 400)
conferir('brinde sem brinde -> 400', (await criar({ nome: 'X2', modalidade: 'BRINDE', itens: [{ produtoId: A.id }] })).status === 400)
conferir('produto repetido -> 400', (await criar({ nome: 'X3', modalidade: 'PERCENTUAL', percentual: 1000, itens: [{ produtoId: A.id }, { produtoId: A.id }] })).status === 400)
conferir('fim antes do início -> 400', (await criar({ nome: 'X4', modalidade: 'PERCENTUAL', percentual: 1000, inicio: dia(2), fim: dia(1), itens: [{ produtoId: A.id }] })).status === 400)

// Percentual: 12,5% em A com mínimo de 3 unidades
const pct = (await criar({ nome: 'Dez e meio', modalidade: 'PERCENTUAL', percentual: 1250, itens: [{ produtoId: A.id, quantidade: 3 }] })).json
conferir('campanha criada e vigente', (await chamar('GET', '/promocoes')).json.find((c) => c.id === pct.id)?.vigente === true)
conferir('percentual abaixo do mínimo -> 400', (await simular(pct.id, [item(A, 2)])).status === 400)
conferir('percentual sobre todas as unidades', (await simular(pct.id, [item(A, 4), item(B, 1)])).json.desconto === 500)

// Preço promocional: A por 7,00 a partir de 2
const preco = (await criar({ nome: 'A por sete', modalidade: 'PRECO', preco: 700, itens: [{ produtoId: A.id, quantidade: 2 }] })).json
conferir('preço promocional', (await simular(preco.id, [item(A, 5)])).json.desconto === 1500)

// Leve 3 pague 2 em A e C: sobras ficam no preço normal
const lp = (await criar({ nome: 'Leve 3 pague 2', modalidade: 'LEVE_PAGUE', leve: 3, pague: 2, itens: [{ produtoId: A.id }, { produtoId: C.id }] })).json
conferir('leve e pague com sobra', (await simular(lp.id, [item(A, 7), item(C, 3), item(B, 3)])).json.desconto === 2 * 1000 + 400)
conferir('leve e pague sem conjunto -> 400', (await simular(lp.id, [item(A, 2)])).status === 400)

// Combo: 2 A + 1 B por 40,00 (normal 45,00)
const combo = (await criar({ nome: 'Combo', modalidade: 'COMBO', preco: 4000, itens: [{ produtoId: A.id, quantidade: 2 }, { produtoId: B.id, quantidade: 1 }] })).json
conferir('combo incompleto -> 400', (await simular(combo.id, [item(A, 2)])).status === 400)
conferir('combo: só conjuntos completos', (await simular(combo.id, [item(A, 5), item(B, 2)])).json.desconto === 2 * 500)

// Brinde: compre 2 B e ganhe 1 C
const brinde = (await criar({ nome: 'Brinde', modalidade: 'BRINDE', itens: [{ produtoId: B.id, quantidade: 2 }, { produtoId: C.id, quantidade: 1, papel: 'BRINDE' }] })).json
const semBrinde = await simular(brinde.id, [item(B, 2)])
conferir('brinde fora do pedido -> 400 com aviso', semBrinde.status === 400 && semBrinde.json.erro.includes('Produto PC'), semBrinde.json?.erro)
conferir('brinde: uma unidade grátis por conjunto', (await simular(brinde.id, [item(B, 5), item(C, 4)])).json.desconto === 2 * 400)
conferir('brinde limitado ao que está no pedido', (await simular(brinde.id, [item(B, 6), item(C, 1)])).json.desconto === 400)

// No pedido
const comManual = await chamar('POST', '/pedidos', { clienteId: cliente.id, promocaoId: pct.id, desconto: 100, itens: [item(A, 4)] })
conferir('campanha com desconto manual -> 400', comManual.status === 400)
conferir('pedido que não cumpre a campanha -> 400', (await chamar('POST', '/pedidos', { clienteId: cliente.id, promocaoId: pct.id, itens: [item(A, 1)] })).status === 400)
const ped = await chamar('POST', '/pedidos', { clienteId: cliente.id, promocaoId: pct.id, frete: 300, itens: [item(A, 4)] })
conferir('pedido grava desconto calculado', ped.status === 201 && ped.json.descontoPromocao === 500 && ped.json.total === 4000 - 500 + 300 && ped.json.promocao.nome === 'Dez e meio', JSON.stringify(ped.json?.erro ?? ''))
const edit = await chamar('PUT', `/pedidos/${ped.json.id}`, { clienteId: cliente.id, promocaoId: pct.id, itens: [item(A, 8)] })
conferir('editar recalcula o desconto', edit.json.descontoPromocao === 1000 && edit.json.total === 7000)
const semPromo = await chamar('PUT', `/pedidos/${ped.json.id}`, { clienteId: cliente.id, itens: [item(A, 8)] })
conferir('tirar a campanha zera o desconto', semPromo.json.descontoPromocao === 0 && semPromo.json.promocao === null && semPromo.json.total === 8000)
await chamar('PUT', `/pedidos/${ped.json.id}`, { clienteId: cliente.id, promocaoId: pct.id, itens: [item(A, 8)] })
await chamar('POST', '/entradas', { data: hoje, itens: [{ produtoId: A.id, quantidade: 20, custoUnitario: 100 }] })
await chamar('POST', `/pedidos/${ped.json.id}/faturar`, { parcelas: 2, primeiroVencimento: hoje, formaPagamento: 'PIX' })
const parcelas = (await chamar('GET', `/pedidos/${ped.json.id}`)).json.contasReceber
conferir('parcelas pelo total com desconto', parcelas.reduce((s, c) => s + c.valor, 0) === 7000)
conferir('dashboard soma desconto de campanha', (await chamar('GET', '/dashboards/comercial')).json.kpis.descontos === 1000)

// Vigência e permissão
const futura = (await criar({ nome: 'Futura', modalidade: 'PERCENTUAL', percentual: 1000, inicio: dia(2), fim: dia(5), itens: [{ produtoId: A.id }] })).json
conferir('campanha futura não vigente', (await chamar('GET', '/promocoes')).json.find((c) => c.id === futura.id).vigente === false && (await simular(futura.id, [item(A, 1)])).status === 400)
const soHoje = (await criar({ nome: 'Só hoje', modalidade: 'PERCENTUAL', percentual: 1000, inicio: hoje, fim: hoje, itens: [{ produtoId: A.id }] })).json
conferir('campanha de um dia vale hoje', (await simular(soHoje.id, [item(A, 1)])).json.desconto === 100)
const inativa = await chamar('PUT', `/promocoes/${preco.id}`, { ...base, nome: 'A por sete', modalidade: 'PRECO', preco: 700, ativo: false, itens: [{ produtoId: A.id, quantidade: 2 }] })
conferir('campanha desativada não se aplica', inativa.json.ativo === false && (await simular(preco.id, [item(A, 5)])).status === 400)
const trocada = await chamar('PUT', `/promocoes/${combo.id}`, { ...base, nome: 'Combo', modalidade: 'PERCENTUAL', percentual: 500, preco: 4000, itens: [{ produtoId: A.id }] })
conferir('trocar modalidade limpa campos sem uso', trocada.json.preco === null && trocada.json.percentual === 500 && trocada.json.itens.length === 1)
await chamar('POST', '/usuarios', { nome: 'Operador', email: 'op-promo@prumo.local', senha: 'operador-123', perfil: 'OPERADOR' })
sessao.token = (await chamar('POST', '/auth/login', { email: 'op-promo@prumo.local', senha: 'operador-123' })).json.token
conferir('operador não cria campanha -> 403', (await criar({ nome: 'Y', modalidade: 'PERCENTUAL', percentual: 1000, itens: [{ produtoId: A.id }] })).status === 403)
conferir('operador lista e simula', (await chamar('GET', '/promocoes')).status === 200 && (await simular(pct.id, [item(A, 4)])).json.desconto === 500)

encerrar()
