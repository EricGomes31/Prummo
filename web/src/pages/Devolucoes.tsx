import { useState, type FormEvent } from 'react'
import { api, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import { brl, dataBr, inteiro } from '../format'
import type { Conta, Credito, Devolucao, Pedido, SaldoDevolucao } from '../types'
import { Cabecalho, Campo, Dinheiro, Erro, EstadoLista, Modal, Selo } from '../ui'

const SeloCredito = ({ status }: { status: Credito['status'] }) =>
  status === 'DISPONIVEL' ? <Selo valor="Disponível" tom="bom" /> : <Selo valor="Esgotado" tom="apagado" />

export function Devolucoes() {
  const { pode } = useSessao()
  const [status, setStatus] = useState('DISPONIVEL')
  const creditos = useDados<Credito[]>(`/creditos${status ? `?status=${status}` : ''}`)
  const devolucoes = useDados<Devolucao[]>(pode('DEVOLUCOES_VISUALIZAR', 'DEVOLUCOES_REGISTRAR') ? '/devolucoes' : null)
  const [usando, setUsando] = useState<Credito | null>(null)
  const listaCreditos = creditos.dados ?? []
  const listaDevolucoes = devolucoes.dados ?? []

  function atualizar() {
    creditos.recarregar()
    devolucoes.recarregar()
  }

  return (
    <>
      <Cabecalho
        titulo="Devoluções e créditos"
        descricao="A devolução devolve o estoque e gera um crédito pelo valor líquido do item na venda. O crédito baixa contas a receber do cliente, do médico, do vendedor ou do paciente daquela venda."
      >
        <button type="button" className="botao" onClick={atualizar}>
          Atualizar
        </button>
      </Cabecalho>

      {pode('DEVOLUCOES_REGISTRAR') && <RegistrarDevolucao onRegistrada={atualizar} />}

      <h2>Créditos de clientes</h2>
      <div className="filtros">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação do crédito">
          <option value="DISPONIVEL">Disponíveis</option>
          <option value="ESGOTADO">Esgotados</option>
          <option value="">Todos</option>
        </select>
        <span className="resumo-filtro">
          Disponível: <strong>{brl(listaCreditos.filter((c) => c.status === 'DISPONIVEL').reduce((s, c) => s + c.saldo, 0))}</strong>
        </span>
      </div>
      <section className="painel">
        <EstadoLista carregando={creditos.carregando} erro={creditos.erro} vazia={listaCreditos.length === 0} textoVazio="Nenhum crédito nesta situação." />
        {listaCreditos.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Crédito</th>
                <th>Cliente</th>
                <th>Origem</th>
                <th>Data</th>
                <th className="num">Original</th>
                <th className="num">Disponível</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listaCreditos.map((c) => (
                <tr key={c.id}>
                  <td className="texto-suave">#{c.id}</td>
                  <td>{c.pessoa.nome}</td>
                  <td>{c.devolucao ? `Devolução nº ${c.devolucao.id} · pedido nº ${c.devolucao.pedido.id}` : '—'}</td>
                  <td>{dataBr(c.criadoEm)}</td>
                  <td className="num">{brl(c.valorOriginal)}</td>
                  <td className="num">{brl(c.saldo)}</td>
                  <td><SeloCredito status={c.status} /></td>
                  <td className="num">
                    <button type="button" className="botao botao-texto" onClick={() => setUsando(c)}>
                      {c.status === 'DISPONIVEL' && pode('CREDITOS_UTILIZAR') ? 'Usar' : 'Detalhes'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {devolucoes.dados && (
        <>
          <h2>Devoluções registradas</h2>
          <section className="painel">
            <EstadoLista carregando={devolucoes.carregando} erro={devolucoes.erro} vazia={listaDevolucoes.length === 0} textoVazio="Nenhuma devolução registrada." />
            {listaDevolucoes.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Venda</th>
                    <th>Cliente</th>
                    <th>Itens devolvidos</th>
                    <th>Observação</th>
                    <th>Usuário</th>
                    <th className="num">Crédito gerado</th>
                  </tr>
                </thead>
                <tbody>
                  {listaDevolucoes.map((d) => (
                    <tr key={d.id}>
                      <td className="texto-suave">#{d.id}</td>
                      <td>{dataBr(d.criadoEm)}</td>
                      <td>Pedido nº {d.pedido.id}</td>
                      <td>{d.pedido.cliente.nome}</td>
                      <td>
                        {d.itens.map((i) => (
                          <div key={i.id}>
                            {i.quantidade} {i.pedidoItem.unidade ?? i.pedidoItem.produto.unidade} · {i.pedidoItem.produto.nome}
                          </div>
                        ))}
                      </td>
                      <td>{d.observacao ?? '—'}</td>
                      <td>{d.usuario?.nome ?? '—'}</td>
                      <td className="num">{brl(d.valorCredito)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {usando && (
        <UsarCredito
          credito={usando}
          onFechar={() => {
            setUsando(null)
            atualizar()
          }}
        />
      )}
    </>
  )
}

function RegistrarDevolucao({ onRegistrada }: { onRegistrada: () => void }) {
  const vendas = (useDados<Pedido[]>('/pedidos?status=FATURADO').dados ?? []).filter((p) => p.natureza === 'VENDA')
  const [pedidoId, setPedidoId] = useState(0)
  const saldos = useDados<SaldoDevolucao[]>(pedidoId ? `/devolucoes/pedido/${pedidoId}/saldos` : null)
  const [quantidades, setQuantidades] = useState<Record<number, number>>({})
  const [observacao, setObservacao] = useState('')
  const [aviso, setAviso] = useState('')
  const { erro, ocupado, executar } = useAcao()
  const itens = pedidoId ? (saldos.dados ?? []) : []
  const credito = itens.reduce((s, i) => s + (quantidades[i.pedidoItemId] ?? 0) * i.valorUnitario, 0)

  function escolherVenda(id: number) {
    setPedidoId(id)
    setQuantidades({})
    setAviso('')
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const corpo = {
        pedidoId,
        observacao,
        itens: itens.map((i) => ({ pedidoItemId: i.pedidoItemId, quantidade: quantidades[i.pedidoItemId] ?? 0 })).filter((i) => i.quantidade > 0),
      }
      const devolucao = await api<{ id: number; valorCredito: number }>('/devolucoes', { body: corpo })
      setAviso(`Devolução nº ${devolucao.id} registrada. Crédito gerado: ${brl(devolucao.valorCredito)}.`)
      setQuantidades({})
      setObservacao('')
      saldos.recarregar()
      onRegistrada()
    })
  }

  return (
    <>
      <h2>Registrar devolução</h2>
      <section className="painel">
        <form onSubmit={enviar} className="form">
          <Campo rotulo="Venda faturada" largura={3}>
            <select required value={pedidoId || ''} onChange={(e) => escolherVenda(Number(e.target.value))}>
              <option value="">Selecione…</option>
              {vendas.map((p) => (
                <option key={p.id} value={p.id}>
                  Pedido nº {p.id} · {p.cliente.nome} · {brl(p.total)}
                </option>
              ))}
            </select>
          </Campo>

          {itens.length > 0 && (
            <div className="col-3">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Vendido</th>
                    <th className="num">Já devolvido</th>
                    <th className="num">Valor líquido unit.</th>
                    <th className="num">Devolver agora</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.pedidoItemId}>
                      <td>{i.produto.sku} · {i.produto.nome}</td>
                      <td className="num">{i.quantidade} {i.unidade}</td>
                      <td className="num">{i.devolvido}</td>
                      <td className="num">{brl(i.valorUnitario)}</td>
                      <td className="num">
                        <input
                          type="number"
                          min={0}
                          max={i.disponivel}
                          className="curto"
                          disabled={i.disponivel === 0}
                          aria-label={`Quantidade a devolver de ${i.produto.nome}`}
                          value={quantidades[i.pedidoItemId] || ''}
                          onChange={(e) => setQuantidades({ ...quantidades, [i.pedidoItemId]: Math.min(i.disponivel, inteiro(e.target.value)) })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pedidoId > 0 && (
            <Campo rotulo="Observação" largura={3}>
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </Campo>
          )}
          {pedidoId > 0 && (
            <p className="total col-3">
              Crédito a gerar: <strong>{brl(credito)}</strong>
            </p>
          )}
          {aviso && <p className="texto-suave col-3">{aviso}</p>}
          <Erro mensagem={erro || saldos.erro} />
          <div className="form-pe">
            <button className="botao botao-primario" disabled={ocupado || credito === 0}>
              Registrar devolução
            </button>
          </div>
        </form>
      </section>
    </>
  )
}

// Aplica o crédito em uma conta a receber de uma das pessoas elegíveis e mostra onde ele já foi usado.
function UsarCredito(props: { credito: Credito; onFechar: () => void }) {
  const { pode } = useSessao()
  const [credito, setCredito] = useState(props.credito)
  const podeUsar = credito.status === 'DISPONIVEL' && pode('CREDITOS_UTILIZAR')
  const abertas = useDados<Conta[]>(podeUsar ? '/contas-receber?status=ABERTA' : null)
  const [pessoaId, setPessoaId] = useState(credito.elegiveis.length === 1 ? credito.elegiveis[0].id : 0)
  const [contaId, setContaId] = useState(0)
  const [valor, setValor] = useState(0)
  const { erro, ocupado, executar } = useAcao()
  const contas = (abertas.dados ?? []).filter((c) => c.pessoa?.id === pessoaId)

  function escolherConta(id: number) {
    setContaId(id)
    const conta = contas.find((c) => c.id === id)
    // Sugere o maior valor possível: o saldo do crédito ou o da conta, o que for menor.
    setValor(conta ? Math.min(credito.saldo, conta.valor - conta.valorPago) : 0)
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      setCredito(await api<Credito>(`/creditos/${credito.id}/utilizar`, { body: { contaReceberId: contaId, pessoaId, valor } }))
      setContaId(0)
      setValor(0)
      abertas.recarregar()
    })
  }

  return (
    <Modal titulo={`Crédito nº ${credito.id} · ${credito.pessoa.nome}`} onFechar={props.onFechar} largo>
      <p>
        {credito.devolucao && `Devolução nº ${credito.devolucao.id} · pedido nº ${credito.devolucao.pedido.id} · `}
        original {brl(credito.valorOriginal)} · disponível <strong>{brl(credito.saldo)}</strong> · <SeloCredito status={credito.status} />
      </p>
      {podeUsar && (
        <form onSubmit={enviar} className="form">
          <Campo rotulo="Pessoa elegível">
            <select
              required
              value={pessoaId || ''}
              onChange={(e) => {
                setPessoaId(Number(e.target.value))
                setContaId(0)
                setValor(0)
              }}
            >
              <option value="">Selecione…</option>
              {credito.elegiveis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Conta a receber em aberto" largura={2}>
            <select required value={contaId || ''} onChange={(e) => escolherConta(Number(e.target.value))} disabled={!pessoaId}>
              <option value="">{pessoaId && contas.length === 0 ? 'Nenhuma conta em aberto desta pessoa' : 'Selecione…'}</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.descricao} · saldo {brl(c.valor - c.valorPago)}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Valor (R$)">
            <Dinheiro required valor={valor} onChange={setValor} />
          </Campo>
          <Erro mensagem={erro} />
          <div className="form-pe">
            <button type="button" className="botao" onClick={props.onFechar}>
              Fechar
            </button>
            <button className="botao botao-primario" disabled={ocupado || valor <= 0 || !contaId}>
              Aplicar crédito
            </button>
          </div>
        </form>
      )}

      <h3>Onde o crédito foi usado</h3>
      {credito.usos.length === 0 ? (
        <p className="aviso">Ainda não foi usado.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Pessoa</th>
              <th>Conta a receber</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {credito.usos.map((u) => (
              <tr key={u.id}>
                <td>{dataBr(u.criadoEm)}</td>
                <td>{u.pessoa.nome}</td>
                <td>{u.contaReceber.descricao}</td>
                <td className="num">{brl(u.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!podeUsar && (
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Fechar
          </button>
        </div>
      )}
    </Modal>
  )
}
