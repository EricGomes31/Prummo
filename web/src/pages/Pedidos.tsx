import { useEffect, useState, type FormEvent } from 'react'
import { api, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import { Documentos } from '../Documentos'
import { consultarCep } from '../cep'
import { brl, cepBr, dataBr, formasPagamento, hojeIso, inteiro, mascaraCep, motivosPerda, naturezasPedido, unidadesDe } from '../format'
import type { Classificacao, Credito, EnderecoEntrega, ItemEdicao, NaturezaPedido, Pedido, Pessoa, PreviaAlteracao, Produto, Promocao } from '../types'
import { Cabecalho, Campo, descontoDosItens, Dinheiro, EditorItens, Erro, EstadoLista, itemVazio, Modal, Selo, totalItens, useAtrasado, usePaginacao } from '../ui'
import { CampoData } from '../calendario'
import { Escolha, opcoesDePessoas } from '../escolha'
import { dividirParcelas, somaParcelas, TabelaParcelas, type Parcela } from '../parcelas'
import { useSearchParams } from 'react-router-dom'

// "Rua, número, complemento — bairro, cidade/UF, CEP", com o que houver preenchido.
type PartesEndereco = Partial<Pick<EnderecoEntrega, 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf' | 'cep'>>
function enderecoTexto(e: { [K in keyof PartesEndereco]?: string | null }) {
  const rua = [e.logradouro, e.numero, e.complemento].filter(Boolean).join(', ')
  const lugar = [e.bairro, [e.cidade, e.uf].filter(Boolean).join('/'), cepBr(e.cep)].filter(Boolean).join(', ')
  return [rua, lugar].filter(Boolean).join(' — ')
}

// O mesmo limite da API: a lista traz no máximo esse tanto, dos mais recentes.
const LIMITE_LISTA = 300

export function Pedidos() {
  // Vindo de outra tela (o dashboard), "?abrir=<id>" já abre os detalhes desse pedido.
  const [parametros, setParametros] = useSearchParams()
  const abrir = Number(parametros.get('abrir')) || 0
  const [filtro, setFiltro] = useState({ status: '', busca: '', inicio: '', fim: '' })
  const busca = useAtrasado(filtro.busca.trim())
  const consulta = new URLSearchParams(
    Object.entries({ status: filtro.status, busca, inicio: filtro.inicio, fim: filtro.fim }).filter(([, v]) => v),
  ).toString()
  const { dados, erro, carregando, recarregar } = useDados<Pedido[]>(`/pedidos${consulta ? `?${consulta}` : ''}`)
  const filtrando = !!(busca || filtro.inicio || filtro.fim)
  const [editando, setEditando] = useState<Pedido | 'novo' | null>(null)
  const [vendo, setVendo] = useState<Pedido | null>(abrir ? ({ id: abrir } as Pedido) : null)
  const [faturando, setFaturando] = useState<Pedido | null>(null)
  const pedidos = dados ?? []
  const paginas = usePaginacao(pedidos)
  const { pode } = useSessao()

  const fecharTudo = () => {
    setEditando(null)
    setVendo(null)
    setFaturando(null)
    recarregar()
  }

  return (
    <>
      <Cabecalho titulo="Pedidos e vendas" descricao="Pedidos em aberto, faturados e cancelados.">
        {pode('PEDIDOS_CADASTRAR') && (
          <button type="button" className="botao botao-primario" onClick={() => setEditando('novo')}>
            Novo pedido
          </button>
        )}
      </Cabecalho>

      <div className="filtros">
        <input
          type="search"
          value={filtro.busca}
          onChange={(e) => setFiltro({ ...filtro, busca: e.target.value })}
          placeholder="Número, cliente, vendedor, médico ou paciente"
          aria-label="Buscar pedido"
        />
        <select value={filtro.status} onChange={(e) => setFiltro({ ...filtro, status: e.target.value })} aria-label="Situação">
          <option value="">Todas as situações</option>
          <option value="ABERTO">Em aberto</option>
          <option value="FATURADO">Faturados</option>
          <option value="CANCELADO">Cancelados</option>
        </select>
        <CampoData type="date" className="filtro-data" value={filtro.inicio} max={filtro.fim || undefined} aria-label="Vendas a partir de"
          onChange={(e) => setFiltro({ ...filtro, inicio: e.target.value })} />
        <CampoData type="date" className="filtro-data" value={filtro.fim} min={filtro.inicio || undefined} aria-label="Vendas até"
          onChange={(e) => setFiltro({ ...filtro, fim: e.target.value })} />
        {filtrando && (
          <button type="button" className="botao botao-texto" onClick={() => setFiltro({ ...filtro, busca: '', inicio: '', fim: '' })}>
            Limpar
          </button>
        )}
      </div>
      {pedidos.length >= LIMITE_LISTA && (
        <p className="aviso-lista">
          Mostrando os {LIMITE_LISTA} pedidos mais recentes{filtrando ? ' que atendem à busca' : ''}. Para achar outros, busque pelo número ou pelo cliente, ou escolha um período.
        </p>
      )}

      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={pedidos.length === 0} textoVazio={filtrando ? 'Nenhum pedido atende à busca.' : 'Nenhum pedido encontrado.'} />
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
              {paginas.visiveis.map((p) => (
                <tr key={p.id}>
                  <td className="texto-suave">#{p.numero}</td>
                  <td>{naturezasPedido[p.natureza] ?? p.natureza}</td>
                  <td>{dataBr(p.data)}</td>
                  <td>{p.cliente.nome}</td>
                  <td>{p.vendedor?.nome ?? '—'}</td>
                  <td>{p.medico?.nome ?? '—'}</td>
                  <td>{p.paciente?.nome ?? '—'}</td>
                  <td><Selo valor={p.status} /></td>
                  <td className="num">{brl(p.total)}</td>
                  <td className="num">
                    {p.status === 'ABERTO' && pode('PEDIDOS_CADASTRAR') && (
                      <button type="button" className="botao botao-texto" onClick={() => setEditando(p)}>
                        Editar
                      </button>
                    )}
                    {p.status === 'ABERTO' && pode('PEDIDOS_FATURAR') && (
                      <button type="button" className="botao botao-texto" onClick={() => setFaturando(p)}>
                        {p.natureza === 'VENDA' ? 'Faturar' : 'Confirmar'}
                      </button>
                    )}
                    {/* Em aberto, quem não pode editar vê os detalhes, como num pedido fechado. */}
                    {(p.status !== 'ABERTO' || !pode('PEDIDOS_CADASTRAR')) && (
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
        {paginas.controle}
      </section>

      {editando && (
        <FormPedido
          pedido={editando === 'novo' ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={(salvo, faturar) => {
            fecharTudo()
            // "Salvar e faturar": o pedido gravado segue direto para a janela de faturamento.
            if (faturar && salvo) setFaturando(salvo)
          }}
        />
      )}
      {faturando && <Faturar pedido={faturando} onFechar={() => setFaturando(null)} onSalvo={fecharTudo} />}
      {vendo && (
        <Detalhes
          pedidoId={vendo.id}
          onFechar={() => {
            setVendo(null)
            if (parametros.has('abrir')) setParametros({}, { replace: true })
          }}
          onAlterado={fecharTudo}
          onAlterar={(p) => {
            setVendo(null)
            setEditando(p)
          }}
        />
      )}
    </>
  )
}

function FormPedido(props: { pedido: Pedido | null; onFechar: () => void; onSalvo: (salvo?: Pedido, faturar?: boolean) => void }) {
  const { pedido } = props
  const { pode } = useSessao()
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
  const [formaPagamento, setFormaPagamento] = useState(pedido?.formaPagamento ?? '')
  const [parcelas, setParcelas] = useState(pedido?.parcelas ?? 1)
  const [primeiroVencimento, setPrimeiroVencimento] = useState(pedido?.primeiroVencimento?.slice(0, 10) ?? '')
  // Endereço de entrega diferente do cadastro do cliente; null = o do cliente.
  const [endereco, setEndereco] = useState<EnderecoEntrega | null>(pedido?.enderecoEntrega ?? null)
  const trocarEndereco = (parte: Partial<EnderecoEntrega>) => setEndereco((atual) => (atual ? { ...atual, ...parte } : atual))
  async function completarPeloCep() {
    const achado = await consultarCep(endereco?.cep)
    if (achado) setEndereco((atual) => atual && { ...atual, logradouro: atual.logradouro || achado.logradouro, bairro: atual.bairro || achado.bairro, cidade: achado.cidade, uf: achado.uf })
  }
  // Data da venda: hoje, por padrão; pode ser anterior (venda lançada depois), nunca futura.
  const [dataVenda, setDataVenda] = useState(pedido ? new Date(pedido.data).toLocaleDateString('sv-SE') : hojeIso())
  // Parcelas com data e valor escolhidos à mão; null = mensais iguais.
  const [vencimentos, setVencimentos] = useState<Parcela[] | null>(pedido?.vencimentos ?? null)
  // Pedido faturado: alterar itens, valores ou pagamento refaz o faturamento.
  const faturado = pedido?.status === 'FATURADO'
  const podeFaturar = !faturado && pode('PEDIDOS_FATURAR')
  // Pedido faturado: a alteração pede o motivo e passa por uma conferência antes de gravar.
  const [motivo, setMotivo] = useState('')
  const [conferencia, setConferencia] = useState<{ previa: PreviaAlteracao; corpo: object } | null>(null)
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

  const clienteEscolhido = pessoas.find((p) => p.id === clienteId)

  // Pessoas ativas com a classificação pedida, mais a já escolhida mesmo que tenha sido desativada.
  const comClassificacao = (classificacao: Classificacao, escolhida: number) =>
    pessoas.filter((p) => (p[classificacao] && p.ativo) || p.id === escolhida)

  const campanhas = (useDados<Promocao[]>('/promocoes').dados ?? []).filter((c) => c.vigente || c.id === pedido?.promocao?.id)
  const [promocaoId, setPromocaoId] = useState(pedido?.promocao?.id ?? 0)
  const [campanha, setCampanha] = useState({ desconto: pedido?.descontoPromocao ?? 0, aviso: '' })
  const totalPedido = perda ? 0 : Math.max(0, subtotal - descontoItens - desconto - campanha.desconto) + frete
  // Parcelas à mão que não fecham o total impedem de salvar (o faturamento recusaria).
  const parcelasNaoFecham = venda && !!vencimentos && somaParcelas(vencimentos) !== totalPedido
  // Os produtos da campanha escolhida não aceitam desconto manual; os demais aceitam.
  const produtosDaCampanha = (id: number) => new Set((campanhas.find((c) => c.id === id)?.itens ?? []).map((i) => i.produtoId))
  const participantes = produtosDaCampanha(promocaoId)
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

  // A campanha não acumula com o desconto no total nem com desconto nos produtos dela.
  function escolherCampanha(id: number) {
    setPromocaoId(id)
    if (id) {
      const daCampanha = produtosDaCampanha(id)
      setDesconto(0)
      setItens(itens.map((i) => (daCampanha.has(i.produtoId) ? { ...i, desconto: 0 } : i)))
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
    // Qual botão enviou: "Salvar e faturar" leva o pedido salvo direto ao faturamento.
    const faturarDepois = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('data-faturar') === 'sim'
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
        data: dataVenda,
        enderecoEntrega: perda ? null : endereco,
        formaPagamento: venda ? formaPagamento || null : null,
        parcelas: venda ? parcelas : 1,
        primeiroVencimento: venda ? primeiroVencimento || null : null,
        vencimentos: venda ? vencimentos : null,
        itens: itens.map((i) => ({
          produtoId: i.produtoId,
          unidade: i.unidade,
          quantidade: i.quantidade,
          precoUnitario: perda ? 0 : i.valor,
          desconto: perda ? 0 : (i.desconto ?? 0),
        })),
      }
      if (pedido && faturado) {
        // Primeiro a conferência: o servidor simula a alteração e devolve o que vai mudar.
        const previa = await api<PreviaAlteracao>(`/pedidos/${pedido.id}/faturado/conferir`, { body: corpo })
        setConferencia({ previa, corpo })
        return
      }
      const caminho = !pedido ? '/pedidos' : `/pedidos/${pedido.id}`
      const salvo = await api<Pedido>(caminho, { method: pedido ? 'PUT' : 'POST', body: corpo })
      props.onSalvo(salvo, faturarDepois)
    })
  }

  function confirmarAlteracao() {
    if (!pedido || !conferencia) return
    executar(async () => {
      const salvo = await api<Pedido>(`/pedidos/${pedido.id}/faturado`, { method: 'PUT', body: { ...conferencia.corpo, motivo } })
      setConferencia(null)
      props.onSalvo(salvo)
    })
  }

  function cancelar() {
    if (!pedido) return
    const motivoCancelamento = window.prompt(`Cancelar o pedido nº ${pedido.numero}? Se quiser, informe o motivo:`)
    if (motivoCancelamento === null) return
    executar(async () => {
      await api(`/pedidos/${pedido.id}/cancelar`, { body: { motivo: motivoCancelamento || null } })
      props.onSalvo()
    })
  }

  const seletorPessoa = (rotulo: string, classificacao: Classificacao, valor: number, onChange: (id: number) => void) => (
    <Campo rotulo={`${rotulo} (opcional)`}>
      <Escolha opcoes={opcoesDePessoas(comClassificacao(classificacao, valor))} valor={valor} onChange={onChange} nenhum="Nenhum" />
    </Campo>
  )

  return (
    <Modal titulo={pedido ? `Pedido nº ${pedido.numero}` : 'Novo pedido'} onFechar={props.onFechar} largo>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Cliente" largura={2}>
          <Escolha required opcoes={opcoesDePessoas(comClassificacao('cliente', clienteId))} valor={clienteId} onChange={setClienteId} placeholder="Digite o nome, documento ou telefone…" />
        </Campo>
        <Campo rotulo="Data da venda">
          <CampoData type="date" required max={hojeIso()} value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} />
        </Campo>
        <Campo rotulo="Natureza da operação">
          <select value={natureza} disabled={faturado} onChange={(e) => escolherNatureza(e.target.value as NaturezaPedido)}>
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
            comDesconto
            semDescontoEm={promocaoId ? participantes : undefined}
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
        {venda && (
          <>
            <Campo rotulo={faturado ? 'Forma de pagamento' : 'Forma de pagamento (opcional)'}>
              <select required={faturado} value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)}>
                <option value="">{faturado ? 'Selecione…' : 'Definir ao faturar'}</option>
                {Object.entries(formasPagamento).map(([valor, rotulo]) => (
                  <option key={valor} value={valor}>
                    {rotulo}
                  </option>
                ))}
              </select>
            </Campo>
            {!vencimentos && (
              <>
                <Campo rotulo="Parcelas">
                  <input type="number" min={1} max={24} required value={parcelas} onChange={(e) => setParcelas(Math.min(24, Math.max(1, inteiro(e.target.value))))} />
                </Campo>
                <Campo rotulo={faturado ? 'Primeiro vencimento' : 'Primeiro vencimento (opcional)'}>
                  <CampoData type="date" required={faturado} value={primeiroVencimento} onChange={(e) => setPrimeiroVencimento(e.target.value)} />
                </Campo>
              </>
            )}
            <label className="marcar col-3">
              <input
                type="checkbox"
                checked={!!vencimentos}
                onChange={(e) => setVencimentos(e.target.checked ? dividirParcelas(totalPedido, parcelas, primeiroVencimento || undefined) : null)}
              />
              Escolher a data e o valor de cada parcela
            </label>
            {vencimentos && (
              <div className="col-3">
                <TabelaParcelas parcelas={vencimentos} onChange={setVencimentos} total={totalPedido} rotuloTotal="o total do pedido" />
              </div>
            )}
          </>
        )}

        {!perda && (
          <>
            <label className="marcar col-3">
              <input
                type="checkbox"
                checked={!!endereco}
                onChange={(e) =>
                  setEndereco(e.target.checked ? { cep: null, logradouro: '', numero: null, complemento: null, bairro: null, cidade: '', uf: null, referencia: null } : null)
                }
              />
              Entregar em outro endereço, não no do cadastro do cliente
            </label>
            {!endereco && clienteEscolhido && (
              <p className="texto-suave col-3">
                {enderecoTexto(clienteEscolhido) ? `Entrega em: ${enderecoTexto(clienteEscolhido)}` : 'O cliente não tem endereço no cadastro. Marque acima para informar onde entregar.'}
              </p>
            )}
            {endereco && (
              <>
                <Campo rotulo="CEP">
                  <input inputMode="numeric" value={mascaraCep(endereco.cep ?? '')} onChange={(e) => trocarEndereco({ cep: e.target.value })} onBlur={completarPeloCep} />
                </Campo>
                <Campo rotulo="Rua" largura={2}>
                  <input required value={endereco.logradouro} onChange={(e) => trocarEndereco({ logradouro: e.target.value })} />
                </Campo>
                <Campo rotulo="Número">
                  <input value={endereco.numero ?? ''} onChange={(e) => trocarEndereco({ numero: e.target.value })} />
                </Campo>
                <Campo rotulo="Complemento">
                  <input value={endereco.complemento ?? ''} onChange={(e) => trocarEndereco({ complemento: e.target.value })} />
                </Campo>
                <Campo rotulo="Bairro">
                  <input value={endereco.bairro ?? ''} onChange={(e) => trocarEndereco({ bairro: e.target.value })} />
                </Campo>
                <Campo rotulo="Cidade" largura={2}>
                  <input required value={endereco.cidade} onChange={(e) => trocarEndereco({ cidade: e.target.value })} />
                </Campo>
                <Campo rotulo="UF">
                  <input maxLength={2} value={endereco.uf ?? ''} onChange={(e) => trocarEndereco({ uf: e.target.value.toUpperCase() })} />
                </Campo>
                <Campo rotulo="Referência para a entrega" largura={3}>
                  <input value={endereco.referencia ?? ''} onChange={(e) => trocarEndereco({ referencia: e.target.value })} placeholder="Ex.: portão azul, ao lado da farmácia" />
                </Campo>
              </>
            )}
          </>
        )}

        {campanha.aviso && <p className="texto-ruim col-3">{campanha.aviso}</p>}
        {!perda && (
          <p className="total col-3">
            Subtotal {brl(subtotal)}
            {descontoItens > 0 && ` · Descontos nos itens −${brl(descontoItens)}`}
            {campanha.desconto > 0 && ` · Campanha −${brl(campanha.desconto)}`} · Total{' '}
            <strong>{brl(totalPedido)}</strong>
          </p>
        )}
        {faturado && (
          <p className="texto-suave col-3">
            Pedido já faturado. Cliente, vendedor, médico, paciente e observação mudam direto. Mudar itens, valores ou pagamento refaz o
            faturamento: o estoque volta, as parcelas em aberto dão lugar às novas e o estoque é baixado de novo. Para isso, nada pode ter
            sido recebido nem devolvido.
          </p>
        )}
        {pedido && (
          <div className="col-3">
            <h3>Anexos</h3>
            <Documentos origem="PEDIDO" origemId={pedido.id} />
          </div>
        )}
        {faturado && (
          <Campo rotulo="Motivo da alteração" largura={3}>
            <textarea
              required
              minLength={3}
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: correção de quantidade, troca de produto, ajuste de preço…"
            />
          </Campo>
        )}
        <Erro mensagem={conferencia ? '' : erro} />
        <div className="form-pe">
          {pedido && !faturado && pode('PEDIDOS_CANCELAR') && (
            <button type="button" className="botao botao-perigo empurra" onClick={cancelar} disabled={ocupado}>
              Cancelar pedido
            </button>
          )}
          <button type="button" className="botao" onClick={props.onFechar}>
            Fechar
          </button>
          {/* Com permissão de faturar, o caminho mais comum (salvar e já faturar) é o botão principal. */}
          <button className={`botao ${podeFaturar ? '' : 'botao-primario'}`} disabled={ocupado || parcelasNaoFecham}>
            {faturado ? 'Revisar alterações' : podeFaturar ? 'Só salvar' : 'Salvar pedido'}
          </button>
          {podeFaturar && (
            <button className="botao botao-primario" data-faturar="sim" disabled={ocupado || parcelasNaoFecham}>
              {venda ? 'Salvar e faturar' : 'Salvar e confirmar'}
            </button>
          )}
        </div>
      </form>
      {conferencia && pedido && (
        <Modal titulo={`Conferência final · pedido nº ${pedido.numero}`} onFechar={() => setConferencia(null)}>
          <div className="indicadores em-3">
            <div className="indicador">
              <span>Total anterior</span>
              <strong>{brl(conferencia.previa.totalAnterior)}</strong>
            </div>
            <div className="indicador">
              <span>Novo total</span>
              <strong>{brl(conferencia.previa.totalNovo)}</strong>
            </div>
            <div className="indicador">
              <span>Diferença</span>
              <strong className={conferencia.previa.totalNovo < conferencia.previa.totalAnterior ? 'texto-ruim' : undefined}>
                {conferencia.previa.totalNovo >= conferencia.previa.totalAnterior ? '+' : '−'}
                {brl(Math.abs(conferencia.previa.totalNovo - conferencia.previa.totalAnterior))}
              </strong>
            </div>
          </div>
          <h3>O que muda</h3>
          <ul className="lista-mudancas">
            {conferencia.previa.mudancas.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {conferencia.previa.refaz && (
            <p className="aviso-alerta">
              Ao confirmar, o estoque dos itens volta e é baixado de novo, e as parcelas em aberto dão lugar às novas. Valores já recebidos impedem a alteração.
            </p>
          )}
          <p className="texto-suave">Motivo: {motivo}</p>
          <Erro mensagem={erro} />
          <div className="form-pe">
            <button type="button" className="botao" onClick={() => setConferencia(null)}>
              Voltar e editar
            </button>
            <button type="button" className="botao botao-primario" onClick={confirmarAlteracao} disabled={ocupado}>
              Confirmar e salvar
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

const tiposHistorico: Record<string, string> = {
  CRIADO: 'Lançado',
  ALTERADO: 'Alterado',
  FATURADO: 'Faturado',
  ALTERADO_FATURADO: 'Alterado depois de faturado',
  CANCELADO: 'Cancelado',
}

function Faturar(props: { pedido: Pedido; onFechar: () => void; onSalvo: () => void }) {
  const { pedido } = props
  const venda = pedido.natureza === 'VENDA'
  // A condição escolhida no pedido já vem preenchida.
  const [parcelas, setParcelas] = useState(pedido.parcelas || 1)
  const [primeiroVencimento, setPrimeiroVencimento] = useState(pedido.primeiroVencimento?.slice(0, 10) ?? hojeIso())
  const [formaPagamento, setFormaPagamento] = useState(pedido.formaPagamento ?? '')
  // As parcelas à mão escolhidas no pedido já vêm preenchidas e podem ser ajustadas aqui.
  const [vencimentos, setVencimentos] = useState<Parcela[] | null>(pedido.vencimentos ?? null)
  const parcelasNaoFecham = !!vencimentos && somaParcelas(vencimentos) !== pedido.total
  const { erro, ocupado, executar } = useAcao()
  // Créditos que o cliente pode usar; o valor escolhido de cada um abate as parcelas geradas.
  const { pode } = useSessao()
  const usaCredito = venda && pode('CREDITOS_UTILIZAR')
  const disponiveis = useDados<Credito[]>(usaCredito ? `/creditos?status=DISPONIVEL&pessoaId=${pedido.clienteId}` : null).dados ?? []
  const [usoCreditos, setUsoCreditos] = useState<Record<number, number>>({})
  const totalCreditos = Object.values(usoCreditos).reduce((s, v) => s + v, 0)

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const creditos = Object.entries(usoCreditos)
        .filter(([, valor]) => valor > 0)
        .map(([creditoId, valor]) => ({ creditoId: Number(creditoId), valor }))
      await api(`/pedidos/${pedido.id}/faturar`, { body: venda ? { parcelas, primeiroVencimento, formaPagamento, vencimentos, creditos } : {} })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={`${venda ? 'Faturar' : 'Confirmar'} pedido nº ${pedido.numero}`} onFechar={props.onFechar}>
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
            {!vencimentos && (
              <>
                <Campo rotulo="Parcelas">
                  <input type="number" min={1} max={24} required value={parcelas} onChange={(e) => setParcelas(Math.min(24, Math.max(1, inteiro(e.target.value))))} />
                </Campo>
                <Campo rotulo="Primeiro vencimento" largura={2}>
                  <CampoData type="date" required value={primeiroVencimento} onChange={(e) => setPrimeiroVencimento(e.target.value)} />
                </Campo>
              </>
            )}
            <label className="marcar col-3">
              <input
                type="checkbox"
                checked={!!vencimentos}
                onChange={(e) => setVencimentos(e.target.checked ? dividirParcelas(pedido.total, parcelas, primeiroVencimento || undefined) : null)}
              />
              Escolher a data e o valor de cada parcela
            </label>
            {vencimentos && (
              <div className="col-3">
                <TabelaParcelas parcelas={vencimentos} onChange={setVencimentos} total={pedido.total} rotuloTotal="o total do pedido" />
              </div>
            )}
          </>
        )}
        {disponiveis.length > 0 && (
          <div className="col-3">
            <h3>Usar crédito do cliente</h3>
            <table>
              <tbody>
                {disponiveis.map((c) => (
                  <tr key={c.id}>
                    <td>
                      Crédito nº {c.id}
                      <small className="bloco texto-suave">
                        {c.devolucao ? `Devolução nº ${c.devolucao.id}` : c.origem === 'DEPOSITO' ? 'Depósito a maior' : (c.descricao ?? 'Avulso')} · disponível {brl(c.saldo)}
                      </small>
                    </td>
                    <td className="num">
                      <Dinheiro
                        className="curto"
                        aria-label={`Valor do crédito nº ${c.id} a usar`}
                        valor={usoCreditos[c.id] ?? 0}
                        onChange={(valor) => setUsoCreditos({ ...usoCreditos, [c.id]: Math.min(valor, c.saldo) })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="botao botao-texto"
                        onClick={() => setUsoCreditos({ ...usoCreditos, [c.id]: Math.min(c.saldo, Math.max(0, pedido.total - totalCreditos + (usoCreditos[c.id] ?? 0))) })}
                      >
                        Usar o máximo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalCreditos > pedido.total && <p className="texto-ruim">Os créditos passam do total do pedido.</p>}
          </div>
        )}
        <p className="texto-suave col-3">
          {venda
            ? `Faturar baixa o estoque dos itens e gera ${vencimentos ? `${vencimentos.length} parcela(s), nas datas escolhidas,` : `${parcelas} parcela(s) mensal(is)`} em contas a receber.${totalCreditos > 0 ? ` ${brl(totalCreditos)} de crédito abatem as parcelas, da primeira para a última.` : ''}`
            : 'Confirmar baixa o estoque dos itens. Não são geradas contas a receber.'}
        </p>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Voltar
          </button>
          <button className="botao botao-primario" disabled={ocupado || totalCreditos > pedido.total || parcelasNaoFecham}>
            {venda ? 'Faturar' : 'Confirmar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Detalhes(props: { pedidoId: number; onFechar: () => void; onAlterado: () => void; onAlterar: (pedido: Pedido) => void }) {
  const { dados: pedido, erro: erroCarga, carregando } = useDados<Pedido>(`/pedidos/${props.pedidoId}`)
  const { pode } = useSessao()
  const { erro, ocupado, executar } = useAcao()

  function cancelar() {
    const motivo = window.prompt('Cancelar este pedido? O estoque volta e as parcelas em aberto são canceladas. Se quiser, informe o motivo:')
    if (motivo === null) return
    executar(async () => {
      await api(`/pedidos/${props.pedidoId}/cancelar`, { body: { motivo: motivo || null } })
      props.onAlterado()
    })
  }

  const temDescontoNosItens = pedido?.itens.some((i) => i.desconto > 0)

  return (
    <Modal titulo={pedido ? `Pedido nº ${pedido.numero}` : 'Pedido'} onFechar={props.onFechar} largo>
      <EstadoLista carregando={carregando} erro={erroCarga} vazia={!pedido} textoVazio="" />
      {pedido && (
        <>
          <p>
            {pedido.cliente.nome} · {naturezasPedido[pedido.natureza] ?? pedido.natureza} · venda de {dataBr(pedido.data)} · <Selo valor={pedido.status} />
            {pedido.faturadoEm && <span className="texto-suave"> · faturado em {dataBr(pedido.faturadoEm)}</span>}
          </p>
          <p className="texto-suave">
            {[
              pedido.vendedor && `Vendedor: ${pedido.vendedor.nome}`,
              pedido.medico && `Médico: ${pedido.medico.nome}`,
              pedido.paciente && `Paciente: ${pedido.paciente.nome}`,
              pedido.motivoPerda && `Motivo da perda: ${motivosPerda[pedido.motivoPerda] ?? pedido.motivoPerda}`,
              pedido.formaPagamento &&
                `Pagamento: ${formasPagamento[pedido.formaPagamento] ?? pedido.formaPagamento}${pedido.parcelas > 1 ? ` em ${pedido.parcelas}x` : ''}`,
              pedido.enderecoEntrega && `Entregar em: ${enderecoTexto(pedido.enderecoEntrega)}${pedido.enderecoEntrega.referencia ? ` (${pedido.enderecoEntrega.referencia})` : ''}`,
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
          <h3>Anexos</h3>
          <Documentos origem="PEDIDO" origemId={pedido.id} />
          {pedido.historico && pedido.historico.length > 0 && (
            <>
              <h3>Histórico</h3>
              <table className="historico">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>O que aconteceu</th>
                    <th>Quem</th>
                  </tr>
                </thead>
                <tbody>
                  {pedido.historico.map((h) => (
                    <tr key={h.id}>
                      <td className="sem-quebra">{new Date(h.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>
                        <strong>{tiposHistorico[h.tipo] ?? h.tipo}</strong>
                        {h.motivo && <span className="bloco">Motivo: {h.motivo}</span>}
                        {h.descricao.split('\n').map((linha) => (
                          <small key={linha} className="bloco texto-suave">
                            {linha}
                          </small>
                        ))}
                      </td>
                      <td>{h.usuario?.nome ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <Erro mensagem={erro} />
          <div className="form-pe">
            {pedido.status === 'FATURADO' && pode('PEDIDOS_CANCELAR') && (
              <button type="button" className="botao botao-perigo empurra" onClick={cancelar} disabled={ocupado}>
                Cancelar pedido
              </button>
            )}
            {pedido.status === 'FATURADO' && pode('PEDIDOS_ALTERAR_FATURADO') && (
              <button type="button" className="botao" onClick={() => props.onAlterar(pedido)}>
                Alterar
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
