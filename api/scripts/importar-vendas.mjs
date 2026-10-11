// Importa pedidos faturados, suas contas a receber e entregas a partir de arquivos JSON do SG Nexus.
// Uso: npm run vps -- npx tsx --env-file=.env.producao scripts/importar-vendas.mjs --empresa=<id> <pasta>
// A pasta deve ter pedidos.json (GET /pedidos), contas-receber.json e infinity-entregas.json.
// --descontar-estoque: para vendas feitas no SG Nexus DEPOIS de importar os saldos (importação complementar);
// a saída do pedido baixa o saldo atual, em vez de subir o saldo inicial.
// Rode depois de importar-pessoas e importar-produtos. O número do pedido no SG Nexus vira o número no
// Prumo; pedidos já importados são ignorados, e um número já usado por outro pedido interrompe a importação.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { naEmpresa, prisma } from './empresa.mjs'

const centavos = (v) => Math.round(Number(v ?? 0) * 100)
const limpo = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())
// Datas sem hora ficam ao meio-dia, como no restante do sistema, para o fuso não mudar o dia.
const dia = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00`)
// O SG Nexus mostra "à vista" como PIX nos relatórios.
const FORMAS = { A_VISTA: 'PIX', LINK_CARTAO_CREDITO: 'CARTAO_CREDITO', CARTAO_MAQUININHA: 'CARTAO_CREDITO', CARTAO_CREDITO: 'CARTAO_CREDITO', CARTAO_DEBITO: 'CARTAO_DEBITO', PIX: 'PIX', DINHEIRO: 'DINHEIRO', BOLETO: 'BOLETO', TRANSFERENCIA: 'TRANSFERENCIA' }
const SALDO_INICIAL = 'Saldo inicial importado do SG Nexus'
// Siglas do SG Nexus que têm outro nome no Prumo (as mesmas do importar-produtos).
const SIGLAS = { AMPOLA: 'AMP', FRASCO: 'FR', CAIXA: 'CX', UNIDADE: 'UN', PACOTE: 'PCT' }
const sigla = (s) => SIGLAS[String(s).toUpperCase()] ?? String(s).toUpperCase()

// Acha no Prumo a pessoa importada que corresponde ao cliente do SG Nexus.
async function acharPessoa(c) {
  const achadas = await prisma.pessoa.findMany({
    where: { nome: String(c.nomeRazaoSocial).trim(), documento: limpo(c.cpfCnpj), celular: limpo(c.celular) },
  })
  if (achadas.length !== 1) throw new Error(`Cliente ${c.id} do SG Nexus: ${achadas.length} correspondências no Prumo.`)
  return achadas[0]
}

await naEmpresa(async (argumentos, empresa) => {
  const descontar = argumentos.includes('--descontar-estoque')
  const [pasta] = argumentos.filter((a) => !a.startsWith('--'))
  if (!pasta) {
    console.error('Informe a pasta com os arquivos JSON.')
    process.exitCode = 1
    return
  }
  const ler = (nome) => JSON.parse(readFileSync(path.join(pasta, nome), 'utf8'))
  const pedidos = ler('pedidos.json')
  const contas = ler('contas-receber.json')
  const entregas = ler('infinity-entregas.json')

  const existentes = new Map(
    (await prisma.pedido.findMany({ select: { numero: true, total: true, cliente: { select: { nome: true } } } })).map((p) => [p.numero, p]),
  )
  const resumo = { pedidos: 0, itens: 0, contas: 0, entregas: 0, ignorados: 0 }

  for (const o of pedidos) {
    const existente = existentes.get(o.id)
    if (existente) {
      // Mesmo número com outro cliente ou outro total: o número já foi usado por um pedido lançado no Prumo.
      if (existente.total !== centavos(o.valorTotal) || existente.cliente.nome !== String(o.cliente.nomeRazaoSocial).trim()) {
        throw new Error(`Pedido nº ${o.id} do SG Nexus: o número já é de outro pedido no Prumo (${existente.cliente.nome}). Nada deste pedido em diante foi importado.`)
      }
      resumo.ignorados++
      continue
    }
    if (o.status !== 'FATURADO') throw new Error(`Pedido ${o.id}: situação ${o.status} não prevista na importação.`)
    const cliente = await acharPessoa(o.cliente)

    const itens = []
    for (const i of o.itens) {
      const produto = await prisma.produto.findFirst({ where: { sku: i.produto.codigo }, include: { unidades: true } })
      if (!produto) throw new Error(`Pedido ${o.id}: produto ${i.produto.codigo} não encontrado.`)
      // Venda em outra unidade (ex.: ampola de um produto controlado por caixa): o SG Nexus manda quanto
      // 1 unidade dela vale na base (0,25 = 1/4); no Prumo o fator é quantas cabem em 1 base (4).
      let unidade = produto.unidade
      let fator = 1
      if (Number(i.fatorEstoque) !== 1) {
        const extra = produto.unidades.find((u) => u.sigla === sigla(i.unidadeNegociada))
        if (!extra || Math.abs(extra.fator * Number(i.fatorEstoque) - 1) > 1e-9) {
          throw new Error(`Pedido ${o.id}: unidade ${i.unidadeNegociada} do produto ${produto.sku} não confere com o cadastro.`)
        }
        unidade = extra.sigla
        fator = extra.fator
      }
      itens.push({ produto, unidade, fator, quantidade: Number(i.quantidade), precoUnitario: centavos(i.precoUnitario), custoUnitario: centavos(i.custoMedioUnitario), desconto: centavos(i.descontoValorUnitario) })
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
      const { id: pedidoId } = await tx.pedido.create({
        data: {
          numero: o.id, // mantém o número do pedido
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
          // A data da venda no SG Nexus é `dataPedido` (editável lá); sem ela, a de criação.
          data: new Date(o.dataPedido ?? o.criadoEm),
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
              unidade: i.unidade,
              fator: i.fator,
            })),
          },
        },
      })

      // O saldo importado já desconta estas vendas. Para o histórico fechar (e o cancelamento devolver o
      // estoque), o saldo inicial sobe pela quantidade vendida e a saída do pedido o traz de volta.
      for (const i of itens.filter((x) => x.produto.controlaEstoque)) {
        const partes = Math.round((i.quantidade * i.produto.divisor) / i.fator)
        if (descontar) {
          const { saldo } = await tx.produto.update({ where: { id: i.produto.id }, data: { saldo: { decrement: partes } } })
          await tx.movimentoEstoque.create({
            data: { produtoId: i.produto.id, tipo: 'SAIDA', quantidade: partes, saldoApos: saldo, origem: 'PEDIDO', origemId: pedidoId, criadoEm: new Date(o.alteradoEm ?? o.criadoEm) },
          })
          continue
        }
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
          data: { produtoId: i.produto.id, tipo: 'SAIDA', quantidade: partes, saldoApos: saldo, origem: 'PEDIDO', origemId: pedidoId, criadoEm: new Date(o.alteradoEm ?? o.criadoEm) },
        })
      }

      for (const c of parcelas) {
        await tx.contaReceber.create({
          data: {
            pessoaId: cliente.id,
            pedidoId,
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
            pedidoId,
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

  // Os números foram informados à mão; a numeração da empresa continua a partir do maior.
  const maior = (await prisma.pedido.aggregate({ _max: { numero: true } }))._max.numero ?? 0
  await prisma.empresa.updateMany({ where: { id: empresa.id, ultimoPedido: { lt: maior } }, data: { ultimoPedido: maior } })

  console.log(JSON.stringify(resumo))
})
