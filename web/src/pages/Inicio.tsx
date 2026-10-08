import { Link } from 'react-router-dom'
import { useDados } from '../api'
import { brl, dataBr, qtd } from '../format'
import type { Resumo } from '../types'
import { Cabecalho, EstadoLista, Selo } from '../ui'

export function Inicio() {
  const { dados, erro, carregando, recarregar } = useDados<Resumo>('/dashboard/resumo')

  return (
    <>
      <Cabecalho titulo="Início" descricao="Situação atual de vendas, financeiro e estoque.">
        <button type="button" className="botao" onClick={recarregar} disabled={carregando}>
          Atualizar
        </button>
      </Cabecalho>
      <EstadoLista carregando={carregando} erro={erro} vazia={!dados} textoVazio="" />
      {dados && (
        <>
          <section className="indicadores">
            <Indicador rotulo="Vendas faturadas" valor={brl(dados.vendas.total)}
              nota={`${dados.vendas.quantidade} pedido(s) · ${dados.vendas.pedidosAbertos} em aberto`} />
            <Indicador rotulo="A receber" valor={brl(dados.receber.total)}
              nota={`${dados.receber.vencidas} parcela(s) vencida(s)`} alerta={dados.receber.vencidas > 0} />
            <Indicador rotulo="A pagar" valor={brl(dados.pagar.total)}
              nota={`${dados.pagar.vencidas} parcela(s) vencida(s)`} alerta={dados.pagar.vencidas > 0} />
            <Indicador rotulo="Saldo projetado" valor={brl(dados.saldoProjetado)} nota="A receber menos a pagar"
              tom={dados.saldoProjetado < 0 ? 'ruim' : 'bom'} />
            <Indicador rotulo="Estoque a custo" valor={brl(dados.estoque.valor)}
              nota={`${dados.estoque.semEstoque} produto(s) sem estoque`} alerta={dados.estoque.semEstoque > 0} />
            <Indicador rotulo="Entregas a fazer" valor={String(dados.entregas.pendentes + dados.entregas.emRota + dados.entregas.falhas)}
              nota={`${dados.entregas.emRota} em rota · ${dados.entregas.falhas} com falha`} alerta={dados.entregas.falhas > 0} />
          </section>

          <div className="duas-colunas">
            <section className="painel">
              <div className="painel-topo">
                <h2>Últimos pedidos</h2>
                <Link to="/pedidos">Ver todos</Link>
              </div>
              {dados.ultimosPedidos.length === 0 ? (
                <p className="aviso">Nenhum pedido ainda.</p>
              ) : (
                <table>
                  <tbody>
                    {dados.ultimosPedidos.map((p) => (
                      <tr key={p.id}>
                        <td className="texto-suave">#{p.id}</td>
                        <td>{p.cliente}</td>
                        <td className="texto-suave">{dataBr(p.criadoEm)}</td>
                        <td><Selo valor={p.status} /></td>
                        <td className="num">{brl(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="painel">
              <div className="painel-topo">
                <h2>Estoque no mínimo ou abaixo</h2>
                <Link to="/produtos">Ver produtos</Link>
              </div>
              {dados.estoque.criticos.length === 0 ? (
                <p className="aviso">Nenhum produto abaixo do mínimo.</p>
              ) : (
                <table>
                  <tbody>
                    {dados.estoque.criticos.map((p) => (
                      <tr key={p.id}>
                        <td className="texto-suave">{p.sku}</td>
                        <td>{p.nome}</td>
                        <td className="num">
                          <span className={p.saldo <= 0 ? 'texto-ruim' : ''}>{qtd(p.saldo)}</span>
                          <span className="texto-suave"> / mín. {p.estoqueMinimo}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </>
  )
}

function Indicador(props: { rotulo: string; valor: string; nota: string; alerta?: boolean; tom?: 'bom' | 'ruim' }) {
  return (
    <div className="indicador">
      <span>{props.rotulo}</span>
      <strong className={props.tom ? `texto-${props.tom}` : ''}>{props.valor}</strong>
      <small className={props.alerta ? 'texto-ruim' : 'texto-suave'}>{props.nota}</small>
    </div>
  )
}
