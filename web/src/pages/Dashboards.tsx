import { useState, type ReactNode } from 'react'
import { useDados } from '../api'
import { useSessao } from '../auth'
import { brl, formasPagamento, hojeIso } from '../format'
import { Colunas, Ranking } from '../graficos'
import type { DashboardComercial, DashboardFinanceiro } from '../types'
import { Cabecalho, EstadoLista } from '../ui'

// Cores dos gráficos: par validado para daltonismo e contraste sobre fundo branco.
const COR = { principal: '#5b3df5', secundaria: '#eb6834', apagada: '#c9c7d1' }

const dataDoMes = (mes: string) => new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 1, 1)
const mesPorExtenso = (mes: string) => dataDoMes(mes).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const mesCurto = (mes: string) =>
  dataDoMes(mes).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace(' de ', '/')

function mesVizinho(mes: string, passo: number) {
  const d = dataDoMes(mes)
  d.setMonth(d.getMonth() + passo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function Dashboards() {
  const mesAtual = hojeIso().slice(0, 7)
  // Só aparecem os dashboards liberados no perfil de acesso do usuário.
  const liberados = useSessao().usuario?.dashboards ?? []
  const temComercial = liberados.includes('COMERCIAL')
  const temFinanceiro = liberados.includes('FINANCEIRO')
  const [aba, setAba] = useState<'comercial' | 'financeiro'>(temComercial ? 'comercial' : 'financeiro')
  const [mes, setMes] = useState(mesAtual)
  const comercial = useDados<DashboardComercial>(aba === 'comercial' ? `/dashboards/comercial?mes=${mes}` : null)
  const financeiro = useDados<DashboardFinanceiro>(aba === 'financeiro' ? `/dashboards/financeiro?mes=${mes}` : null)
  const atual = aba === 'comercial' ? comercial : financeiro

  return (
    <>
      <Cabecalho titulo="Dashboards" descricao={`Indicadores gerenciais de ${mesPorExtenso(mes)}.`}>
        <button type="button" className="botao" onClick={() => setMes(mesVizinho(mes, -1))} aria-label="Mês anterior">
          ‹
        </button>
        <input type="month" className="filtro-mes" value={mes} max={mesAtual} aria-label="Mês"
          onChange={(e) => e.target.value && setMes(e.target.value)} />
        <button type="button" className="botao" onClick={() => setMes(mesVizinho(mes, 1))} disabled={mes >= mesAtual} aria-label="Próximo mês">
          ›
        </button>
      </Cabecalho>

      <div className="abas" role="tablist">
        {temComercial && (
          <button type="button" role="tab" aria-selected={aba === 'comercial'} onClick={() => setAba('comercial')}>
            Comercial
          </button>
        )}
        {temFinanceiro && (
          <button type="button" role="tab" aria-selected={aba === 'financeiro'} onClick={() => setAba('financeiro')}>
            Financeiro
          </button>
        )}
      </div>

      <EstadoLista carregando={atual.carregando} erro={atual.erro} vazia={!atual.dados} textoVazio="" />
      {aba === 'comercial' && comercial.dados && <Comercial d={comercial.dados} />}
      {aba === 'financeiro' && financeiro.dados && <Financeiro d={financeiro.dados} />}
    </>
  )
}

function Comercial({ d }: { d: DashboardComercial }) {
  const nomeMes = mesPorExtenso(d.mes)
  return (
    <>
      <section className="indicadores em-3">
        <Indicador rotulo="Faturamento" valor={brl(d.kpis.faturamento)} nota={d.kpis.frete > 0 ? `inclui ${brl(d.kpis.frete)} de frete` : undefined} />
        <Indicador rotulo="Vendas" valor={String(d.kpis.vendas)} nota="pedidos faturados" />
        <Indicador rotulo="Ticket médio" valor={brl(d.kpis.ticketMedio)} />
        <Indicador rotulo="Descontos" valor={brl(d.kpis.descontos)} />
        <Indicador rotulo="Custo das vendas" valor={brl(d.kpis.custo)} nota="custo na data do faturamento" />
        <Indicador rotulo="Margem bruta" valor={brl(d.kpis.margem)} tom={d.kpis.margem < 0 ? 'ruim' : 'bom'}
          nota={`${d.kpis.margemPercentual.toLocaleString('pt-BR')}% das vendas, sem frete`} />
      </section>

      <Cartao titulo={`Vendas por dia · ${nomeMes}`}>
        <Colunas
          series={[{ nome: 'Vendas', cor: COR.principal }]}
          mostrarRotulo={(i) => i === 0 || (i + 1) % 5 === 0}
          pontos={d.dias.map((dia) => ({
            rotulo: String(dia.dia),
            titulo: `Dia ${dia.dia}`,
            valores: [dia.total],
            nota: `${dia.vendas} venda(s)`,
          }))}
        />
        <TabelaDados
          colunas={['Dia', 'Vendas', 'Valor']}
          linhas={d.dias.filter((dia) => dia.vendas > 0).map((dia) => [String(dia.dia).padStart(2, '0'), String(dia.vendas), brl(dia.total)])}
        />
      </Cartao>

      <Cartao titulo="Evolução das vendas · últimos 6 meses">
        <Colunas
          series={[{ nome: 'Vendas', cor: COR.principal }]}
          valorNoTopo
          pontos={d.meses.map((m) => ({
            rotulo: mesCurto(m.mes),
            titulo: mesPorExtenso(m.mes),
            valores: [m.total],
            nota: `${m.vendas} venda(s)`,
            cores: [m.mes === d.mes ? COR.principal : COR.apagada],
          }))}
        />
        <TabelaDados colunas={['Mês', 'Vendas', 'Valor']} linhas={d.meses.map((m) => [mesPorExtenso(m.mes), String(m.vendas), brl(m.total)])} />
      </Cartao>

      <div className="tres-colunas">
        <Cartao titulo="Top vendedores">
          <Ranking itens={d.topVendedores} cor={COR.principal} textoVazio="Sem vendas no mês." />
        </Cartao>
        <Cartao titulo="Top clientes">
          <Ranking itens={d.topClientes} cor={COR.principal} textoVazio="Sem vendas no mês." />
        </Cartao>
        <Cartao titulo="Top produtos">
          <Ranking itens={d.topProdutos} cor={COR.principal} textoVazio="Sem vendas no mês." />
        </Cartao>
      </div>
    </>
  )
}

function Financeiro({ d }: { d: DashboardFinanceiro }) {
  return (
    <>
      <section className="indicadores em-4">
        <Indicador rotulo="Recebido no mês" valor={brl(d.kpis.recebido)} />
        <Indicador rotulo="Pago no mês" valor={brl(d.kpis.pago)} />
        <Indicador rotulo="Saldo do mês" valor={brl(d.kpis.saldo)} tom={d.kpis.saldo < 0 ? 'ruim' : 'bom'} nota="recebido menos pago" />
        <Indicador rotulo="A receber no mês" valor={brl(d.kpis.aReceber)} nota="em aberto, com vencimento no mês" />
        <Indicador rotulo="A pagar no mês" valor={brl(d.kpis.aPagar)} nota="em aberto, com vencimento no mês" />
        <Indicador rotulo="Vencido a receber" valor={brl(d.kpis.vencidoReceber)} tom={d.kpis.vencidoReceber > 0 ? 'ruim' : undefined} nota="até hoje" />
        <Indicador rotulo="Vencido a pagar" valor={brl(d.kpis.vencidoPagar)} tom={d.kpis.vencidoPagar > 0 ? 'ruim' : undefined} nota="até hoje" />
      </section>

      <Cartao titulo="Recebido e pago · últimos 6 meses">
        <Colunas
          series={[
            { nome: 'Recebido', cor: COR.principal },
            { nome: 'Pago', cor: COR.secundaria },
          ]}
          pontos={d.meses.map((m) => ({ rotulo: mesCurto(m.mes), titulo: mesPorExtenso(m.mes), valores: [m.recebido, m.pago] }))}
        />
        <TabelaDados
          colunas={['Mês', 'Recebido', 'Pago', 'Saldo']}
          linhas={d.meses.map((m) => [mesPorExtenso(m.mes), brl(m.recebido), brl(m.pago), brl(m.recebido - m.pago)])}
        />
      </Cartao>

      <Cartao estreito titulo={`Recebido por forma de pagamento · ${mesPorExtenso(d.mes)}`}>
        <Ranking
          itens={d.formas.map((f) => ({ ...f, nome: f.nome === 'OUTROS' ? 'Lançamentos avulsos' : (formasPagamento[f.nome] ?? f.nome) }))}
          cor={COR.principal}
          textoVazio="Nenhum recebimento no mês."
        />
      </Cartao>
    </>
  )
}

function Cartao({ titulo, children, estreito }: { titulo: string; children: ReactNode; estreito?: boolean }) {
  return (
    <section className={`cartao ${estreito ? 'estreito' : ''}`}>
      <h2>{titulo}</h2>
      {children}
    </section>
  )
}

function Indicador(props: { rotulo: string; valor: string; nota?: string; tom?: 'bom' | 'ruim' }) {
  return (
    <div className="indicador">
      <span>{props.rotulo}</span>
      <strong className={props.tom ? `texto-${props.tom}` : ''}>{props.valor}</strong>
      {props.nota && <small className="texto-suave">{props.nota}</small>}
    </div>
  )
}

// Os mesmos números do gráfico em tabela, para quem prefere ou precisa ler os valores.
function TabelaDados({ colunas, linhas }: { colunas: string[]; linhas: string[][] }) {
  return (
    <details className="ver-tabela">
      <summary>Ver em tabela</summary>
      {linhas.length === 0 ? (
        <p className="aviso">Sem movimento no período.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {colunas.map((c, i) => (
                <th key={c} className={i > 0 ? 'num' : ''}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha[0]}>
                {linha.map((celula, i) => (
                  <td key={i} className={i > 0 ? 'num' : ''}>
                    {celula}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  )
}
