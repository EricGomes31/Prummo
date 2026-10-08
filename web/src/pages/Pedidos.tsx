import { useEffect, useState, type FormEvent } from 'react'
import { api, useAcao, useDados } from '../api'
import { brl, dataBr, formasPagamento, hojeIso, inteiro, motivosPerda, naturezasPedido, unidadesDe } from '../format'
import type { Classificacao, ItemEdicao, NaturezaPedido, Pedido, Pessoa, Produto, Promocao } from '../types'
import { Cabecalho, Campo, descontoDosItens, Dinheiro, EditorItens, Erro, EstadoLista, itemVazio, Modal, Selo, totalItens } from '../ui'

export function Pedidos() {
  const [status, setStatus] = useState('')
  const { dados, erro, carregando, recarregar } = useDados<Pedido[]>(`/pedidos${status ? `?status=${status}` : ''}`)
  const [editando, setEditando] = useState<Pedido | 'novo' | null>(null)
  const [vendo, setVendo] = useState<Pedido | null>(null)
  const [faturando, setFaturando] = useState<Pedido | null>(null)
  const pedidos = dados ?? []

  const fecharTudo = () => {
    setEditando(null)
    setVendo(null)
    setFaturando(null)
    recarregar()
  }

  return (
    <>
      <Cabecalho titulo="Pedidos e vendas" descricao="Pedidos em aberto, faturados e cancelados.">
        <button type="button" className="botao botao-primario" onClick={() => setEditando('novo')}>
          Novo pedido
        </button>
      </Cabecalho>

      <div className="filtros">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          <option value="ABERTO">Em aberto</option>
          <option value="FATURADO">Faturados</option>
          <option value="CANCELADO">Cancelados</option>
        </select>
      </div>

      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={pedidos.length === 0} textoVazio="Nenhum pedido encontrado." />
        {pedidos.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Nº</th>
                <th>Natureza</th>
                <th>Data</th>
                <th>Cliente</th>
                <th>Vendedor</th>
                <th>Médico</th>
                <th>Paciente</th>
                <th>Situação</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id}>
                  <td className="texto-suave">#{p.id}</td>
                  <td>{naturezasPedido[p.natureza] ?? p.natureza}</td>
                  <td>{dataBr(p.criadoEm)}</td>
                  <td>{p.cliente.nome}</td>
                  <td>{p.vendedor?.nome ?? '—'}</td>
                  <td>{p.medico?.nome ?? '—'}</td>
                  <td>{p.paciente?.nome ?? '—'}</td>
                  <td><Selo valor={p.status} /></td>
                  <td className="num">{brl(p.total)}</td>
                  <td className="num">
                    {p.status === 'ABERTO' ? (
                      <>
                        <button type="button" className="botao botao-texto" onClick={() => setEditando(p)}>
                          Editar
                        </button>
                        <button type="button" className="botao botao-texto" onClick={() => setFaturando(p)}>
                          {p.natureza === 'VENDA' ? 'Faturar' : 'Confirmar'}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="botao botao-texto" onClick={() => setVendo(p)}>
                        Detalhes
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editando && <FormPedido pedido={editando === 'novo' ? null : editando} onFechar={() => setEditando(null)} onSalvo={fecharTudo} />}
      {faturando && <Faturar pedido={faturando} onFechar={() => setFaturando(null)} onSalvo={fecharTudo} />}
      {vendo && <Detalhes pedidoId={vendo.id} onFechar={() => setVendo(null)} onAlterado={fecharTudo} />}
    </>
  )
}

function FormPedido(props: { pedido: Pedido | null; onFechar: () => void; onSalvo: () => void }) {
  const { pedido } = props
  const produtos = useDados<Produto[]>('/produtos').dados ?? []
  const pessoas = useDados<Pessoa[]>('/pessoas').dados ?? []
  const [clienteId, setClienteId] = useState(pedido?.clienteId ?? 0)
  const [vendedorId, setVendedorId] = useState(pedido?.vendedor?.id ?? 0)
  const [medicoId, setMedicoId] = useState(pedido?.medico?.id ?? 0)
  const [pacienteId, setPacienteId] = useState(pedido?.paciente?.id ?? 0)
  const [natureza, setNatureza] = useState<NaturezaPedido>(pedido?.natureza ?? 'VENDA')
  const [motivoPerda, setMotivoPerda] = useState(pedido?.motivoPerda ?? '')
  const [desconto, setDesconto] = useState(pedido?.desconto ?? 0)
  const [frete, setFrete] = useState(pedido?.frete ?? 0)
  const [observacao, setObservacao] = useState(pedido?.observacao ?? '')
  const [itens, setItens] = useState<ItemEdicao[]>(
    pedido
      ? pedido.itens.map((i) => ({
          produtoId: i.produtoId,
          unidade: i.unidade ?? i.produto.unidade,
          quantidade: i.quantidade,
          valor: i.precoUnitario,
          desconto: i.desconto,
        }))
      : [itemVazio()],
  )
  const { erro, ocupado, executar } = useAcao()
  const venda = natureza === 'VENDA'
  const perda = natureza === 'PERDA'
  const subtotal = perda ? 0 : totalItens(itens)
  const descontoItens = perda ? 0 : descontoDosItens(itens)

  // Pessoas ativas com a classificação pedida, mais a já escolhida mesmo que tenha sido desativada.
  const comClassificacao = (classificacao: Classificacao, escolhida: number) =>
    pessoas.filter((p) => (p[classificacao] && p.ativo) || p.id === escolhida)

  const campanhas = (useDados<Promocao[]>('/promocoes').dados ?? []).filter((c) => c.vigente || c.id === pedido?.promocao?.id)
  const [promocaoId, setPromocaoId] = useState(pedido?.promocao?.id ?? 0)
  const [campanha, setCampanha] = useState({ desconto: pedido?.descontoPromocao ?? 0, aviso: '' })
  // A simulação precisa do fator da unidade de cada item, porque a campanha conta na unidade base.
  const fatorDe = (i: ItemEdicao) => {
    const produto = produtos.find((p) => p.id === i.produtoId)
    return (produto && unidadesDe(produto).find((u) => u.sigla === i.unidade)?.fator) || 1
  }
  const itensParaApi = itens
    .filter((i) => i.produtoId && i.quantidade > 0)
    .map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, precoUnitario: i.valor, fator: fatorDe(i) }))
  const chaveItens = JSON.stringify(itensParaApi)

  // Prévia do desconto da campanha; o valor que vale é o que o servidor calcula ao salvar.
  useEffect(() => {
    if (!promocaoId) return setCampanha({ desconto: 0, aviso: '' })
    let ativo = true
    const espera = setTimeout(() => {
      api<{ desconto: number }>(`/promocoes/${promocaoId}/simular`, { body: { itens: JSON.parse(chaveItens) } })
        .then((r) => ativo && setCampanha({ desconto: r.desconto, aviso: '' }))
        .catch((e: Error) => ativo && setCampanha({ desconto: 0, aviso: e.message }))
    }, 300)
    return () => {
      ativo = false
      clearTimeout(espera)
    }
  }, [promocaoId, chaveItens])

  // A campanha não acumula com desconto manual, nem no total nem nos itens.
  function escolherCampanha(id: number) {
    setPromocaoId(id)
    if (id) {
      setDesconto(0)
      setItens(itens.map((i) => ({ ...i, desconto: 0 })))
    }
  }

  // Só a venda aceita campanha e frete.
  function escolherNatureza(nova: NaturezaPedido) {
    setNatureza(nova)
    if (nova !== 'VENDA') {
      setPromocaoId(0)
      setFrete(0)
    }
    if (nova !== 'PERDA') setMotivoPerda('')
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const corpo = {
        clienteId,
        vendedorId: vendedorId || null,
        medicoId: medicoId || null,
        pacienteId: pacienteId || null,
        natureza,
        motivoPerda: perda ? motivoPerda || null : null,
        promocaoId: venda ? promocaoId || null : null,
        desconto: perda ? 0 : desconto,
        frete: venda ? frete : 0,
        observacao,
        itens: itens.map((i) => ({
          produtoId: i.produtoId,
          unidade: i.unidade,
          quantidade: i.quantidade,
          precoUnitario: perda ? 0 : i.valor,
          desconto: perda ? 0 : (i.desconto ?? 0),
        })),
      }
      await api(pedido ? `/pedidos/${pedido.id}` : '/pedidos', { method: pedido ? 'PUT' : 'POST', body: corpo })
      props.onSalvo()
    })
  }

  function cancelar() {
    if (!pedido || !window.confirm(`Cancelar o pedido nº ${pedido.id}?`)) return
    executar(async () => {
      await api(`/pedidos/${pedido.id}/cancelar`, { method: 'POST' })
      props.onSalvo()
    })
  }

  const seletorPessoa = (rotulo: string, classificacao: Classificacao, valor: number, onChange: (id: number) => void) => (
    <Campo rotulo={`${rotulo} (opcional)`}>
      <select value={valor || ''} onChange={(e) => onChange(Number(e.target.value))}>
        <option value="">—</option>
        {comClassificacao(classificacao, valor).map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
    </Campo>
  )

  return (
    <Modal titulo={pedido ? `Pedido nº ${pedido.id}` : 'Novo pedido'} onFechar={props.onFechar} largo>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Cliente" largura={2}>
          <select required value={clienteId || ''} onChange={(e) => setClienteId(Number(e.target.value))}>
            <option value="">Selecione…</option>
            {comClassificacao('cliente', clienteId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Natureza da operação">
          <select value={natureza} onChange={(e) => escolherNatureza(e.target.value as NaturezaPedido)}>
            {Object.entries(naturezasPedido).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </Campo>

        {seletorPessoa('Vendedor', 'vendedor', vendedorId, setVendedorId)}
        {seletorPessoa('Médico', 'medico', medicoId, setMedicoId)}
        {seletorPessoa('Paciente', 'paciente', pacienteId, setPacienteId)}

        {venda && (
          <Campo rotulo="Campanha">
            <select value={promocaoId} onChange={(e) => escolherCampanha(Number(e.target.value))}>
              <option value={0}>Sem campanha</option>
              {campanhas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}
        {perda && (
          <Campo rotulo="Motivo da perda">
            <select required value={motivoPerda} onChange={(e) => setMotivoPerda(e.target.value)}>
              <option value="">Selecione…</option>
              {Object.entries(motivosPerda).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </Campo>
        )}
        {!venda && (
          <p className="texto-suave col-3">
            {perda
              ? 'A perda só baixa o estoque dos itens: não tem preço nem gera contas a receber.'
              : 'A bonificação baixa o estoque dos itens e não gera contas a receber nem entra no faturamento.'}
          </p>
        )}

        <div className="col-3">
          <EditorItens
            produtos={produtos}
            itens={itens}
            onChange={setItens}
            campoPreco="precoVenda"
            rotuloValor="Preço unit."
            mostrarSaldo
            comDesconto={!promocaoId}
            semValores={perda}
          />
        </div>

        <Campo rotulo={perda && motivoPerda === 'OUTROS' ? 'Observação (descreva o motivo)' : 'Observação'}>
          <input required={perda && motivoPerda === 'OUTROS'} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </Campo>
        {!perda && (
          <Campo rotulo={promocaoId ? 'Desconto (não acumula com campanha)' : 'Desconto no total (R$)'}>
            <Dinheiro valor={desconto} onChange={setDesconto} disabled={promocaoId > 0} />
          </Campo>
        )}
        {venda && (
          <Campo rotulo="Frete (R$)">
            <Dinheiro valor={frete} onChange={setFrete} />
          </Campo>
        )}

        {campanha.aviso && <p className="texto-ruim col-3">{campanha.aviso}</p>}
        {!perda && (
          <p className="total col-3">
            Subtotal {brl(subtotal)}
            {descontoItens > 0 && ` · Descontos nos itens −${brl(descontoItens)}`}
            {campanha.desconto > 0 && ` · Campanha −${brl(campanha.desconto)}`} · Total{' '}
            <strong>{brl(Math.max(0, subtotal - descontoItens - desconto - campanha.desconto) + frete)}</strong>
          </p>
        )}
        <Erro mensagem={erro} />
        <div className="form-pe">
          {pedido && (
            <button type="button" className="botao botao-perigo empurra" onClick={cancelar} disabled={ocupado}>
              Cancelar pedido
            </button>
          )}
          <button type="button" className="botao" onClick={props.onFechar}>
            Fechar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            Salvar pedido
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Faturar(props: { pedido: Pedido; onFechar: () => void; onSalvo: () => void }) {
  const { pedido } = props
  const venda = pedido.natureza === 'VENDA'
  const [parcelas, setParcelas] = useState(1)
  const [primeiroVencimento, setPrimeiroVencimento] = useState(hojeIso())
  const [formaPagamento, setFormaPagamento] = useState('')
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      await api(`/pedidos/${pedido.id}/faturar`, { body: venda ? { parcelas, primeiroVencimento, formaPagamento } : {} })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={`${venda ? 'Faturar' : 'Confirmar'} pedido nº ${pedido.id}`} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <p className="col-3">
          {pedido.cliente.nome} · {naturezasPedido[pedido.natureza]} · <strong>{brl(pedido.total)}</strong>
        </p>
        {venda && (
          <>
            <Campo rotulo="Forma de pagamento" largura={3}>
              <select required autoFocus value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)}>
                <option value="">Selecione…</option>
                {Object.entries(formasPagamento).map(([valor, rotulo]) => (
                  <option key={valor} value={valor}>
                    {rotulo}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Parcelas">
              <input type="number" min={1} max={24} required value={parcelas} onChange={(e) => setParcelas(Math.max(1, inteiro(e.target.value)))} />
            </Campo>
            <Campo rotulo="Primeiro vencimento" largura={2}>
              <input type="date" required value={primeiroVencimento} onChange={(e) => setPrimeiroVencimento(e.target.value)} />
            </Campo>
          </>
        )}
        <p className="texto-suave col-3">
          {venda
            ? `Faturar baixa o estoque dos itens e gera ${parcelas} parcela(s) mensal(is) em contas a receber.`
            : 'Confirmar baixa o estoque dos itens. Não são geradas contas a receber.'}
        </p>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Voltar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            {venda ? 'Faturar' : 'Confirmar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Detalhes(props: { pedidoId: number; onFechar: () => void; onAlterado: () => void }) {
  const { dados: pedido, erro: erroCarga, carregando } = useDados<Pedido>(`/pedidos/${props.pedidoId}`)
  const { erro, ocupado, executar } = useAcao()

  function cancelar() {
    if (!window.confirm('Cancelar este pedido? O estoque volta e as parcelas em aberto são canceladas.')) return
    executar(async () => {
      await api(`/pedidos/${props.pedidoId}/cancelar`, { method: 'POST' })
      props.onAlterado()
    })
  }

  const temDescontoNosItens = pedido?.itens.some((i) => i.desconto > 0)

  return (
    <Modal titulo={`Pedido nº ${props.pedidoId}`} onFechar={props.onFechar} largo>
      <EstadoLista carregando={carregando} erro={erroCarga} vazia={!pedido} textoVazio="" />
      {pedido && (
        <>
          <p>
            {pedido.cliente.nome} · {naturezasPedido[pedido.natureza] ?? pedido.natureza} · <Selo valor={pedido.status} />
            {pedido.faturadoEm && <span className="texto-suave"> · faturado em {dataBr(pedido.faturadoEm)}</span>}
          </p>
          <p className="texto-suave">
            {[
              pedido.vendedor && `Vendedor: ${pedido.vendedor.nome}`,
              pedido.medico && `Médico: ${pedido.medico.nome}`,
              pedido.paciente && `Paciente: ${pedido.paciente.nome}`,
              pedido.motivoPerda && `Motivo da perda: ${motivosPerda[pedido.motivoPerda] ?? pedido.motivoPerda}`,
              pedido.formaPagamento && `Pagamento: ${formasPagamento[pedido.formaPagamento] ?? pedido.formaPagamento}`,
              pedido.usuario && `Lançado por: ${pedido.usuario.nome}`,
              pedido.observacao,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Qtd.</th>
                <th className="num">Preço unit.</th>
                {temDescontoNosItens && <th className="num">Desc. unit.</th>}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {pedido.itens.map((i) => (
                <tr key={i.id}>
                  <td>{i.produto.nome}</td>
                  <td className="num">{i.quantidade} {i.unidade ?? i.produto.unidade}</td>
                  <td className="num">{brl(i.precoUnitario)}</td>
                  {temDescontoNosItens && <td className="num">{i.desconto > 0 ? `−${brl(i.desconto)}` : '—'}</td>}
                  <td className="num">{brl(i.quantidade * (i.precoUnitario - i.desconto))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="total">
            Subtotal {brl(pedido.subtotal)}
            {pedido.descontoItens > 0 && ` · Descontos nos itens ${brl(pedido.descontoItens)}`} · Desconto {brl(pedido.desconto)}
            {pedido.promocao && ` · Campanha "${pedido.promocao.nome}" −${brl(pedido.descontoPromocao)}`} · Frete {brl(pedido.frete)} · Total <strong>{brl(pedido.total)}</strong>
          </p>

          {pedido.contasReceber && pedido.contasReceber.length > 0 && (
            <>
              <h3>Parcelas</h3>
              <table>
                <tbody>
                  {pedido.contasReceber.map((c) => (
                    <tr key={c.id}>
                      <td>{c.descricao}</td>
                      <td>{dataBr(c.vencimento)}</td>
                      <td><Selo valor={c.status} /></td>
                      <td className="num">{brl(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <Erro mensagem={erro} />
          <div className="form-pe">
            {pedido.status === 'FATURADO' && (
              <button type="button" className="botao botao-perigo empurra" onClick={cancelar} disabled={ocupado}>
                Cancelar pedido
              </button>
            )}
            <button type="button" className="botao" onClick={props.onFechar}>
              Fechar
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
