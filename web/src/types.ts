export type Perfil = 'ADMIN' | 'OPERADOR'

// `perfil` é o perfil de fábrica; com `perfilId`, vale o perfil de acesso personalizado, de nome `perfilNome`.
export type Usuario = { id: number; nome: string; email: string; perfil: Perfil; perfilId: number | null; perfilNome: string; ativo: boolean }

// Usuário da sessão, com os acessos já resolvidos pelo servidor. `sistema`: administrador do sistema,
// que além da própria empresa gerencia as empresas que usam o Prumo.
export type UsuarioSessao = Usuario & { permissoes: string[]; dashboards: string[]; sistema: boolean; empresa: { id: number; nome: string } }

// Empresa que usa o Prumo. Cada uma só vê os próprios dados.
export type Empresa = { id: number; nome: string; documento: string | null; ativa: boolean; criadoEm: string; usuarios: number }

export type PerfilPadrao = { codigo: Perfil; nome: string; descricao: string; permissoes: string[]; dashboards: string[] }

export type PerfilAcesso = {
  id: number
  nome: string
  descricao: string | null
  permissoes: string[]
  dashboards: string[]
  ativo: boolean
  usuarios: number // quantos usuários usam o perfil
}

export type Perfis = {
  padrao: PerfilPadrao[]
  personalizados: PerfilAcesso[]
  catalogo: {
    grupos: { grupo: string; permissoes: { codigo: string; rotulo: string }[] }[]
    dashboards: { codigo: string; rotulo: string }[]
  }
}

export type Pessoa = {
  id: number
  nome: string
  nomeFantasia: string | null
  documento: string | null
  rgIe: string | null
  email: string | null
  telefone: string | null
  celular: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  ativo: boolean
  // Link para a pessoa atualizar o próprio cadastro: até quando vale e quando ela atualizou da última vez.
  cadastroLinkExpiraEm: string | null
  cadastroAtualizadoEm: string | null
} & Record<Classificacao, boolean>

export type Classificacao = 'cliente' | 'fornecedor' | 'prestador' | 'paciente' | 'medico' | 'vendedor'

export type Produto = {
  id: number
  sku: string
  nome: string
  ean: string | null
  unidade: string
  // Unidades extras; `fator` = quantas cabem em 1 unidade base. Preço vazio = proporcional ao da base.
  unidades: { sigla: string; fator: number; precoVenda: number | null }[]
  // O saldo vem em partes: saldo / divisor = quantidade na unidade base.
  divisor: number
  controlaEstoque: boolean
  precoCusto: number
  precoVenda: number
  estoqueMinimo: number
  saldo: number
  ativo: boolean
}

export type Movimento = {
  id: number
  tipo: 'ENTRADA' | 'SAIDA' | 'AJUSTE'
  quantidade: number
  saldoApos: number
  origem: string
  origemId: number | null
  origemNumero: number | null // número que a tela mostra: o do pedido, quando a origem é um pedido
  observacao: string | null
  criadoEm: string
}

type ProdutoRef = { id: number; sku: string; nome: string; unidade: string }
type PessoaRef = { id: number; nome: string }

export type Entrada = {
  id: number
  fornecedor: PessoaRef | null
  natureza: 'COMPRA_REVENDA' | 'BONIFICACAO'
  numeroDocumento: string | null
  data: string
  condicaoPagamento: string | null
  frete: number
  outrasDespesas: number
  cfop: string | null
  documentos: number // quantidade de anexos
  total: number
  itens: { id: number; produtoId: number; unidade: string | null; quantidade: number; custoUnitario: number; produto: ProdutoRef }[]
}

export type StatusPedido = 'ABERTO' | 'FATURADO' | 'CANCELADO'

export type NaturezaPedido = 'VENDA' | 'BONIFICACAO' | 'PERDA'

export type Pedido = {
  id: number
  numero: number // sequencial dentro da empresa; é o que o usuário vê
  clienteId: number
  cliente: PessoaRef
  usuario: PessoaRef | null // quem lançou
  vendedor: PessoaRef | null
  medico: PessoaRef | null
  paciente: PessoaRef | null
  natureza: NaturezaPedido
  motivoPerda: string | null
  promocao: PessoaRef | null
  descontoPromocao: number
  status: StatusPedido
  subtotal: number
  descontoItens: number
  desconto: number
  frete: number
  total: number
  observacao: string | null
  // Data da venda (escolhida no pedido); criadoEm é quando foi lançado.
  data: string
  criadoEm: string
  faturadoEm: string | null
  // Condição de pagamento da venda: escolhida no pedido ou ao faturar.
  formaPagamento: string | null
  parcelas: number
  primeiroVencimento: string | null
  // Parcelas escolhidas à mão (data e valor); null = mensais de valor igual.
  vencimentos: { vencimento: string; valor: number }[] | null
  enderecoEntrega: EnderecoEntrega | null
  // Só no detalhe do pedido: o que aconteceu com ele, do mais recente para o mais antigo.
  historico?: HistoricoPedido[]
  itens: { id: number; produtoId: number; unidade: string | null; quantidade: number; precoUnitario: number; desconto: number; produto: ProdutoRef }[]
  contasReceber?: Conta[]
}

export type StatusConta = 'ABERTA' | 'PAGA' | 'CANCELADA'

export type Conta = {
  id: number
  pessoa: PessoaRef | null
  descricao: string
  valor: number
  valorPago: number // soma das baixas; o saldo é valor - valorPago
  vencimento: string
  status: StatusConta
  pagoEm: string | null
  pedidoId?: number | null
  // Só nas contas a receber: a venda de origem, com as pessoas dela.
  pedido?: { id: number; numero: number; vendedor: PessoaRef | null; medico: PessoaRef | null; paciente: PessoaRef | null } | null
}

// Item de uma venda com o que ainda pode ser devolvido e o valor líquido de cada unidade.
export type SaldoDevolucao = {
  pedidoItemId: number
  produto: { sku: string; nome: string; unidade: string }
  unidade: string
  quantidade: number
  devolvido: number
  disponivel: number
  valorUnitario: number
}

export type Devolucao = {
  id: number
  pedido: { id: number; numero: number; cliente: PessoaRef }
  observacao: string | null
  valorCredito: number
  criadoEm: string
  usuario: PessoaRef | null
  estornada: boolean
  estornadaEm: string | null
  credito: { id: number; saldo: number; valorOriginal: number; status: string } | null
  itens: { id: number; quantidade: number; valorUnitario: number; pedidoItem: { unidade: string | null; produto: { sku: string; nome: string; unidade: string } } }[]
}

export type Credito = {
  id: number
  pessoa: PessoaRef
  origem: 'DEVOLUCAO' | 'DEPOSITO' | 'AVULSO'
  descricao: string | null
  devolucao: { id: number; pedido: { id: number; numero: number } } | null
  valorOriginal: number
  saldo: number
  status: 'DISPONIVEL' | 'ESGOTADO' | 'CANCELADO'
  criadoEm: string
  // Quem pode usar o crédito: cliente, médico, vendedor e paciente da venda de origem.
  elegiveis: PessoaRef[]
  usos: { id: number; valor: number; criadoEm: string; estornado: boolean; pessoa: PessoaRef; contaReceber: { id: number; descricao: string } }[]
}

export type TransacaoOfx = { fitId: string; data: string; tipo: 'ENTRADA' | 'SAIDA'; valor: number; descricao: string; duplicada: boolean }

export type ArquivoOfx = { banco: string | null; agencia: string | null; conta: string | null; contaFinanceiraSugeridaId: number | null; transacoes: TransacaoOfx[] }

// O que o sistema propõe para uma linha do extrato, com a pontuação de 0 a 100.
export type SugestaoConciliacao = {
  acao: 'BAIXA' | 'VINCULO' | 'CREDITO'
  tipo: 'CONTA_RECEBER' | 'CONTA_PAGAR' | null
  contaId: number | null
  movimentoId: number | null
  descricao: string
  pessoa: string | null
  vencimento: string | null
  saldo: number | null
  pontuacao: number
}

export type LinhaExtrato = {
  id: number
  contaFinanceira: PessoaRef
  fitId: string
  data: string
  tipo: 'ENTRADA' | 'SAIDA'
  valor: number
  descricao: string
  arquivo: string | null
  status: 'PENDENTE' | 'CONCILIADA' | 'IGNORADA'
  resolucao: 'BAIXA' | 'VINCULO' | 'AVULSO' | 'CREDITO' | 'TRANSFERENCIA' | null
  observacao: string | null
  conciliadoEm: string | null
  usuario?: PessoaRef | null
  sugestoes?: SugestaoConciliacao[]
  movimentos?: { id: number; origem: string; historico: string; valor: number }[]
}

export type Despesa = {
  id: number
  fornecedor: PessoaRef
  elemento: string
  descricao: string
  numeroDocumento: string | null
  dataEmissao: string
  dataCompetencia: string
  valor: number
  condicaoPagamento: 'A_VISTA' | 'A_PRAZO'
  formaPagamento: string
  observacao: string | null
  status: 'ATIVA' | 'CANCELADA'
  usuario: PessoaRef | null
  valorPago: number
  dataCaixa: string | null // quando a despesa ficou quitada
  contasPagar: { id: number; valor: number; valorPago: number; vencimento: string; status: StatusConta }[]
}

export type ListaDespesas = { linhas: Despesa[]; resumo: { quantidade: number; total: number; pago: number } }

export type TipoContaFinanceira = 'CAIXA' | 'CONTA_CORRENTE' | 'CONTA_POUPANCA' | 'CARTEIRA_DIGITAL'

export type ContaFinanceira = {
  id: number
  nome: string
  tipo: TipoContaFinanceira
  instituicao: string | null
  codigoBanco: string | null
  agencia: string | null
  numeroConta: string | null
  documentoTitular: string | null
  saldoInicial: number
  ativa: boolean
  saldo: number // saldo inicial + entradas - saídas
}

export type MovimentoFinanceiro = {
  id: number
  contaFinanceira: PessoaRef
  tipo: 'ENTRADA' | 'SAIDA'
  valor: number
  data: string
  // CREDITO só aparece no histórico da conta a receber; DEPOSITO nasce na conciliação.
  origem: 'RECEBIMENTO' | 'PAGAMENTO' | 'ESTORNO' | 'CREDITO' | 'AVULSO' | 'DEPOSITO' | 'TRANSFERENCIA'
  comHora: boolean // a data tem a hora informada
  transferencia?: string | null // código comum às duas pontas de uma transferência
  extratoId?: number | null // linha do extrato do banco com que foi conciliado
  historico: string
  observacao: string | null
  estornado: boolean
  usuario: PessoaRef | null
}

export type Extrato = {
  linhas: MovimentoFinanceiro[]
  resumo: { saldoInicial: number; entradas: number; saidas: number; saldoFinal: number }
}

export type StatusEntrega = 'PENDENTE' | 'EM_ROTA' | 'ENTREGUE' | 'FALHOU' | 'CANCELADA'

export type Endereco = {
  cep: string | null
  logradouro: string
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string
  uf: string | null
}

export type Entrega = Endereco & {
  id: number
  pedidoId: number
  pedido: { id: number; numero: number; total: number; cliente: PessoaRef }
  entregador: PessoaRef | null
  status: StatusEntrega
  dataPrevista: string
  destinatario: string
  telefone: string | null
  observacao: string | null
  saiuEm: string | null
  concluidaEm: string | null
  recebedor: string | null
  motivoFalha: string | null
  // Dados para a rota; a janela de recebimento vem como "HH:MM".
  pesoKg: number | null
  latitude: number | null
  longitude: number | null
  inicioRecebimento: string | null
  fimRecebimento: string | null
  rota: PessoaRef | null
  sequencia: number | null
}

export type Motorista = { id: number; nome: string; telefone: string | null; cnh: string | null; validadeCnh: string | null; ativo: boolean }

export type Veiculo = { id: number; placa: string; descricao: string | null; capacidadeKg: number; ativo: boolean }

export type ParadaRota = {
  id: number
  pedidoId: number
  pedido: { numero: number }
  sequencia: number | null
  status: StatusEntrega
  destinatario: string
  logradouro: string
  numero: string | null
  bairro: string | null
  cidade: string
  uf: string | null
  pesoKg: number | null
  latitude: number | null
  longitude: number | null
  inicioRecebimento: string | null
  fimRecebimento: string | null
}

export type Rota = {
  id: number
  nome: string
  data: string
  motorista: PessoaRef
  veiculo: { id: number; placa: string; descricao: string | null; capacidadeKg: number }
  pontoSaida: string
  latitudeSaida: number | null
  longitudeSaida: number | null
  // A chave do link só aparece quando ele é gerado; aqui só se sabe se está valendo e até quando.
  linkAtivo: boolean
  linkExpiraEm: string | null
  // Quando o entregador abriu o link atual pela primeira vez, o último acesso e quantos foram.
  linkAbertoEm: string | null
  linkUltimoAcesso: string | null
  linkAcessos: number
  cargaKg: number
  entregas: ParadaRota[]
}

export type HistoricoEntrega = {
  id: number
  status: string
  observacao: string | null
  origem: 'SISTEMA' | 'ENTREGADOR'
  usuario: PessoaRef | null
  criadoEm: string
}

// O que o entregador vê pelo link da rota.
export type RotaDoEntregador = {
  id: number
  nome: string
  data: string
  pontoSaida: string
  expiraEm: string
  entregas: {
    id: number
    pedidoId: number
    pedidoNumero: number
    status: StatusEntrega
    destinatario: string
    telefone: string | null
    endereco: string
    inicioRecebimento: string | null
    fimRecebimento: string | null
    observacaoEntrega: string | null
    observacaoVenda: string | null
    recebedor: string | null
    motivoFalha: string | null
    valorPedido: number
    pagamento: string | null
    itens: { quantidade: number; unidade: string; produto: string }[]
    documentos: { id: number; nome: string; criadoEm: string }[] // comprovantes enviados pelo entregador
  }[]
}

export type RelatorioVendas = {
  linhas: {
    id: number
    numero: number
    criadoEm: string
    // Data da venda (a do filtro de período).
    data: string
    pagoEm: string | null
    cliente: string
    natureza: NaturezaPedido
    vendedor: string | null
    medico: string | null
    paciente: string | null
    status: StatusPedido
    formaPagamento: string | null
    frete: number
    observacao: string | null
    total: number
    devolvido: number
  }[]
  resumo: { quantidade: number; cancelados: number; total: number; ticketMedio: number; devolvido: number }
}

// Contas a receber em aberto para cobrar, com o contato do cliente e os dias de atraso.
export type RelatorioCobranca = {
  linhas: {
    id: number
    pessoaId: number | null
    cliente: string
    telefone: string | null
    email: string | null
    descricao: string
    pedidoId: number | null
    pedidoNumero: number | null
    vendedor: string | null
    medico: string | null
    paciente: string | null
    vencimento: string
    diasAtraso: number
    valor: number
    valorPago: number
    saldo: number
  }[]
  porCliente: { cliente: string; telefone: string | null; quantidade: number; saldo: number; vencido: number; maiorAtraso: number }[]
  resumo: { quantidade: number; clientes: number; saldo: number; vencido: number; aVencer: number }
}

type GrupoDespesas ={ nome: string; quantidade: number; total: number; pago: number }

export type RelatorioDespesas = {
  linhas: {
    id: number
    competencia: string
    emissao: string
    elemento: string
    descricao: string
    fornecedor: string
    numeroDocumento: string | null
    condicaoPagamento: 'A_VISTA' | 'A_PRAZO'
    formaPagamento: string
    valor: number
    pago: number
  }[]
  porElemento: GrupoDespesas[]
  porCompetencia: GrupoDespesas[] // nome = "AAAA-MM"
  resumo: { quantidade: number; total: number; pago: number; aPagar: number }
}

export type RelatorioFinanceiro = {
  linhas: {
    chave: string
    tipo: 'RECEBER' | 'PAGAR'
    descricao: string
    pessoa: string | null
    vencimento: string
    pagoEm: string | null
    status: StatusConta
    valor: number
    valorPago: number
  }[]
  resumo: { quantidade: number; recebido: number; aReceber: number; pago: number; aPagar: number }
}

export type Modalidade = 'PERCENTUAL' | 'PRECO' | 'LEVE_PAGUE' | 'COMBO' | 'BRINDE'

export type ItemPromocao = { produtoId: number; quantidade: number; papel: 'COMPRA' | 'BRINDE' }

export type Promocao = {
  id: number
  nome: string
  modalidade: Modalidade
  inicio: string
  fim: string
  percentual: number | null
  preco: number | null
  leve: number | null
  pague: number | null
  ativo: boolean
  vigente: boolean
  itens: (ItemPromocao & { id: number; produto: { id: number; sku: string; nome: string } })[]
}

export type ItemRanking ={ nome: string; total: number }

// Período dos dashboards: um mês ("2026-10"), um ano ("2026") ou todo o período ("tudo").
export type PeriodoDashboard = { tipo: 'mes' | 'ano' | 'tudo'; chave: string }

export type DashboardComercial = {
  periodo: PeriodoDashboard
  kpis: {
    faturamento: number // vendas menos devoluções
    vendasBrutas: number
    devolucoes: number
    vendas: number
    ticketMedio: number
    descontos: number
    frete: number
    custo: number
    margem: number
    margemPercentual: number
  }
  // Detalhe dentro do período (dias do mês, meses do ano, anos) e evolução dos períodos anteriores.
  // `chave`: dia ("1"), mês ("2026-10") ou ano ("2026").
  detalhe: { chave: string; total: number; vendas: number }[]
  historico: { chave: string; total: number; vendas: number; devolvido: number }[]
  topVendedores: ItemRanking[]
  topClientes: ItemRanking[]
  topProdutos: ItemRanking[]
}

export type DashboardFinanceiro = {
  periodo: PeriodoDashboard
  kpis: {
    recebido: number
    pago: number
    saldo: number
    aReceber: number
    aPagar: number
    vencidoReceber: number
    vencidoPagar: number
    despesas: number // pela competência
  }
  historico: { chave: string; recebido: number; pago: number; despesas: number }[]
  formas: ItemRanking[]
  despesasPorElemento: ItemRanking[]
}

export type PedidoParaEntrega = { id: number; numero: number; total: number; faturadoEm: string | null; cliente: Pessoa; enderecoEntrega: EnderecoEntrega | null }

export type HistoricoPedido = {
  id: number
  tipo: 'CRIADO' | 'ALTERADO' | 'FATURADO' | 'ALTERADO_FATURADO' | 'CANCELADO'
  descricao: string
  motivo: string | null
  totalAnterior: number | null
  totalNovo: number | null
  criadoEm: string
  usuario: { id: number; nome: string } | null
}

// Resumo da alteração de um pedido faturado, antes de gravar.
export type PreviaAlteracao = { totalAnterior: number; totalNovo: number; mudancas: string[]; refaz: boolean }

// Endereço de entrega diferente do cadastro do cliente, escolhido no pedido.
export type EnderecoEntrega = {
  cep: string | null
  logradouro: string
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string
  uf: string | null
  referencia: string | null
}

export type Resumo = {
  entregas: { pendentes: number; emRota: number; falhas: number }
  // Links públicos: rotas abertas pelo entregador (24 h) e cadastros atualizados pelo cliente (7 dias).
  avisos: {
    linksAbertos: { id: number; nome: string; linkAbertoEm: string }[]
    cadastrosAtualizados: { id: number; nome: string; cadastroAtualizadoEm: string }[]
  }
  vendas: { quantidade: number; total: number; pedidosAbertos: number }
  receber: { total: number; vencidas: number }
  pagar: { total: number; vencidas: number }
  saldoProjetado: number
  estoque: {
    valor: number
    semEstoque: number
    criticos: { id: number; sku: string; nome: string; saldo: number; estoqueMinimo: number }[]
  }
  ultimosPedidos: { id: number; numero: number; cliente: string; status: StatusPedido; total: number; criadoEm: string }[]
}

// Linha de item em edição, usada em pedidos e entradas.
// Quantidade e valor são na unidade escolhida para o lançamento.
// `desconto` é por unidade do lançamento e só existe nos itens de pedido.
export type ItemEdicao = { produtoId: number; unidade: string; quantidade: number; valor: number; desconto?: number }
