import { Link } from 'react-router-dom'
import { useDados } from '../api'
import { useSessao } from '../auth'
import { brl, dataBr, qtd } from '../format'
import { Icone, type NomeIcone } from '../icones'
import type { Resumo } from '../types'
import { Cabecalho, EstadoLista, Selo } from '../ui'

export function Inicio() {
  const { dados, erro, carregando, recarregar } = useDados<Resumo>('/dashboard/resumo')
  const primeiroNome = useSessao().usuario?.nome.split(' ')[0] ?? ''

  return (
    <>
      <Cabecalho titulo={`Olá, ${primeiroNome} 👋`} descricao="Veja um resumo das operações: vendas, financeiro e estoque.">
        <button type="button" className="botao" onClick={recarregar} disabled={carregando}>
          Atualizar
        </button>
      </Cabecalho>
      <EstadoLista carregando={carregando} erro={erro} vazia={!dados} textoVazio="" />
      {dados && (
        <>
          {/* Só os indicadores das áreas que o perfil pode ver (os outros vêm vazios da API). */}
          <section className="indicadores em-3">
            {dados.vendas && (
              <Indicador icone="vendas" rotulo="Vendas faturadas" valor={brl(dados.vendas.total)}
                nota={`${dados.vendas.quantidade} pedido(s) · ${dados.vendas.pedidosAbertos} em aberto`} />
            )}
            {dados.receber && (
              <Indicador icone="receber" rotulo="A receber" valor={brl(dados.receber.total)}
                nota={`${dados.receber.vencidas} parcela(s) vencida(s)`} alerta={dados.receber.vencidas > 0} />
            )}
            {dados.pagar && (
              <Indicador icone="pagar" rotulo="A pagar" valor={brl(dados.pagar.total)}
                nota={`${dados.pagar.vencidas} parcela(s) vencida(s)`} alerta={dados.pagar.vencidas > 0} />
            )}
            {dados.saldoProjetado !== null && (
              <Indicador icone="saldo" rotulo="Saldo projetado" valor={brl(dados.saldoProjetado)} nota="A receber menos a pagar"
                tom={dados.saldoProjetado < 0 ? 'ruim' : 'bom'} />
            )}
            {dados.estoque && (
              <Indicador icone="produtos" rotulo="Estoque a custo" valor={brl(dados.estoque.valor)}
                nota={`${dados.estoque.semEstoque} produto(s) sem estoque`} alerta={dados.estoque.semEstoque > 0} />
            )}
            {dados.entregas && (
              <Indicador icone="entregas" rotulo="Entregas a fazer" valor={String(dados.entregas.pendentes + dados.entregas.emRota + dados.entregas.falhas)}
                nota={`${dados.entregas.emRota} em rota · ${dados.entregas.falhas} com falha`} alerta={dados.entregas.falhas > 0} />
            )}
          </section>

          <div className="duas-colunas">
            {dados.vendas && (
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
                        <td className="texto-suave">#{p.numero}</td>
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
            )}

            {dados.estoque && (
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
            )}
          </div>
        </>
      )}
    </>
  )
}

function Indicador(props: { icone: NomeIcone; rotulo: string; valor: string; nota: string; alerta?: boolean; tom?: 'bom' | 'ruim' }) {
  return (
    <div className="indicador">
      <i className="indicador-icone">
        <Icone nome={props.icone} />
      </i>
      <span>{props.rotulo}</span>
      <strong className={props.tom ? `texto-${props.tom}` : ''}>{props.valor}</strong>
      <small className={props.alerta ? 'texto-ruim' : 'texto-suave'}>{props.nota}</small>
    </div>
  )
}
