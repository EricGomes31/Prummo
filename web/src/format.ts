import type { Produto } from './types'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

// Quantidade com até três casas, sem zeros à direita: 2 · 0,5 · 1,333
export const qtd = (n: number) => Number(n.toFixed(3)).toLocaleString('pt-BR')

// Saldo do produto na unidade base (a API devolve em partes).
export const saldoBase = (p: Pick<Produto, 'saldo' | 'divisor'>) => p.saldo / p.divisor

// Todas as unidades em que o produto pode ser lançado, com o preço de venda e o custo de cada uma.
// A primeira é sempre a unidade base (fator 1).
export function unidadesDe(p: Produto) {
  return [
    { sigla: p.unidade, fator: 1, precoVenda: p.precoVenda, precoCusto: p.precoCusto },
    ...p.unidades.map((u) => ({
      sigla: u.sigla,
      fator: u.fator,
      precoVenda: u.precoVenda ?? Math.round(p.precoVenda / u.fator),
      precoCusto: Math.round(p.precoCusto / u.fator),
    })),
  ]
}

export const brl = (centavos: number) => moeda.format(centavos / 100)

export const centavosParaTexto = (centavos: number) => (centavos / 100).toFixed(2).replace('.', ',')

// Aceita "1.234,56", "1234,56" ou "1234"; ponto é separador de milhar.
export function paraCentavos(texto: string) {
  const numero = Number(texto.replace(/[^\d,-]/g, '').replace(',', '.'))
  return Number.isFinite(numero) ? Math.max(0, Math.round(numero * 100)) : 0
}

export const inteiro = (texto: string) => {
  const n = Math.trunc(Number(texto))
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

// Unidades de medida aceitas no cadastro de produtos.
export const unidades: Record<string, string> = {
  UN: 'Unidade', CX: 'Caixa', FR: 'Frasco', AMP: 'Ampola', PCT: 'Pacote', KIT: 'Kit', PAR: 'Par',
  DZ: 'Dúzia', KG: 'Quilograma', G: 'Grama', L: 'Litro', ML: 'Mililitro', M: 'Metro', SV: 'Serviço',
}

export const formasPagamento: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO_CREDITO: 'Cartão de crédito (maquininha)',
  CARTAO_DEBITO: 'Cartão de débito (maquininha)',
  LINK_CARTAO: 'Cartão por link de pagamento',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
}

export const formasPagamentoDespesa: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  TRANSFERENCIA: 'Transferência',
  BOLETO: 'Boleto',
  CARTAO_DEBITO: 'Cartão de débito',
  CARTAO_CREDITO: 'Cartão de crédito',
  OUTRO: 'Outro',
}

export const tiposContaFinanceira: Record<string, string> = {
  CAIXA: 'Caixa',
  CONTA_CORRENTE: 'Conta corrente',
  CONTA_POUPANCA: 'Conta poupança',
  CARTEIRA_DIGITAL: 'Carteira digital',
}

export const origensMovimento: Record<string, string> = {
  RECEBIMENTO: 'Recebimento',
  PAGAMENTO: 'Pagamento',
  ESTORNO: 'Estorno',
  CREDITO: 'Crédito de devolução',
  AVULSO: 'Lançamento avulso',
  DEPOSITO: 'Depósito a maior',
}

export const naturezasPedido: Record<string, string> = { VENDA: 'Venda', BONIFICACAO: 'Bonificação', PERDA: 'Perda' }

export const motivosPerda: Record<string, string> = {
  AVARIA: 'Avaria',
  VENCIMENTO: 'Vencimento',
  QUEBRA: 'Quebra',
  EXTRAVIO: 'Extravio',
  OUTROS: 'Outros',
}

export const dataBr =(iso: string) => new Date(iso).toLocaleDateString('pt-BR')

export function hojeIso() {
  const d = new Date()
  const dois = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
}

export function estaVencida(conta: { status: string; vencimento: string }) {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return conta.status === 'ABERTA' && new Date(conta.vencimento) < hoje
}
