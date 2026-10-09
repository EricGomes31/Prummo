// Tabela de relatório com ordenação por coluna e exportação para o Excel, usada nos relatórios e nas
// listas que podem ser exportadas.
import { useMemo, useState, type ReactNode } from 'react'
import { brl, centavosParaTexto, dataBr, hojeIso } from './format'

// Uma coluna sabe o valor usado para ordenar e exportar e, se preciso, como se mostrar na tela.
export type Coluna<L> = {
  rotulo: string
  valor: (linha: L) => string | number | null
  tipo?: 'texto' | 'data' | 'dinheiro'
  exibir?: (linha: L) => ReactNode
  // Largura mínima em pixels, para colunas de texto longo não quebrarem em muitas linhas.
  largura?: number
}

function textoCelula<L>(coluna: Coluna<L>, linha: L) {
  const v = coluna.valor(linha)
  if (v === null || v === '') return ''
  if (coluna.tipo === 'dinheiro') return centavosParaTexto(v as number)
  if (coluna.tipo === 'data') return dataBr(v as string)
  return String(v)
}

// CSV com ponto e vírgula e BOM, que o Excel em português abre direto com acentos e números corretos.
export function exportarCsv<L>(nome: string, colunas: Coluna<L>[], linhas: L[]) {
  const celula = (texto: string, livre: boolean) => {
    // Texto digitado por usuários não pode ser interpretado como fórmula pela planilha.
    const seguro = livre && /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto
    return `"${seguro.replace(/"/g, '""')}"`
  }
  const corpo = [
    colunas.map((c) => celula(c.rotulo, false)).join(';'),
    ...linhas.map((l) => colunas.map((c) => celula(textoCelula(c, l), !c.tipo || c.tipo === 'texto')).join(';')),
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿', corpo], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${nome}-${hojeIso()}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

const escapar = (texto: string) => texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// Abre o relatório numa janela própria, pronto para imprimir ou salvar em PDF pelo navegador.
export function imprimir<L>(titulo: string, subtitulo: string, colunas: Coluna<L>[], linhas: L[], totais: [string, string][] = []) {
  const janela = window.open('', '_blank')
  if (!janela) throw new Error('O navegador bloqueou a janela de impressão. Permita janelas deste site e tente de novo.')
  const valor = (c: Coluna<L>, l: L) => (c.tipo === 'dinheiro' ? brl((c.valor(l) as number) ?? 0) : textoCelula(c, l) || '—')
  janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title>
<style>
  body { font: 11px/1.4 system-ui, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 16px; margin: 0 0 2px; } p { margin: 0 0 12px; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; } .num { text-align: right; white-space: nowrap; }
  .totais { margin-top: 12px; display: flex; gap: 24px; justify-content: flex-end; }
  @page { size: A4 landscape; margin: 12mm; }
</style></head><body>
<h1>${escapar(titulo)}</h1><p>${escapar(subtitulo)}</p>
<table><thead><tr>${colunas.map((c) => `<th class="${c.tipo === 'dinheiro' ? 'num' : ''}">${escapar(c.rotulo)}</th>`).join('')}</tr></thead>
<tbody>${linhas.map((l) => `<tr>${colunas.map((c) => `<td class="${c.tipo === 'dinheiro' ? 'num' : ''}">${escapar(valor(c, l))}</td>`).join('')}</tr>`).join('')}</tbody></table>
${totais.length ? `<div class="totais">${totais.map(([r, v]) => `<span>${escapar(r)}: <strong>${escapar(v)}</strong></span>`).join('')}</div>` : ''}
<script>window.onload = () => window.print()</script>
</body></html>`)
  janela.document.close()
}

export function Tabela<L>(props: { colunas: Coluna<L>[]; linhas: L[]; chave: (linha: L) => string | number }) {
  const [ordem, setOrdem] = useState<{ indice: number; crescente: boolean } | null>(null)
  const ordenadas = useMemo(() => {
    if (!ordem) return props.linhas
    const coluna = props.colunas[ordem.indice]
    const sentido = ordem.crescente ? 1 : -1
    return [...props.linhas].sort((a, b) => {
      const va = coluna.valor(a)
      const vb = coluna.valor(b)
      if (va === vb) return 0
      if (va === null || va === '') return 1 // vazios sempre no fim
      if (vb === null || vb === '') return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sentido
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * sentido
    })
  }, [props.linhas, props.colunas, ordem])

  return (
    <table className="tabela-relatorio">
      <thead>
        <tr>
          {props.colunas.map((c, i) => {
            const ativa = ordem?.indice === i
            return (
              <th
                key={c.rotulo}
                className={c.tipo === 'dinheiro' ? 'num' : ''}
                style={c.largura ? { minWidth: c.largura } : undefined}
                aria-sort={ativa ? (ordem.crescente ? 'ascending' : 'descending') : 'none'}
              >
                <button
                  type="button"
                  className="ordenar"
                  onClick={() => setOrdem({ indice: i, crescente: ativa ? !ordem.crescente : true })}
                >
                  {c.rotulo} <span aria-hidden="true">{ativa ? (ordem.crescente ? '↑' : '↓') : '↕'}</span>
                </button>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {ordenadas.map((l) => (
          <tr key={props.chave(l)}>
            {props.colunas.map((c) => (
              <td key={c.rotulo} className={c.tipo === 'dinheiro' ? 'num' : ''}>
                {c.exibir ? c.exibir(l) : c.tipo === 'dinheiro' ? brl(c.valor(l) as number) : textoCelula(c, l) || '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Resumo(props: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="indicador">
      <span>{props.rotulo}</span>
      <strong>{props.valor}</strong>
      {props.nota && <small className="texto-suave">{props.nota}</small>}
    </div>
  )
}
