import { useState, type FormEvent } from 'react'
import { api, useAcao, useDados } from '../api'
import { confirmar } from '../confirmacao'
import { useSessao } from '../auth'
import { avisar } from '../avisos'
import { brl, dataBr, inteiro } from '../format'
import { Icone, type NomeIcone } from '../icones'
import type { Conta, Credito, Devolucao, Pedido, Pessoa, SaldoDevolucao } from '../types'
import { Cabecalho, Campo, Dinheiro, Erro, EstadoLista, Modal, Selo, useOrdenacao, usePaginacao } from '../ui'
import { Escolha, opcoesDePessoas } from '../escolha'

const SeloCredito = ({ status }: { status: Credito['status'] }) =>
  status === 'DISPONIVEL' ? (
    <Selo valor="Disponível" tom="bom" />
  ) : status === 'CANCELADO' ? (
    <Selo valor="Cancelado" tom="apagado" />
  ) : (
    <Selo valor="Esgotado" tom="apagado" />
  )

// De onde veio o crédito.
const origemDoCredito = (c: Credito) =>
  c.origem === 'DEVOLUCAO' && c.devolucao
    ? `Devolução nº ${c.devolucao.id} · pedido nº ${c.devolucao.pedido.numero}`
    : c.origem === 'DEPOSITO'
      ? 'Depósito a maior'
      : `Avulso${c.descricao ? `: ${c.descricao}` : ''}`

export function Devolucoes() {
  const { pode } = useSessao()
  const [status, setStatus] = useState('DISPONIVEL')
  // Busca todos os créditos de uma vez: o filtro é feito aqui, e os indicadores somam sempre o total.
  const creditos = useDados<Credito[]>('/creditos')
  const devolucoes = useDados<Devolucao[]>(pode('DEVOLUCOES_VISUALIZAR', 'DEVOLUCOES_REGISTRAR') ? '/devolucoes' : null)
  const [usando, setUsando] = useState<Credito | null>(null)
  const [registrando, setRegistrando] = useState(false)
  const [lancandoCredito, setLancandoCredito] = useState(false)
  const acao = useAcao()
  const todosCreditos = creditos.dados ?? []
  const listaCreditos = status ? todosCreditos.filter((c) => c.status === status) : todosCreditos
  const listaDevolucoes = devolucoes.dados ?? []
  const validas = listaDevolucoes.filter((d) => !d.estornada)
  const { ordenados: creditosOrdenados, titulo: tituloCredito } = useOrdenacao(listaCreditos, {
    credito: (c) => c.id,
    cliente: (c) => c.pessoa.nome,
    origem: (c) => origemDoCredito(c),
    data: (c) => c.criadoEm,
    original: (c) => c.valorOriginal,
    disponivel: (c) => c.saldo,
    situacao: (c) => c.status,
  })
  const paginaCreditos = usePaginacao(creditosOrdenados)
  const { ordenados: devolucoesOrdenadas, titulo: tituloDevolucao } = useOrdenacao(listaDevolucoes, {
    numero: (d) => d.id,
    data: (d) => d.criadoEm,
    venda: (d) => d.pedido.numero,
    cliente: (d) => d.pedido.cliente.nome,
    usuario: (d) => d.usuario?.nome,
    credito: (d) => d.valorCredito,
  })
  const paginaDevolucoes = usePaginacao(devolucoesOrdenadas)
  const disponiveis = todosCreditos.filter((c) => c.status === 'DISPONIVEL')

  function atualizar() {
    creditos.recarregar()
    devolucoes.recarregar()
  }

  async function estornar(d: Devolucao) {
    if (!(await confirmar({ texto: `Estornar a devolução nº ${d.id}? Os itens voltam a sair do estoque e o crédito de ${brl(d.valorCredito)} é cancelado.`, botao: 'Estornar devolução', perigo: true }))) return
    acao.executar(async () => {
      await api(`/devolucoes/${d.id}/estornar`, { method: 'POST' })
      atualizar()
    })
  }

  return (
    <>
      <Cabecalho
        titulo="Devoluções e créditos"
        descricao="A devolução devolve o estoque e gera um crédito pelo valor líquido do item na venda. O crédito baixa contas a receber do cliente, do médico, do vendedor ou do paciente daquela venda, aqui ou ao faturar uma nova venda."
      >
        <button type="button" className="botao" onClick={atualizar}>
          Atualizar
        </button>
        {pode('CREDITOS_LANCAR') && (
          <button type="button" className="botao" onClick={() => setLancandoCredito(true)}>
            Crédito avulso
          </button>
        )}
        {pode('DEVOLUCOES_REGISTRAR') && (
          <button type="button" className="botao botao-primario" onClick={() => setRegistrando(true)}>
            Nova devolução
          </button>
        )}
      </Cabecalho>

      {creditos.dados && (
        <section className="indicadores em-3">
          <Indicador icone="saldo" rotulo="Crédito disponível" valor={brl(disponiveis.reduce((s, c) => s + c.saldo, 0))}
            nota={`${disponiveis.length} crédito(s) com saldo`} />
          <Indicador icone="receber" rotulo="Crédito já usado"
            valor={brl(todosCreditos.filter((c) => c.status !== 'CANCELADO').reduce((s, c) => s + c.valorOriginal - c.saldo, 0))}
            nota="Baixado em contas a receber" />
          <Indicador icone="devolucoes" rotulo="Devoluções" valor={devolucoes.dados ? String(validas.length) : '—'}
            nota={devolucoes.dados ? `${brl(validas.reduce((s, d) => s + d.valorCredito, 0))} em crédito gerado` : 'Sem acesso à lista'} />
        </section>
      )}
      <Erro mensagem={acao.erro} />

      <section className="painel">
        <div className="painel-topo">
          <h2>Créditos de clientes</h2>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação do crédito" className="seletor-compacto">
            <option value="DISPONIVEL">Disponíveis</option>
            <option value="ESGOTADO">Esgotados</option>
            <option value="CANCELADO">Cancelados</option>
            <option value="">Todos</option>
          </select>
        </div>
        <EstadoLista carregando={creditos.carregando} erro={creditos.erro} vazia={listaCreditos.length === 0} textoVazio="Nenhum crédito nesta situação." />
        {listaCreditos.length > 0 && (
          <table>
            <thead>
              <tr>
                {tituloCredito('credito', 'Crédito')}
                {tituloCredito('cliente', 'Cliente')}
                {tituloCredito('origem', 'Origem')}
                {tituloCredito('data', 'Data')}
                {tituloCredito('original', 'Original', 'num')}
                {tituloCredito('disponivel', 'Disponível', 'num')}
                {tituloCredito('situacao', 'Situação')}
                <th />
              </tr>
            </thead>
            <tbody>
              {paginaCreditos.visiveis.map((c) => (
                <tr key={c.id}>
                  <td className="texto-suave">#{c.id}</td>
                  <td>{c.pessoa.nome}</td>
                  <td>{origemDoCredito(c)}</td>
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
        {paginaCreditos.controle}
      </section>

      {devolucoes.dados && (
        <>
          <section className="painel">
            <div className="painel-topo">
              <h2>Devoluções registradas</h2>
            </div>
            <EstadoLista carregando={devolucoes.carregando} erro={devolucoes.erro} vazia={listaDevolucoes.length === 0} textoVazio="Nenhuma devolução registrada." />
            {listaDevolucoes.length > 0 && (
              <table>
                <thead>
                  <tr>
                    {tituloDevolucao('numero', 'Nº')}
                    {tituloDevolucao('data', 'Data')}
                    {tituloDevolucao('venda', 'Venda')}
                    {tituloDevolucao('cliente', 'Cliente')}
                    <th>Itens devolvidos</th>
                    <th>Observação</th>
                    {tituloDevolucao('usuario', 'Usuário')}
                    {tituloDevolucao('credito', 'Crédito gerado', 'num')}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {paginaDevolucoes.visiveis.map((d) => (
                    <tr key={d.id} className={d.estornada ? 'linha-inativa' : ''}>
                      <td className="texto-suave">#{d.id}</td>
                      <td>{dataBr(d.criadoEm)}</td>
                      <td>Pedido nº {d.pedido.numero}</td>
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
                      <td className="num">
                        {d.estornada ? (
                          <Selo valor="Estornada" tom="apagado" />
                        ) : (
                          pode('DEVOLUCOES_REGISTRAR') && (
                            <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => estornar(d)}>
                              Estornar
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {paginaDevolucoes.controle}
          </section>
        </>
      )}

      {registrando && (
        <RegistrarDevolucao
          onFechar={() => setRegistrando(false)}
          onRegistrada={() => {
            setRegistrando(false)
            setStatus('DISPONIVEL')
            atualizar()
          }}
        />
      )}

      {lancandoCredito && (
        <CreditoAvulso
          onFechar={() => setLancandoCredito(false)}
          onSalvo={() => {
            setLancandoCredito(false)
            setStatus('DISPONIVEL')
            atualizar()
          }}
        />
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

function RegistrarDevolucao({ onFechar, onRegistrada }: { onFechar: () => void; onRegistrada: () => void }) {
  const pedidos = useDados<Pedido[]>('/pedidos?status=FATURADO')
  const vendas = (pedidos.dados ?? []).filter((p) => p.natureza === 'VENDA')
  const [pedidoId, setPedidoId] = useState(0)
  const saldos = useDados<SaldoDevolucao[]>(pedidoId ? `/devolucoes/pedido/${pedidoId}/saldos` : null)
  const [quantidades, setQuantidades] = useState<Record<number, number>>({})
  const [observacao, setObservacao] = useState('')
  const { erro, ocupado, executar } = useAcao()
  const itens = pedidoId ? (saldos.dados ?? []) : []
  const credito = itens.reduce((s, i) => s + (quantidades[i.pedidoItemId] ?? 0) * i.valorUnitario, 0)

  function escolherVenda(id: number) {
    setPedidoId(id)
    setQuantidades({})
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
      avisar('sucesso', `Devolução nº ${devolucao.id} registrada. Crédito gerado: ${brl(devolucao.valorCredito)}.`)
      onRegistrada()
    })
  }

  return (
    <Modal titulo="Nova devolução" onFechar={onFechar} largo>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Venda faturada" largura={3}>
          <Escolha
            required
            autoFocus
            opcoes={vendas.map((p) => ({ id: p.id, rotulo: `Pedido nº ${p.numero} · ${p.cliente.nome}`, detalhe: brl(p.total), busca: String(p.numero) }))}
            valor={pedidoId}
            onChange={escolherVenda}
            placeholder={pedidos.carregando ? 'Carregando vendas…' : vendas.length === 0 ? 'Nenhuma venda faturada' : 'Digite o número do pedido ou o cliente…'}
          />
        </Campo>

        {pedidoId === 0 && (
          <p className="texto-suave col-3">Escolha a venda para ver os itens e quanto ainda pode ser devolvido de cada um.</p>
        )}
        {itens.length > 0 && (
          <div className="col-3 itens">
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
        <Erro mensagem={erro || saldos.erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado || credito === 0}>
            Registrar devolução
          </button>
        </div>
      </form>
    </Modal>
  )
}

// Crédito lançado à mão para uma pessoa: acordo comercial, compensação, valor pago antecipado...
function CreditoAvulso(props: { onFechar: () => void; onSalvo: () => void }) {
  const pessoas = (useDados<Pessoa[]>('/pessoas').dados ?? []).filter((p) => p.ativo)
  const [pessoaId, setPessoaId] = useState(0)
  const [valor, setValor] = useState(0)
  const [descricao, setDescricao] = useState('')
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      await api('/creditos', { body: { pessoaId, valor, descricao } })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo="Crédito avulso" onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Pessoa" largura={2}>
          <Escolha required autoFocus opcoes={opcoesDePessoas(pessoas)} valor={pessoaId} onChange={setPessoaId} />
        </Campo>
        <Campo rotulo="Valor (R$)">
          <Dinheiro required valor={valor} onChange={setValor} />
        </Campo>
        <Campo rotulo="Motivo" largura={3}>
          <input required value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: acordo comercial, pagamento antecipado" />
        </Campo>
        <p className="texto-suave col-3">O crédito fica com a pessoa e pode baixar contas a receber dela, aqui ou no faturamento de uma venda.</p>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado || valor <= 0}>
            Lançar crédito
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Indicador(props: { icone: NomeIcone; rotulo: string; valor: string; nota: string }) {
  return (
    <div className="indicador">
      <i className="indicador-icone">
        <Icone nome={props.icone} />
      </i>
      <span>{props.rotulo}</span>
      <strong>{props.valor}</strong>
      <small>{props.nota}</small>
    </div>
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

  async function estornarUso(uso: Credito['usos'][number]) {
    if (!(await confirmar({ texto: `Estornar o uso de ${brl(uso.valor)} em "${uso.contaReceber.descricao}"? O valor volta ao crédito e a conta volta a ter saldo.`, botao: 'Estornar uso', perigo: true }))) return
    executar(async () => {
      setCredito(await api<Credito>(`/creditos/usos/${uso.id}/estornar`, { method: 'POST' }))
      abertas.recarregar()
    })
  }

  async function cancelar() {
    if (!(await confirmar({ texto: `Cancelar o crédito avulso nº ${credito.id} de ${brl(credito.valorOriginal)}?`, botao: 'Cancelar crédito', perigo: true }))) return
    executar(async () => setCredito(await api<Credito>(`/creditos/${credito.id}/cancelar`, { method: 'POST' })))
  }

  const usado = credito.saldo !== credito.valorOriginal

  return (
    <Modal titulo={`Crédito nº ${credito.id} · ${credito.pessoa.nome}`} onFechar={props.onFechar} largo>
      <p>
        {origemDoCredito(credito)} · original {brl(credito.valorOriginal)} · disponível <strong>{brl(credito.saldo)}</strong> ·{' '}
        <SeloCredito status={credito.status} />
      </p>
      {credito.origem === 'AVULSO' && credito.status === 'DISPONIVEL' && !usado && pode('CREDITOS_LANCAR') && (
        <p>
          <button type="button" className="botao botao-perigo" disabled={ocupado} onClick={cancelar}>
            Cancelar este crédito avulso
          </button>
        </p>
      )}
      {!podeUsar && <Erro mensagem={erro} />}
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
              <th />
            </tr>
          </thead>
          <tbody>
            {credito.usos.map((u) => (
              <tr key={u.id} className={u.estornado ? 'linha-inativa' : ''}>
                <td>{dataBr(u.criadoEm)}</td>
                <td>{u.pessoa.nome}</td>
                <td>{u.contaReceber.descricao}</td>
                <td className="num">{brl(u.valor)}</td>
                <td className="num">
                  {u.estornado ? (
                    <Selo valor="Estornado" tom="apagado" />
                  ) : (
                    credito.status !== 'CANCELADO' &&
                    pode('CREDITOS_UTILIZAR') && (
                      <button type="button" className="botao botao-texto" disabled={ocupado} onClick={() => estornarUso(u)}>
                        Estornar
                      </button>
                    )
                  )}
                </td>
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
