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

// Aceita "1.234,56", "1234,56" ou "1234"; ponto é separador de milhar. Negativo só com `negativo`.
export function paraCentavos(texto: string, negativo = false) {
  const numero = Number(texto.replace(/[^\d,-]/g, '').replace(',', '.'))
  if (!Number.isFinite(numero)) return 0
  const centavos = Math.round(numero * 100)
  return negativo ? centavos : Math.max(0, centavos)
}

// Data e hora para mostrar; a hora só quando foi informada.
export const dataHoraBr = (iso: string, comHora: boolean) =>
  comHora ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : new Date(iso).toLocaleDateString('pt-BR')

// Agora, no formato do campo de data e hora do navegador ("2026-10-08T14:30").
export function agoraLocal() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
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
  TRANSFERENCIA: 'Transferência entre contas',
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

// CPF/CNPJ, telefone e CEP: a API guarda só os dígitos. As máscaras de digitação formatam aos poucos,
// conforme os dígitos chegam; as de exibição só formatam quando o número está completo e mostram o
// resto como veio, para um dado fora do padrão não aparecer cortado.
const digitosDe = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

function aplicar(digitos: string, padrao: string) {
  let saida = ''
  let i = 0
  for (const c of padrao) {
    if (i >= digitos.length) break
    saida += c === '#' ? digitos[i++] : c
  }
  return saida
}

export const mascaraDocumento = (v: string) => {
  const d = digitosDe(v).slice(0, 14)
  return aplicar(d, d.length <= 11 ? '###.###.###-##' : '##.###.###/####-##')
}
export const mascaraTelefone = (v: string) => {
  const d = digitosDe(v).slice(0, 11)
  return aplicar(d, d.length <= 10 ? '(##) ####-####' : '(##) #####-####')
}
export const mascaraCep = (v: string) => aplicar(digitosDe(v).slice(0, 8), '#####-###')

export const documentoBr = (v: string | null | undefined) => {
  const d = digitosDe(v)
  return d.length === 11 || d.length === 14 ? mascaraDocumento(d) : v || null
}
export const telefoneBr = (v: string | null | undefined) => {
  const d = digitosDe(v)
  return d.length === 10 || d.length === 11 ? mascaraTelefone(d) : v || null
}
export const cepBr = (v: string | null | undefined) => (digitosDe(v).length === 8 ? mascaraCep(v!) : v || null)

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

// Máscara de digitação pelo nome do campo, como os formulários e a API chamam cada um. Sem máscara, o texto passa como está.
const MASCARAS: Record<string, (v: string) => string> = {
  documento: mascaraDocumento,
  documentoTitular: mascaraDocumento,
  telefone: mascaraTelefone,
  celular: mascaraTelefone,
  cep: mascaraCep,
}
export const mascarar = (campo: string, valor: string) => (MASCARAS[campo] ? MASCARAS[campo](valor) : valor)
