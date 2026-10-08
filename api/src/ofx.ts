import { createHash } from 'node:crypto'
import { AppError } from './lib.js'

export type TransacaoOfx = { fitId: string; data: Date; tipo: 'ENTRADA' | 'SAIDA'; valor: number; descricao: string }
export type ExtratoOfx = { banco: string | null; agencia: string | null; conta: string | null; transacoes: TransacaoOfx[] }

// Os bancos brasileiros costumam gerar o OFX em Windows-1252; os mais novos, em UTF-8.
function decodificar(bytes: Buffer) {
  const cabecalho = bytes.subarray(0, 600).toString('latin1')
  const declaraUtf8 = /UTF-?8/i.test(cabecalho)
  const declaraLatino = /CHARSET:\s*(1252|ISO-8859)|ENCODING:\s*USASCII/i.test(cabecalho)
  const utf8 = bytes.toString('utf8')
  if (declaraUtf8 || (!declaraLatino && !utf8.includes('�'))) return utf8
  return bytes.toString('latin1')
}

// Valor de uma marcação. Serve para o OFX antigo (SGML, sem fechamento) e para o novo (XML).
const marca = (bloco: string, nome: string) => bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'))?.[1].trim() || null

// Lê um arquivo OFX de extrato de conta ou de cartão. Valores voltam em centavos, sempre positivos.
export function lerOfx(bytes: Buffer): ExtratoOfx {
  const texto = decodificar(bytes)
  if (!/<OFX>/i.test(texto)) throw new AppError(400, 'O arquivo não parece ser um extrato OFX.')

  const blocos = texto.split(/<STMTTRN>/i).slice(1)
  const transacoes: TransacaoOfx[] = []
  for (const [indice, bruto] of blocos.entries()) {
    const bloco = bruto.split(/<\/STMTTRN>/i)[0]
    const dia = marca(bloco, 'DTPOSTED')?.match(/^(\d{4})(\d{2})(\d{2})/)
    // O valor vem com ponto decimal; alguns bancos usam vírgula, com ponto de milhar.
    const escrito = marca(bloco, 'TRNAMT') ?? ''
    const quantia = Number(escrito.includes(',') ? escrito.replace(/\./g, '').replace(',', '.') : escrito)
    if (!dia || !Number.isFinite(quantia) || quantia === 0) continue
    const valor = Math.round(Math.abs(quantia) * 100)
    const descricao = ([marca(bloco, 'MEMO'), marca(bloco, 'NAME')].filter(Boolean).join(' · ') || 'Sem descrição').replace(/\s+/g, ' ').slice(0, 200)
    // Sem identificador do banco, a linha é reconhecida pelo próprio conteúdo e pela posição no arquivo.
    const fitId = marca(bloco, 'FITID') ?? createHash('sha1').update(`${dia[0]}|${quantia}|${descricao}|${indice}`).digest('hex')
    transacoes.push({ fitId, data: new Date(`${dia[1]}-${dia[2]}-${dia[3]}T12:00:00`), tipo: quantia > 0 ? 'ENTRADA' : 'SAIDA', valor, descricao })
  }
  if (transacoes.length === 0) throw new AppError(400, 'Nenhuma transação foi encontrada no arquivo OFX.')

  return { banco: marca(texto, 'BANKID'), agencia: marca(texto, 'BRANCHID'), conta: marca(texto, 'ACCTID'), transacoes }
}
