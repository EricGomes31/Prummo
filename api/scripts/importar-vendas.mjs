// Importa pedidos faturados, suas contas a receber e entregas a partir de arquivos JSON do SG Nexus.
// Uso: node --env-file=.env scripts/importar-vendas.mjs <pasta>
// A pasta deve ter pedidos.json (GET /pedidos), contas-receber.json e infinity-entregas.json.
// Rode depois de importar-pessoas e importar-produtos. Pedidos cujo número já existe são ignorados.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const [pasta] = process.argv.slice(2)
if (!pasta) {
  console.error('Informe a pasta com os arquivos JSON.')
  process.exit(1)
}
const ler = (nome) => JSON.parse(readFileSync(path.join(pasta, nome), 'utf8'))

const prisma = new PrismaClient()
const centavos = (v) => Math.round(Number(v ?? 0) * 100)
const limpo = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())
// Datas sem hora ficam ao meio-dia, como no restante do sistema, para o fuso não mudar o dia.
const dia = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00`)
// O SG Nexus mostra "à vista" como PIX nos relatórios.
const FORMAS = { A_VISTA: 'PIX', LINK_CARTAO_CREDITO: 'CARTAO_CREDITO', CARTAO_MAQUININHA: 'CARTAO_CREDITO', CARTAO_CREDITO: 'CARTAO_CREDITO', CARTAO_DEBITO: 'CARTAO_DEBITO', PIX: 'PIX', DINHEIRO: 'DINHEIRO', BOLETO: 'BOLETO', TRANSFERENCIA: 'TRANSFERENCIA' }
const SALDO_INICIAL = 'Saldo inicial importado do SG Nexus'

const pedidos = ler('pedidos.json')
const contas = ler('contas-receber.json')
const entregas = ler('infinity-entregas.json')

const existentes = new Set((await prisma.pedido.findMany({ select: { id: true } })).map((p) => p.id))
const resumo = { pedidos: 0, itens: 0, contas: 0, entregas: 0, ignorados: 0 }

// Acha no Prumo a pessoa importada que corresponde ao cliente do SG Nexus.
async function acharPessoa(c) {
  const achadas = await prisma.pessoa.findMany({
    where: { nome: String(c.nomeRazaoSocial).trim(), documento: limpo(c.cpfCnpj), celular: limpo(c.celular) },
  })
  if (achadas.length !== 1) throw new Error(`Cliente ${c.id} do SG Nexus: ${achadas.length} correspondências no Prumo.`)
  return achadas[0]
}

for (const o of pedidos) {
  if (existentes.has(o.id)) {
    resumo.ignorados++
    continue
  }
  if (o.status !== 'FATURADO') throw new Error(`Pedido ${o.id}: situação ${o.status} não prevista na importação.`)
  const cliente = await acharPessoa(o.cliente)

  const itens = []
  for (const i of o.itens) {
    if (Number(i.fatorEstoque) !== 1) throw new Error(`Pedido ${o.id}: item em unidade diferente da base não previsto.`)
    const produto = await prisma.produto.findUnique({ where: { sku: i.produto.codigo } })
    if (!produto) throw new Error(`Pedido ${o.id}: produto ${i.produto.codigo} não encontrado.`)
    itens.push({ produto, quantidade: Number(i.quantidade), precoUnitario: centavos(i.precoUnitario), custoUnitario: centavos(i.custoMedioUnitario), desconto: centavos(i.descontoValorUnitario) })
  }
  const subtotal = itens.reduce((s, i) => s + i.quantidade * i.precoUnitario, 0)
  const descontoItens = itens.reduce((s, i) => s + i.quantidade * i.desconto, 0)
  const frete = centavos(o.valorFrete)
  const total = centavos(o.valorTotal)
  if (subtotal - descontoItens + frete !== total) throw new Error(`Pedido ${o.id}: o total não fecha com os itens.`)
  // Vendedor, médico e paciente são pessoas do cadastro, todos opcionais.
  const pessoaOpcional = async (c) => (c ? (await acharPessoa(c)).id : null)

  const parcelas = contas.filter((c) => c.pedidoId === o.id)
  for (const c of parcelas) {
    if (c.status !== 'ABERTO' || centavos(c.saldoReceber) !== centavos(c.valorOriginal)) {
      throw new Error(`Conta a receber ${c.id}: situação ${c.status} ou recebimento parcial não previstos.`)
    }
  }
  const entregasDoPedido = entregas.filter((e) => e.pedidoId === o.id)
  for (const e of entregasDoPedido) {
    if (e.status !== 'AGUARDANDO') throw new Error(`Entrega ${e.id}: situação ${e.status} não prevista na importação.`)
  }

  await prisma.$transaction(async (tx) => {
    await tx.pedido.create({
      data: {
        id: o.id, // mantém o número do pedido
        clienteId: cliente.id,
        vendedorId: await pessoaOpcional(o.vendedor),
        medicoId: await pessoaOpcional(o.medico),
        pacienteId: await pessoaOpcional(o.paciente),
        natureza: o.naturezaOperacao ?? 'VENDA',
        status: 'FATURADO',
        subtotal,
        descontoItens,
        frete,
        total,
        observacao: limpo(o.observacao),
        criadoEm: new Date(o.criadoEm),
        faturadoEm: new Date(o.alteradoEm ?? o.criadoEm),
        formaPagamento: FORMAS[o.condicaoPagamento] ?? null,
        itens: {
          create: itens.map((i) => ({
            produtoId: i.produto.id,
            quantidade: i.quantidade,
            precoUnitario: i.precoUnitario,
            desconto: i.desconto,
            custoUnitario: i.custoUnitario,
            unidade: i.produto.unidade,
            fator: 1,
          })),
        },
      },
    })

    // O saldo importado já desconta estas vendas. Para o histórico fechar (e o cancelamento devolver o
    // estoque), o saldo inicial sobe pela quantidade vendida e a saída do pedido o traz de volta.
    for (const i of itens.filter((x) => x.produto.controlaEstoque)) {
      const partes = i.quantidade * i.produto.divisor
      const inicial = await tx.movimentoEstoque.findFirst({ where: { produtoId: i.produto.id, observacao: { startsWith: SALDO_INICIAL } } })
      if (inicial) {
        await tx.movimentoEstoque.update({
          where: { id: inicial.id },
          data: { quantidade: { increment: partes }, observacao: `${SALDO_INICIAL} (antes das vendas importadas)` },
        })
        await tx.movimentoEstoque.updateMany({ where: { produtoId: i.produto.id }, data: { saldoApos: { increment: partes } } })
      } else {
        await tx.movimentoEstoque.create({
          data: { produtoId: i.produto.id, tipo: 'AJUSTE', quantidade: partes, saldoApos: partes, origem: 'AJUSTE', observacao: `${SALDO_INICIAL} (antes das vendas importadas)` },
        })
      }
      const { saldo } = await tx.produto.findUniqueOrThrow({ where: { id: i.produto.id } })
      await tx.movimentoEstoque.create({
        data: { produtoId: i.produto.id, tipo: 'SAIDA', quantidade: partes, saldoApos: saldo, origem: 'PEDIDO', origemId: o.id, criadoEm: new Date(o.alteradoEm ?? o.criadoEm) },
      })
    }

    for (const c of parcelas) {
      await tx.contaReceber.create({
        data: {
          pessoaId: cliente.id,
          pedidoId: o.id,
          descricao: `Pedido nº ${o.id} — parcela ${c.numeroParcela}/${parcelas.length}`,
          valor: centavos(c.valorOriginal),
          vencimento: dia(c.dataVencimento),
          status: 'ABERTA',
          criadoEm: new Date(c.criadoEm),
        },
      })
    }

    for (const e of entregasDoPedido) {
      // O Prumo guarda o endereço em campos separados; usa o cadastro do cliente quando ele está completo.
      const doCadastro = cliente.logradouro && cliente.cidade
      await tx.entrega.create({
        data: {
          pedidoId: o.id,
          status: 'PENDENTE',
          dataPrevista: dia(e.previsao),
          destinatario: limpo(e.destinatario) ?? cliente.nome,
          telefone: limpo(e.telefone),
          cep: doCadastro ? cliente.cep : null,
          logradouro: doCadastro ? cliente.logradouro : String(e.endereco).trim(),
          numero: doCadastro ? cliente.numero : null,
          complemento: doCadastro ? cliente.complemento : null,
          bairro: doCadastro ? cliente.bairro : null,
          cidade: doCadastro ? cliente.cidade : '(ver logradouro)',
          uf: doCadastro ? cliente.uf : null,
          // O endereço digitado na entrega pode ter mais detalhes que o cadastro (apartamento, referência).
          observacao: [limpo(e.observacao), doCadastro ? `Endereço informado no SG Nexus: ${String(e.endereco).trim()}` : null].filter(Boolean).join(' · ') || null,
          criadoEm: new Date(e.alteradoEm),
        },
      })
      if (!doCadastro) console.log(`Entrega do pedido ${o.id}: cliente sem endereço completo; o endereço foi inteiro para o logradouro.`)
    }
  })
  resumo.pedidos++
  resumo.itens += itens.length
  resumo.contas += parcelas.length
  resumo.entregas += entregasDoPedido.length
}

// Os números foram informados à mão; a numeração automática continua a partir do maior.
await prisma.$executeRawUnsafe(`select setval(pg_get_serial_sequence('"Pedido"', 'id'), (select coalesce(max(id), 1) from "Pedido"))`)

console.log(JSON.stringify(resumo))
await prisma.$disconnect()
