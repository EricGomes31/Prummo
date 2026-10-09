// Importadores do SG Nexus (scripts/importar-*.mjs): gravam na empresa informada em --empresa, mantêm o
// número do pedido do SG Nexus como número do pedido na empresa e podem ser rodados de novo sem duplicar.
// Os scripts rodam de verdade, como processos, contra o banco descartável da suíte.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chamar, conferir, encerrar, entrarComoAdmin, sessao } from './apoio.mjs'

const banco = process.env.TESTE_BANCO ?? ''
if (!/^postgresql:\/\/prumo:prumo@127\.0\.0\.1:\d+\/suite_/.test(banco)) {
  conferir('endereço do banco de teste recebido do executor', false, banco)
  encerrar()
}

const raiz = path.resolve(import.meta.dirname, '..')
const pasta = mkdtempSync(path.join(tmpdir(), 'prumo-importacao-'))
const gravar = (nome, dados) => writeFileSync(path.join(pasta, nome), JSON.stringify(dados))
const importar = (script, ...argumentos) => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join('scripts', script), ...argumentos], {
    cwd: raiz,
    env: { ...process.env, DATABASE_URL: banco, DIRECT_URL: banco },
    encoding: 'utf8',
  })
  return { status: r.status, saida: `${r.stdout}${r.stderr}` }
}

await entrarComoAdmin()
const admin = sessao.token
// A primeira empresa já tem pedidos próprios; a importação vai para a segunda.
const produto1 = (await chamar('POST', '/produtos', { sku: 'IMP-1', nome: 'Produto da Empresa 1', precoCusto: 100, precoVenda: 500 })).json
const cliente1 = (await chamar('POST', '/pessoas', { cliente: true, nome: 'Cliente da Empresa 1' })).json
await chamar('POST', '/pedidos', { clienteId: cliente1.id, itens: [{ produtoId: produto1.id, quantidade: 1, precoUnitario: 500 }] })
const corpo = { nome: 'Empresa Importada', administrador: { nome: 'Dona', email: 'dona@importada.test', senha: 'senha-da-importada' } }
const empresa = (await chamar('POST', '/sistema/empresas', corpo)).json
const naEmpresa = `--empresa=${empresa.id}`

// Arquivos no formato do SG Nexus.
const ana = { id: 11, nomeRazaoSocial: 'Ana Importada', cpfCnpj: '12345678909', celular: '11999990000' }
gravar('pessoas.json', [{ ...ana, cliente: true, ativo: true, criadoEm: '2026-08-01T10:00:00Z' }, { id: 12, nomeRazaoSocial: 'Bruno Vendedor', vendedor: true }])
// O mesmo código de um produto do seed da primeira empresa: códigos são únicos só dentro da empresa.
gravar('produtos.json', [{ id: 'sg-1', codigo: 'P-001', descricao: 'Produto importado', unidade: 'UNIDADE', unidadesConversao: {}, custoAtual: 4, precoVenda: 10 }])
gravar('saldos.json', { 'sg-1': 8 })
const pedido = (numero, total = 20, cliente = ana) => ({
  id: numero,
  status: 'FATURADO',
  cliente,
  itens: [{ fatorEstoque: 1, produto: { codigo: 'P-001' }, quantidade: total / 10, precoUnitario: 10, custoMedioUnitario: 4, descontoValorUnitario: 0 }],
  valorFrete: 0,
  valorTotal: total,
  condicaoPagamento: 'PIX',
  criadoEm: '2026-09-01T13:00:00Z',
})
gravar('pedidos.json', [pedido(7)])
gravar('contas-receber.json', [{ id: 1, pedidoId: 7, status: 'ABERTO', saldoReceber: 20, valorOriginal: 20, numeroParcela: 1, dataVencimento: '2026-10-01', criadoEm: '2026-09-01T13:00:00Z' }])
gravar('infinity-entregas.json', [
  { id: 1, pedidoId: 7, status: 'AGUARDANDO', previsao: '2026-10-02', destinatario: 'Ana', endereco: 'Rua A, 1', alteradoEm: '2026-09-01T13:00:00Z', pesoKg: 3, latitude: -23.5, longitude: -46.6, inicioRecebimento: '08:00:00', fimRecebimento: '12:00:00' },
])
gravar('infinity-motoristas.json', [{ nome: 'Xandy', ativo: true }])
gravar('infinity-veiculos.json', [{ placa: 'syc2i43', capacidadeKg: 500 }])

// Sem empresa, ou com uma que não existe, nada é gravado.
const semEmpresa = importar('importar-pessoas.mjs', path.join(pasta, 'pessoas.json'))
conferir('sem --empresa: para e lista as empresas', semEmpresa.status === 1 && semEmpresa.saida.includes('Empresa Importada'), semEmpresa.saida)
conferir('empresa inexistente: para', importar('importar-pessoas.mjs', '--empresa=999', path.join(pasta, 'pessoas.json')).status === 1)

const rodarTudo = () => [
  importar('importar-pessoas.mjs', naEmpresa, path.join(pasta, 'pessoas.json')),
  importar('importar-produtos.mjs', naEmpresa, path.join(pasta, 'produtos.json'), path.join(pasta, 'saldos.json')),
  importar('importar-vendas.mjs', naEmpresa, pasta),
  importar('importar-logistica.mjs', naEmpresa, pasta),
]
const primeira = rodarTudo()
conferir('os quatro importadores rodam', primeira.every((r) => r.status === 0), primeira.map((r) => r.saida).join('\n'))

sessao.token = (await chamar('POST', '/auth/login', { email: corpo.administrador.email, senha: corpo.administrador.senha })).json.token
const pessoas = (await chamar('GET', '/pessoas')).json
conferir('pessoas na empresa de destino', pessoas.length === 2 && pessoas.some((p) => p.nome === 'Ana Importada'), JSON.stringify(pessoas.map((p) => p.nome)))
const produtos = (await chamar('GET', '/produtos')).json
// O saldo importado (8) já descontava a venda de 2, que volta a sair pelo pedido importado.
conferir('produto com o mesmo código da outra empresa e saldo', produtos.length === 1 && produtos[0].sku === 'P-001' && produtos[0].saldo === 8, JSON.stringify(produtos))
const pedidos = (await chamar('GET', '/pedidos')).json
conferir('pedido mantém o número do SG Nexus', pedidos.length === 1 && pedidos[0].numero === 7 && pedidos[0].status === 'FATURADO', JSON.stringify(pedidos.map((p) => p.numero)))
const contas = (await chamar('GET', '/contas-receber?status=ABERTA')).json
conferir('conta a receber ligada ao pedido e com o número na descrição', contas.length === 1 && contas[0].pedido?.numero === 7 && contas[0].descricao.startsWith('Pedido nº 7 '), JSON.stringify(contas))
const entregas = (await chamar('GET', '/entregas')).json
conferir('entrega com os dados de rota', entregas.length === 1 && entregas[0].pedido.numero === 7 && entregas[0].pesoKg === 3 && entregas[0].inicioRecebimento === '08:00', JSON.stringify(entregas))
conferir('motorista e veículo', (await chamar('GET', '/motoristas')).json.length === 1 && (await chamar('GET', '/veiculos')).json[0]?.placa === 'SYC2I43')
const movimentos = (await chamar('GET', `/produtos/${produtos[0].id}/movimentos`)).json
conferir('saída de estoque mostra o número do pedido', movimentos.some((m) => m.origem === 'PEDIDO' && m.origemNumero === 7), JSON.stringify(movimentos))

const novo = (await chamar('POST', '/pedidos', { clienteId: pessoas.find((p) => p.nome === 'Ana Importada').id, itens: [{ produtoId: produtos[0].id, quantidade: 1, precoUnitario: 1000 }] })).json
conferir('numeração continua depois do maior importado', novo.numero === 8, `${novo.numero}`)

// De novo: nada se repete.
const segunda = rodarTudo()
conferir('rodar de novo funciona', segunda.every((r) => r.status === 0), segunda.map((r) => r.saida).join('\n'))
conferir('rodar de novo não duplica', (await chamar('GET', '/pessoas')).json.length === 2 && (await chamar('GET', '/pedidos')).json.length === 2 && (await chamar('GET', '/motoristas')).json.length === 1)

// Um número que no Prumo já é de outro pedido interrompe a importação.
gravar('pedidos.json', [pedido(7), pedido(8, 30)])
const conflito = importar('importar-vendas.mjs', naEmpresa, pasta)
conferir('número já usado por outro pedido -> para com aviso', conflito.status !== 0 && conflito.saida.includes('Pedido nº 8 do SG Nexus'), conflito.saida)
conferir('e não grava o pedido em conflito', (await chamar('GET', '/pedidos')).json.length === 2)

// A primeira empresa não recebeu nada.
sessao.token = admin
conferir('primeira empresa intacta', !(await chamar('GET', '/pessoas')).json.some((p) => p.nome === 'Ana Importada') && !(await chamar('GET', '/pedidos')).json.some((p) => p.numero === 7))

rmSync(pasta, { recursive: true, force: true })
encerrar()
