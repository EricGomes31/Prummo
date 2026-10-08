import { useMemo, useState, type ReactNode } from 'react'
import { useDados } from '../api'
import { brl, centavosParaTexto, dataBr, formasPagamento, hojeIso, naturezasPedido } from '../format'
import type { RelatorioFinanceiro, RelatorioVendas } from '../types'
import { Cabecalho, Campo, EstadoLista, Selo } from '../ui'

// Uma coluna sabe o valor usado para ordenar e exportar e, se preciso, como se mostrar na tela.
type Coluna<L> = {
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
function exportarCsv<L>(nome: string, colunas: Coluna<L>[], linhas: L[]) {
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

function Tabela<L>(props: { colunas: Coluna<L>[]; linhas: L[]; chave: (linha: L) => string | number }) {
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

type LinhaVenda = RelatorioVendas['linhas'][number]
const colunasVendas: Coluna<LinhaVenda>[] = [
  { rotulo: 'Pedido', valor: (l) => l.id, exibir: (l) => `#${l.id}` },
  { rotulo: 'Lançamento', valor: (l) => l.criadoEm, tipo: 'data' },
  { rotulo: 'Pagamento', valor: (l) => l.pagoEm, tipo: 'data' },
  { rotulo: 'Natureza', valor: (l) => naturezasPedido[l.natureza] ?? l.natureza },
  { rotulo: 'Cliente', valor: (l) => l.cliente, largura: 170 },
  { rotulo: 'Vendedor', valor: (l) => l.vendedor },
  { rotulo: 'Médico', valor: (l) => l.medico },
  { rotulo: 'Paciente', valor: (l) => l.paciente },
  { rotulo: 'Situação', valor: (l) => l.status, exibir: (l) => <Selo valor={l.status} /> },
  { rotulo: 'Forma de pagamento', valor: (l) => (l.formaPagamento ? (formasPagamento[l.formaPagamento] ?? l.formaPagamento) : null) },
  { rotulo: 'Frete', valor: (l) => l.frete, tipo: 'dinheiro' },
  { rotulo: 'Observação', valor: (l) => l.observacao, largura: 180 },
  { rotulo: 'Valor', valor: (l) => l.total, tipo: 'dinheiro' },
]

type LinhaFinanceira = RelatorioFinanceiro['linhas'][number]
const colunasFinanceiro: Coluna<LinhaFinanceira>[] = [
  { rotulo: 'Tipo', valor: (l) => (l.tipo === 'RECEBER' ? 'A receber' : 'A pagar') },
  { rotulo: 'Vencimento', valor: (l) => l.vencimento, tipo: 'data' },
  { rotulo: 'Liquidação', valor: (l) => l.pagoEm, tipo: 'data' },
  { rotulo: 'Descrição', valor: (l) => l.descricao },
  { rotulo: 'Cliente ou fornecedor', valor: (l) => l.pessoa },
  { rotulo: 'Situação', valor: (l) => l.status, exibir: (l) => <Selo valor={l.status} /> },
  { rotulo: 'Valor', valor: (l) => l.valor, tipo: 'dinheiro' },
  { rotulo: 'Baixado', valor: (l) => l.valorPago, tipo: 'dinheiro' },
  { rotulo: 'Saldo', valor: (l) => (l.status === 'CANCELADA' ? 0 : l.valor - l.valorPago), tipo: 'dinheiro' },
]

const situacoes = {
  vendas: [['ABERTO', 'Em aberto'], ['FATURADO', 'Faturados'], ['CANCELADO', 'Cancelados']],
  financeiro: [['ABERTA', 'Em aberto'], ['PAGA', 'Liquidadas'], ['CANCELADA', 'Canceladas']],
} as const
type Aba = keyof typeof situacoes

export function Relatorios() {
  const [aba, setAba] = useState<Aba>('vendas')
  const [f, setF] = useState({ inicio: '', fim: '', status: '', tipo: '', natureza: '', busca: '' })
  const consulta = new URLSearchParams(
    Object.entries(f).filter(
      ([chave, valor]) => valor && (chave !== 'tipo' || aba === 'financeiro') && (chave !== 'natureza' || aba === 'vendas'),
    ),
  )
  const vendas = useDados<RelatorioVendas>(aba === 'vendas' ? `/relatorios/vendas?${consulta}` : null)
  const financeiro = useDados<RelatorioFinanceiro>(aba === 'financeiro' ? `/relatorios/financeiro?${consulta}` : null)
  const atual = aba === 'vendas' ? vendas : financeiro
  const quantidade = atual.dados?.linhas.length ?? 0

  function trocarAba(nova: Aba) {
    setAba(nova)
    setF({ ...f, status: '', tipo: '', natureza: '' })
  }

  function exportar() {
    if (aba === 'vendas' && vendas.dados) exportarCsv('relatorio-vendas', colunasVendas, vendas.dados.linhas)
    if (aba === 'financeiro' && financeiro.dados) exportarCsv('relatorio-financeiro', colunasFinanceiro, financeiro.dados.linhas)
  }

  return (
    <>
      <Cabecalho titulo="Relatórios" descricao="Analise vendas e lançamentos financeiros e exporte o resultado para o Excel.">
        <button type="button" className="botao" onClick={atual.recarregar} disabled={atual.carregando}>
          Atualizar
        </button>
        <button type="button" className="botao botao-primario" onClick={exportar} disabled={quantidade === 0}>
          Exportar para Excel
        </button>
      </Cabecalho>

      <div className="abas" role="tablist">
        <button type="button" role="tab" aria-selected={aba === 'vendas'} onClick={() => trocarAba('vendas')}>
          Vendas
        </button>
        <button type="button" role="tab" aria-selected={aba === 'financeiro'} onClick={() => trocarAba('financeiro')}>
          Financeiro
        </button>
      </div>

      <section className="painel filtros-relatorio">
        <Campo rotulo={aba === 'vendas' ? 'Lançado a partir de' : 'Vencimento a partir de'}>
          <input type="date" value={f.inicio} max={f.fim || undefined} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Até">
          <input type="date" value={f.fim} min={f.inicio || undefined} onChange={(e) => setF({ ...f, fim: e.target.value })} />
        </Campo>
        <Campo rotulo="Situação">
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Todas</option>
            {situacoes[aba].map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </Campo>
        {aba === 'vendas' && (
          <Campo rotulo="Natureza">
            <select value={f.natureza} onChange={(e) => setF({ ...f, natureza: e.target.value })}>
              <option value="">Todas</option>
              {Object.entries(naturezasPedido).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </Campo>
        )}
        {aba === 'financeiro' && (
          <Campo rotulo="Tipo">
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="">A receber e a pagar</option>
              <option value="RECEBER">A receber</option>
              <option value="PAGAR">A pagar</option>
            </select>
          </Campo>
        )}
        <Campo rotulo="Pesquisar">
          <input
            type="search"
            value={f.busca}
            onChange={(e) => setF({ ...f, busca: e.target.value })}
            placeholder={aba === 'vendas' ? 'Pedido, cliente, vendedor, médico, paciente ou observação' : 'Descrição, cliente ou fornecedor'}
          />
        </Campo>
      </section>

      {vendas.dados && aba === 'vendas' && (
        <section className="indicadores">
          <Resumo rotulo="Pedidos encontrados" valor={String(vendas.dados.resumo.quantidade)}
            nota={vendas.dados.resumo.cancelados ? `${vendas.dados.resumo.cancelados} cancelado(s), fora dos valores` : undefined} />
          <Resumo rotulo="Valor total" valor={brl(vendas.dados.resumo.total)} />
          <Resumo rotulo="Ticket médio" valor={brl(vendas.dados.resumo.ticketMedio)} />
        </section>
      )}
      {financeiro.dados && aba === 'financeiro' && (
        <section className="indicadores">
          <Resumo rotulo="Recebido" valor={brl(financeiro.dados.resumo.recebido)} />
          <Resumo rotulo="A receber" valor={brl(financeiro.dados.resumo.aReceber)} />
          <Resumo rotulo="Pago" valor={brl(financeiro.dados.resumo.pago)} />
          <Resumo rotulo="A pagar" valor={brl(financeiro.dados.resumo.aPagar)} />
        </section>
      )}

      <section className="painel">
        <EstadoLista carregando={atual.carregando} erro={atual.erro} vazia={quantidade === 0} textoVazio="Nenhum resultado para estes filtros." />
        {aba === 'vendas' && vendas.dados && quantidade > 0 && (
          <Tabela colunas={colunasVendas} linhas={vendas.dados.linhas} chave={(l) => l.id} />
        )}
        {aba === 'financeiro' && financeiro.dados && quantidade > 0 && (
          <Tabela colunas={colunasFinanceiro} linhas={financeiro.dados.linhas} chave={(l) => l.chave} />
        )}
      </section>
    </>
  )
}

function Resumo(props: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="indicador">
      <span>{props.rotulo}</span>
      <strong>{props.valor}</strong>
      {props.nota && <small className="texto-suave">{props.nota}</small>}
    </div>
  )
}
