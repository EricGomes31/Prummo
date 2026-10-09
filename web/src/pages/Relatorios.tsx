import { useState } from 'react'
import { useDados } from '../api'
import { brl, formasPagamento, formasPagamentoDespesa, naturezasPedido } from '../format'
import { exportarCsv, Resumo, Tabela, type Coluna } from '../relatorio'
import type { RelatorioDespesas, RelatorioFinanceiro, RelatorioVendas } from '../types'
import { Cabecalho, Campo, EstadoLista, Selo } from '../ui'

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

type LinhaDespesa = RelatorioDespesas['linhas'][number]
const colunasDespesas: Coluna<LinhaDespesa>[] = [
  { rotulo: 'Nº', valor: (l) => l.id },
  { rotulo: 'Competência', valor: (l) => l.competencia, tipo: 'data' },
  { rotulo: 'Emissão', valor: (l) => l.emissao, tipo: 'data' },
  { rotulo: 'Elemento', valor: (l) => l.elemento },
  { rotulo: 'Descrição', valor: (l) => l.descricao, largura: 180 },
  { rotulo: 'Fornecedor', valor: (l) => l.fornecedor, largura: 150 },
  { rotulo: 'Documento', valor: (l) => l.numeroDocumento },
  { rotulo: 'Condição', valor: (l) => (l.condicaoPagamento === 'A_PRAZO' ? 'A prazo' : 'À vista') },
  { rotulo: 'Forma', valor: (l) => formasPagamentoDespesa[l.formaPagamento] ?? l.formaPagamento },
  { rotulo: 'Valor', valor: (l) => l.valor, tipo: 'dinheiro' },
  { rotulo: 'Pago', valor: (l) => l.pago, tipo: 'dinheiro' },
]

type Grupo = RelatorioDespesas['porElemento'][number]
const colunasGrupo = (rotulo: string, nome: (g: Grupo) => string): Coluna<Grupo>[] => [
  { rotulo, valor: nome },
  { rotulo: 'Despesas', valor: (g) => g.quantidade },
  { rotulo: 'Total', valor: (g) => g.total, tipo: 'dinheiro' },
  { rotulo: 'Pago', valor: (g) => g.pago, tipo: 'dinheiro' },
  { rotulo: 'A pagar', valor: (g) => g.total - g.pago, tipo: 'dinheiro' },
]
const mesPorExtenso = (mes: string) => new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const colunasElemento = colunasGrupo('Elemento', (g) => g.nome)
const colunasCompetencia = colunasGrupo('Competência', (g) => mesPorExtenso(g.nome))

const situacoes = {
  vendas: [['ABERTO', 'Em aberto'], ['FATURADO', 'Faturados'], ['CANCELADO', 'Cancelados']],
  financeiro: [['ABERTA', 'Em aberto'], ['PAGA', 'Liquidadas'], ['CANCELADA', 'Canceladas']],
  despesas: [],
} as const
type Aba = keyof typeof situacoes

const rotuloInicio: Record<Aba, string> = { vendas: 'Lançado a partir de', financeiro: 'Vencimento a partir de', despesas: 'Competência a partir de' }

export function Relatorios() {
  const [aba, setAba] = useState<Aba>('vendas')
  const [f, setF] = useState({ inicio: '', fim: '', status: '', tipo: '', natureza: '', busca: '' })
  const consulta = new URLSearchParams(
    Object.entries(f).filter(
      ([chave, valor]) => valor && (chave !== 'tipo' || aba === 'financeiro') && (chave !== 'natureza' || aba === 'vendas') && (chave !== 'status' || aba !== 'despesas'),
    ),
  )
  const vendas = useDados<RelatorioVendas>(aba === 'vendas' ? `/relatorios/vendas?${consulta}` : null)
  const financeiro = useDados<RelatorioFinanceiro>(aba === 'financeiro' ? `/relatorios/financeiro?${consulta}` : null)
  const despesas = useDados<RelatorioDespesas>(aba === 'despesas' ? `/relatorios/despesas?${consulta}` : null)
  const atual = { vendas, financeiro, despesas }[aba]
  const quantidade = atual.dados?.linhas.length ?? 0

  function trocarAba(nova: Aba) {
    setAba(nova)
    setF({ ...f, status: '', tipo: '', natureza: '' })
  }

  function exportar() {
    if (aba === 'vendas' && vendas.dados) exportarCsv('relatorio-vendas', colunasVendas, vendas.dados.linhas)
    if (aba === 'financeiro' && financeiro.dados) exportarCsv('relatorio-financeiro', colunasFinanceiro, financeiro.dados.linhas)
    if (aba === 'despesas' && despesas.dados) exportarCsv('relatorio-despesas', colunasDespesas, despesas.dados.linhas)
  }

  return (
    <>
      <Cabecalho titulo="Relatórios" descricao="Analise vendas, lançamentos financeiros e despesas e exporte o resultado para o Excel.">
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
        <button type="button" role="tab" aria-selected={aba === 'despesas'} onClick={() => trocarAba('despesas')}>
          Despesas
        </button>
      </div>

      <section className="painel filtros-relatorio">
        <Campo rotulo={rotuloInicio[aba]}>
          <input type="date" value={f.inicio} max={f.fim || undefined} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Até">
          <input type="date" value={f.fim} min={f.inicio || undefined} onChange={(e) => setF({ ...f, fim: e.target.value })} />
        </Campo>
        {aba !== 'despesas' && (
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
        )}
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
            placeholder={
              aba === 'vendas'
                ? 'Pedido, cliente, vendedor, médico, paciente ou observação'
                : aba === 'financeiro'
                  ? 'Descrição, cliente ou fornecedor'
                  : 'Elemento, descrição, documento ou fornecedor'
            }
          />
        </Campo>
      </section>

      {vendas.dados && aba === 'vendas' && (
        <section className="indicadores">
          <Resumo rotulo="Pedidos encontrados" valor={String(vendas.dados.resumo.quantidade)}
            nota={vendas.dados.resumo.cancelados ? `${vendas.dados.resumo.cancelados} cancelado(s), fora dos valores` : undefined} />
          <Resumo rotulo="Valor total" valor={brl(vendas.dados.resumo.total)} />
          <Resumo rotulo="Ticket médio" valor={brl(vendas.dados.resumo.ticketMedio)} />
          {vendas.dados.resumo.devolvido > 0 && (
            <Resumo rotulo="Devolvido" valor={brl(vendas.dados.resumo.devolvido)} nota={`líquido ${brl(vendas.dados.resumo.total - vendas.dados.resumo.devolvido)}`} />
          )}
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
      {despesas.dados && aba === 'despesas' && (
        <section className="indicadores">
          <Resumo rotulo="Despesas" valor={String(despesas.dados.resumo.quantidade)} />
          <Resumo rotulo="Total" valor={brl(despesas.dados.resumo.total)} />
          <Resumo rotulo="Pago" valor={brl(despesas.dados.resumo.pago)} />
          <Resumo rotulo="A pagar" valor={brl(despesas.dados.resumo.aPagar)} />
        </section>
      )}

      {aba === 'despesas' && despesas.dados && quantidade > 0 && (
        <div className="duas-colunas" style={{ marginBottom: 18 }}>
          <section className="painel">
            <div className="painel-topo">
              <h2>Por elemento</h2>
            </div>
            <Tabela colunas={colunasElemento} linhas={despesas.dados.porElemento} chave={(g) => g.nome} />
          </section>
          <section className="painel">
            <div className="painel-topo">
              <h2>Por competência</h2>
            </div>
            <Tabela colunas={colunasCompetencia} linhas={despesas.dados.porCompetencia} chave={(g) => g.nome} />
          </section>
        </div>
      )}

      <section className="painel">
        <EstadoLista carregando={atual.carregando} erro={atual.erro} vazia={quantidade === 0} textoVazio="Nenhum resultado para estes filtros." />
        {aba === 'vendas' && vendas.dados && quantidade > 0 && (
          <Tabela colunas={colunasVendas} linhas={vendas.dados.linhas} chave={(l) => l.id} />
        )}
        {aba === 'financeiro' && financeiro.dados && quantidade > 0 && (
          <Tabela colunas={colunasFinanceiro} linhas={financeiro.dados.linhas} chave={(l) => l.chave} />
        )}
        {aba === 'despesas' && despesas.dados && quantidade > 0 && (
          <Tabela colunas={colunasDespesas} linhas={despesas.dados.linhas} chave={(l) => l.id} />
        )}
      </section>
    </>
  )
}
