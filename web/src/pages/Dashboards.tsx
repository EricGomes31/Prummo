import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDados } from '../api'
import { useSessao } from '../auth'
import { brl, formasPagamento, hojeIso } from '../format'
import { Colunas, Ranking } from '../graficos'
import type { DashboardComercial, DashboardFinanceiro, PeriodoDashboard, VendaDoGrafico } from '../types'
import { Cabecalho, EstadoLista, Modal } from '../ui'
import { CampoData } from '../calendario'
import { Icone } from '../icones'

// Cores dos gráficos: par validado para daltonismo e contraste sobre fundo branco.
const COR = { principal: '#3b82f6', secundaria: '#eb6834', apagada: '#d4d4d8' }

const dataDoMes = (mes: string) => new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 1, 1)
const mesPorExtenso = (mes: string) => dataDoMes(mes).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const mesCurto = (mes: string) =>
  dataDoMes(mes).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace(' de ', '/')

// Nome de uma chave do detalhe ou do histórico: dia ("7"), mês ("2026-10") ou ano ("2026").
const ehMes = (chave: string) => /^\d{4}-\d{2}$/.test(chave)
const rotuloCurto = (chave: string) => (ehMes(chave) ? mesCurto(chave) : chave)
const rotuloLongo = (chave: string, tipoDetalhe?: 'dia') => (ehMes(chave) ? mesPorExtenso(chave) : tipoDetalhe === 'dia' ? `Dia ${chave}` : chave)

function mesVizinho(mes: string, passo: number) {
  const d = dataDoMes(mes)
  d.setMonth(d.getMonth() + passo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type Escolha = { tipo: 'mes'; mes: string } | { tipo: 'ano'; ano: string } | { tipo: 'tudo' }

const consultaDe = (e: Escolha) => (e.tipo === 'mes' ? `mes=${e.mes}` : e.tipo === 'ano' ? `ano=${e.ano}` : 'tudo=1')
const nomeDoPeriodo = (p: PeriodoDashboard) => (p.tipo === 'mes' ? mesPorExtenso(p.chave) : p.tipo === 'ano' ? p.chave : 'todo o período')
const titulos = {
  mes: { detalhe: 'por dia', historico: 'últimos 6 meses', doPeriodo: 'do mês' },
  ano: { detalhe: 'por mês', historico: 'últimos 6 anos', doPeriodo: 'do ano' },
  tudo: { detalhe: 'por ano', historico: '', doPeriodo: 'do período' },
} as const

export function Dashboards() {
  const mesAtual = hojeIso().slice(0, 7)
  const anoAtual = mesAtual.slice(0, 4)
  // Só aparecem os dashboards liberados no perfil de acesso do usuário.
  const liberados = useSessao().usuario?.dashboards ?? []
  const temComercial = liberados.includes('COMERCIAL')
  const temFinanceiro = liberados.includes('FINANCEIRO')
  const [aba, setAba] = useState<'comercial' | 'financeiro'>(temComercial ? 'comercial' : 'financeiro')
  const [escolha, setEscolha] = useState<Escolha>({ tipo: 'mes', mes: mesAtual })
  const consulta = consultaDe(escolha)
  const comercial = useDados<DashboardComercial>(aba === 'comercial' ? `/dashboards/comercial?${consulta}` : null)
  const financeiro = useDados<DashboardFinanceiro>(aba === 'financeiro' ? `/dashboards/financeiro?${consulta}` : null)
  const atual = aba === 'comercial' ? comercial : financeiro
  const descricao =
    escolha.tipo === 'mes' ? mesPorExtenso(escolha.mes) : escolha.tipo === 'ano' ? escolha.ano : 'todo o período'

  function trocarTipo(tipo: Escolha['tipo']) {
    if (tipo === 'mes') setEscolha({ tipo, mes: escolha.tipo === 'ano' && escolha.ano !== anoAtual ? `${escolha.ano}-12` : mesAtual })
    else if (tipo === 'ano') setEscolha({ tipo, ano: escolha.tipo === 'mes' ? escolha.mes.slice(0, 4) : anoAtual })
    else setEscolha({ tipo })
  }

  return (
    <>
      <Cabecalho titulo="Dashboards" descricao={`Indicadores gerenciais de ${descricao}.`}>
        <select className="filtro-mes" value={escolha.tipo} aria-label="Período" onChange={(e) => trocarTipo(e.target.value as Escolha['tipo'])}>
          <option value="mes">Mês</option>
          <option value="ano">Ano</option>
          <option value="tudo">Todo o período</option>
        </select>
        {escolha.tipo === 'mes' && (
          <>
            <button type="button" className="botao" onClick={() => setEscolha({ tipo: 'mes', mes: mesVizinho(escolha.mes, -1) })} aria-label="Mês anterior">
              <Icone nome="anterior" />
            </button>
            <CampoData type="month" required className="filtro-mes" value={escolha.mes} max={mesAtual} aria-label="Mês"
              onChange={(e) => e.target.value && setEscolha({ tipo: 'mes', mes: e.target.value })} />
            <button type="button" className="botao" onClick={() => setEscolha({ tipo: 'mes', mes: mesVizinho(escolha.mes, 1) })} disabled={escolha.mes >= mesAtual} aria-label="Próximo mês">
              <Icone nome="proximo" />
            </button>
          </>
        )}
        {escolha.tipo === 'ano' && (
          <>
            <button type="button" className="botao" onClick={() => setEscolha({ tipo: 'ano', ano: String(Number(escolha.ano) - 1) })} aria-label="Ano anterior">
              <Icone nome="anterior" />
            </button>
            <input type="number" className="filtro-mes" value={escolha.ano} min={2000} max={Number(anoAtual)} aria-label="Ano"
              onChange={(e) => /^\d{4}$/.test(e.target.value) && Number(e.target.value) <= Number(anoAtual) && setEscolha({ tipo: 'ano', ano: e.target.value })} />
            <button type="button" className="botao" onClick={() => setEscolha({ tipo: 'ano', ano: String(Number(escolha.ano) + 1) })} disabled={escolha.ano >= anoAtual} aria-label="Próximo ano">
              <Icone nome="proximo" />
            </button>
          </>
        )}
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

// Intervalo de datas de uma coluna do gráfico: o dia (no mês), o mês (no ano) ou o ano (em todo o período).
function intervaloDaColuna(periodo: PeriodoDashboard, chave: string) {
  if (periodo.tipo === 'mes') {
    const diaDoMes = `${periodo.chave}-${chave.padStart(2, '0')}`
    return { inicio: diaDoMes, fim: diaDoMes, titulo: new Date(`${diaDoMes}T12:00:00`).toLocaleDateString('pt-BR') }
  }
  if (ehMes(chave)) {
    const ultimo = new Date(Number(chave.slice(0, 4)), Number(chave.slice(5)), 0).getDate()
    return { inicio: `${chave}-01`, fim: `${chave}-${ultimo}`, titulo: mesPorExtenso(chave) }
  }
  return { inicio: `${chave}-01-01`, fim: `${chave}-12-31`, titulo: chave }
}

// As vendas de uma coluna do gráfico, com o atalho para abrir cada pedido.
function VendasDaColuna(props: { inicio: string; fim: string; titulo: string; onFechar: () => void }) {
  const { dados, erro, carregando } = useDados<VendaDoGrafico[]>(`/dashboards/comercial/vendas?inicio=${props.inicio}&fim=${props.fim}`)
  const navegar = useNavigate()
  const abre = useSessao().pode('PEDIDOS_VISUALIZAR', 'PEDIDOS_CADASTRAR')
  const vendas = dados ?? []
  const total = vendas.reduce((s, v) => s + v.total, 0)
  const umDia = props.inicio === props.fim
  return (
    <Modal titulo={`Vendas de ${props.titulo}`} onFechar={props.onFechar} largo>
      <EstadoLista carregando={carregando} erro={erro} vazia={vendas.length === 0} textoVazio="Nenhuma venda faturada neste período." />
      {vendas.length > 0 && (
        <>
          <p className="texto-suave">
            {vendas.length} venda(s) · <strong>{brl(total)}</strong> (antes das devoluções)
          </p>
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                {!umDia && <th>Data</th>}
                <th>Cliente</th>
                <th>Vendedor</th>
                <th className="num">Valor</th>
                {abre && <th />}
              </tr>
            </thead>
            <tbody>
              {vendas.map((v) => (
                <tr key={v.id}>
                  <td className="texto-suave">#{v.numero}</td>
                  {!umDia && <td>{new Date(v.data).toLocaleDateString('pt-BR')}</td>}
                  <td>{v.cliente}</td>
                  <td>{v.vendedor ?? '—'}</td>
                  <td className="num">{brl(v.total)}</td>
                  {abre && (
                    <td className="num">
                      <button type="button" className="botao botao-texto" onClick={() => navegar(`/pedidos?abrir=${v.id}`)}>
                        Abrir pedido
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}

function Comercial({ d }: { d: DashboardComercial }) {
  const nome = nomeDoPeriodo(d.periodo)
  const t = titulos[d.periodo.tipo]
  const porDia = d.periodo.tipo === 'mes'
  const [coluna, setColuna] = useState<{ inicio: string; fim: string; titulo: string } | null>(null)
  return (
    <>
      <section className="indicadores em-3">
        <Indicador rotulo="Faturamento" valor={brl(d.kpis.faturamento)}
          nota={[d.kpis.devolucoes > 0 && `vendas de ${brl(d.kpis.vendasBrutas)} menos ${brl(d.kpis.devolucoes)} devolvidos`, d.kpis.frete > 0 && `inclui ${brl(d.kpis.frete)} de frete`].filter(Boolean).join(' · ') || undefined} />
        <Indicador rotulo="Vendas" valor={String(d.kpis.vendas)} nota="pedidos faturados" />
        <Indicador rotulo="Ticket médio" valor={brl(d.kpis.ticketMedio)} nota="sem descontar devoluções" />
        <Indicador rotulo="Descontos" valor={brl(d.kpis.descontos)} />
        <Indicador rotulo="Custo das vendas" valor={brl(d.kpis.custo)} nota="custo na data do faturamento, sem o que voltou" />
        <Indicador rotulo="Margem bruta" valor={brl(d.kpis.margem)} tom={d.kpis.margem < 0 ? 'ruim' : 'bom'}
          nota={`${d.kpis.margemPercentual.toLocaleString('pt-BR')}% das vendas, sem frete`} />
      </section>

      <Cartao titulo={`Vendas ${t.detalhe} · ${nome}`}>
        <Colunas
          series={[{ nome: 'Vendas', cor: COR.principal }]}
          mostrarRotulo={porDia ? (i) => i === 0 || (i + 1) % 5 === 0 : undefined}
          valorNoTopo={!porDia}
          onEscolher={(i) => setColuna(intervaloDaColuna(d.periodo, d.detalhe[i].chave))}
          pontos={d.detalhe.map((x) => ({
            rotulo: rotuloCurto(x.chave),
            titulo: rotuloLongo(x.chave, porDia ? 'dia' : undefined),
            valores: [x.total],
            nota: `${x.vendas} venda(s)`,
          }))}
        />
        <TabelaDados
          colunas={[porDia ? 'Dia' : d.periodo.tipo === 'ano' ? 'Mês' : 'Ano', 'Vendas', 'Valor']}
          linhas={d.detalhe.filter((x) => x.vendas > 0 || x.total !== 0).map((x) => [porDia ? x.chave.padStart(2, '0') : rotuloLongo(x.chave), String(x.vendas), brl(x.total)])}
        />
      </Cartao>

      {d.periodo.tipo !== 'tudo' && (
        <Cartao titulo={`Evolução das vendas · ${t.historico}`}>
          <Colunas
            series={[{ nome: 'Vendas', cor: COR.principal }]}
            valorNoTopo
            pontos={d.historico.map((m) => ({
              rotulo: rotuloCurto(m.chave),
              titulo: rotuloLongo(m.chave),
              valores: [m.total],
              nota: `${m.vendas} venda(s)${m.devolvido ? ` · ${brl(m.devolvido)} devolvidos` : ''}`,
              cores: [m.chave === d.periodo.chave ? COR.principal : COR.apagada],
            }))}
          />
          <TabelaDados
            colunas={[d.periodo.tipo === 'mes' ? 'Mês' : 'Ano', 'Vendas', 'Devolvido', 'Valor']}
            linhas={d.historico.map((m) => [rotuloLongo(m.chave), String(m.vendas), brl(m.devolvido), brl(m.total)])}
          />
        </Cartao>
      )}

      <div className="tres-colunas">
        <Cartao titulo="Top vendedores">
          <Ranking itens={d.topVendedores} cor={COR.principal} textoVazio={`Sem vendas ${t.doPeriodo}.`} />
        </Cartao>
        <Cartao titulo="Top clientes">
          <Ranking itens={d.topClientes} cor={COR.principal} textoVazio={`Sem vendas ${t.doPeriodo}.`} />
        </Cartao>
        <Cartao titulo="Top produtos">
          <Ranking itens={d.topProdutos} cor={COR.principal} textoVazio={`Sem vendas ${t.doPeriodo}.`} />
        </Cartao>
      </div>
      {coluna && <VendasDaColuna {...coluna} onFechar={() => setColuna(null)} />}
    </>
  )
}

function Financeiro({ d }: { d: DashboardFinanceiro }) {
  const nome = nomeDoPeriodo(d.periodo)
  const t = titulos[d.periodo.tipo]
  const tudo = d.periodo.tipo === 'tudo'
  return (
    <>
      <section className="indicadores em-4">
        <Indicador rotulo={`Recebido ${t.doPeriodo}`} valor={brl(d.kpis.recebido)} />
        <Indicador rotulo={`Pago ${t.doPeriodo}`} valor={brl(d.kpis.pago)} />
        <Indicador rotulo={`Saldo ${t.doPeriodo}`} valor={brl(d.kpis.saldo)} tom={d.kpis.saldo < 0 ? 'ruim' : 'bom'} nota="recebido menos pago" />
        <Indicador rotulo="A receber" valor={brl(d.kpis.aReceber)} nota={tudo ? 'tudo em aberto' : `em aberto, com vencimento ${t.doPeriodo.replace('do ', 'no ')}`} />
        <Indicador rotulo="A pagar" valor={brl(d.kpis.aPagar)} nota={tudo ? 'tudo em aberto' : `em aberto, com vencimento ${t.doPeriodo.replace('do ', 'no ')}`} />
        <Indicador rotulo="Vencido a receber" valor={brl(d.kpis.vencidoReceber)} tom={d.kpis.vencidoReceber > 0 ? 'ruim' : undefined} nota="até hoje" />
        <Indicador rotulo="Vencido a pagar" valor={brl(d.kpis.vencidoPagar)} tom={d.kpis.vencidoPagar > 0 ? 'ruim' : undefined} nota="até hoje" />
        <Indicador rotulo={`Despesas ${t.doPeriodo}`} valor={brl(d.kpis.despesas)} nota="pela competência, pagas ou não" />
      </section>

      <Cartao titulo={`Recebido e pago · ${tudo ? 'por ano' : t.historico}`}>
        <Colunas
          series={[
            { nome: 'Recebido', cor: COR.principal },
            { nome: 'Pago', cor: COR.secundaria },
          ]}
          pontos={d.historico.map((m) => ({ rotulo: rotuloCurto(m.chave), titulo: rotuloLongo(m.chave), valores: [m.recebido, m.pago] }))}
        />
        <TabelaDados
          colunas={[d.periodo.tipo === 'mes' ? 'Mês' : 'Ano', 'Recebido', 'Pago', 'Saldo']}
          linhas={d.historico.map((m) => [rotuloLongo(m.chave), brl(m.recebido), brl(m.pago), brl(m.recebido - m.pago)])}
        />
      </Cartao>

      <Cartao titulo={`Despesas por competência · ${tudo ? 'por ano' : t.historico}`}>
        <Colunas
          series={[{ nome: 'Despesas', cor: COR.secundaria }]}
          valorNoTopo
          pontos={d.historico.map((m) => ({
            rotulo: rotuloCurto(m.chave),
            titulo: rotuloLongo(m.chave),
            valores: [m.despesas],
            cores: [m.chave === d.periodo.chave || tudo ? COR.secundaria : COR.apagada],
          }))}
        />
        <TabelaDados colunas={[d.periodo.tipo === 'mes' ? 'Mês' : 'Ano', 'Despesas']} linhas={d.historico.map((m) => [rotuloLongo(m.chave), brl(m.despesas)])} />
      </Cartao>

      <Cartao estreito titulo={`Despesas por elemento · ${nome}`}>
        <Ranking itens={d.despesasPorElemento} cor={COR.secundaria} textoVazio={`Nenhuma despesa com competência ${t.doPeriodo.replace('do ', 'no ')}.`} />
      </Cartao>

      <Cartao estreito titulo={`Recebido por forma de pagamento · ${nome}`}>
        <Ranking
          itens={d.formas.map((f) => ({ ...f, nome: f.nome === 'OUTROS' ? 'Lançamentos avulsos' : (formasPagamento[f.nome] ?? f.nome) }))}
          cor={COR.principal}
          textoVazio={`Nenhum recebimento ${t.doPeriodo.replace('do ', 'no ')}.`}
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
