import { useState, type FormEvent } from 'react'
import { api, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import { brl, dataBr, hojeIso, mascarar } from '../format'
import type { Endereco, Entrega, PedidoParaEntrega } from '../types'
import { Cabecalho, Campo, Erro, EstadoLista, Modal, Selo, useOrdenacao, usePaginacao } from '../ui'
import { HistoricoDaEntrega, Motoristas, numeroOuNulo, Rotas, Veiculos } from './Logistica'
import { CampoData } from '../calendario'
import { Escolha, opcoesDePessoas } from '../escolha'

type Entregador = { id: number; nome: string }

const enderecoTexto = (e: Endereco) =>
  [[e.logradouro, e.numero].filter(Boolean).join(', '), e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join('/')]
    .filter(Boolean)
    .join(' · ')

const linkRota = (e: Endereco) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    [e.logradouro, e.numero, e.bairro, e.cidade, e.uf, e.cep].filter(Boolean).join(', '),
  )}`

// Números brasileiros sem código do país (10 ou 11 dígitos) recebem o 55.
function linkWhatsapp(telefone: string | null) {
  const digitos = (telefone ?? '').replace(/\D/g, '')
  if (digitos.length < 10) return null
  return `https://wa.me/${digitos.length <= 11 ? `55${digitos}` : digitos}`
}

// Operações que pedem um único dado antes de mudar a situação da entrega.
const operacoes = {
  concluir: { titulo: 'Confirmar entrega', rotulo: 'Quem recebeu', campo: 'recebedor', tipo: 'text', botao: 'Confirmar entrega' },
  falhar: { titulo: 'Registrar falha na entrega', rotulo: 'Motivo', campo: 'motivo', tipo: 'text', botao: 'Registrar falha' },
  reprogramar: { titulo: 'Reprogramar entrega', rotulo: 'Nova data prevista', campo: 'dataPrevista', tipo: 'date', botao: 'Reprogramar' },
} as const
type Operacao = keyof typeof operacoes

const abas = { entregas: 'Entregas', rotas: 'Rotas', motoristas: 'Motoristas', veiculos: 'Veículos' } as const
type Aba = keyof typeof abas

export function Entregas() {
  const { usuario, pode } = useSessao()
  const gerencia = pode('LOGISTICA_GERENCIAR')
  const [status, setStatus] = useState('ATIVAS')
  const [entregadorId, setEntregadorId] = useState('')
  const [data, setData] = useState('')
  const consulta = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(entregadorId ? { entregadorId } : {}),
    ...(data ? { data } : {}),
  })
  const { dados, erro, carregando, recarregar } = useDados<Entrega[]>(`/entregas?${consulta}`)
  const entregadores = useDados<Entregador[]>('/entregas/entregadores').dados ?? []
  const [editando, setEditando] = useState<Entrega | 'nova' | null>(null)
  const [operando, setOperando] = useState<{ entrega: Entrega; operacao: Operacao } | null>(null)
  const [vendoHistorico, setVendoHistorico] = useState<Entrega | null>(null)
  const [aba, setAba] = useState<Aba>('entregas')
  const acao = useAcao()
  const entregas = dados ?? []
  const { ordenados: ordenados, titulo: titulo } = useOrdenacao(entregas, {
    previsao: (e) => e.dataPrevista,
    pedido: (e) => e.pedido.numero,
    destino: (e) => e.destinatario,
    entregador: (e) => e.entregador?.nome,
    situacao: (e) => e.status,
  })
  const paginas = usePaginacao(ordenados)

  function direto(entrega: Entrega, operacao: 'sair' | 'cancelar') {
    if (operacao === 'cancelar' && !window.confirm(`Cancelar a entrega do pedido nº ${entrega.pedido.numero}?`)) return
    acao.executar(async () => {
      await api(`/entregas/${entrega.id}/${operacao}`, { method: 'POST' })
      recarregar()
    })
  }

  const fechar = () => {
    setEditando(null)
    setOperando(null)
    recarregar()
  }

  return (
    <>
      <Cabecalho titulo="Logística e entregas" descricao="Entregas dos pedidos faturados, da programação à confirmação.">
        {gerencia && (
          <button type="button" className="botao botao-primario" onClick={() => setEditando('nova')}>
            Nova entrega
          </button>
        )}
      </Cabecalho>

      <div className="abas" role="tablist">
        {(Object.keys(abas) as Aba[]).map((chave) => (
          <button key={chave} type="button" role="tab" aria-selected={aba === chave} onClick={() => setAba(chave)}>
            {abas[chave]}
          </button>
        ))}
      </div>
      {aba === 'rotas' && <Rotas />}
      {aba === 'motoristas' && <Motoristas />}
      {aba === 'veiculos' && <Veiculos />}

      {aba === 'entregas' && (
      <>
      <div className="filtros">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="ATIVAS">A fazer</option>
          <option value="PENDENTE">Pendentes</option>
          <option value="EM_ROTA">Em rota</option>
          <option value="FALHOU">Com falha</option>
          <option value="ENTREGUE">Entregues</option>
          <option value="CANCELADA">Canceladas</option>
          <option value="">Todas</option>
        </select>
        <select value={entregadorId} onChange={(e) => setEntregadorId(e.target.value)} aria-label="Entregador">
          <option value="">Todos os entregadores</option>
          {usuario && <option value={usuario.id}>Minhas entregas</option>}
          {entregadores.filter((u) => u.id !== usuario?.id).map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
        <CampoData type="date" className="filtro-data" value={data} onChange={(e) => setData(e.target.value)} aria-label="Data prevista" />
        {data !== hojeIso() && (
          <button type="button" className="botao botao-texto" onClick={() => setData(hojeIso())}>
            Hoje
          </button>
        )}
        {data && (
          <button type="button" className="botao botao-texto" onClick={() => setData('')}>
            Todas as datas
          </button>
        )}
        <span className="resumo-filtro">{entregas.length} entrega(s)</span>
      </div>

      <Erro mensagem={acao.erro} />
      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={entregas.length === 0} textoVazio="Nenhuma entrega neste filtro." />
        {entregas.length > 0 && (
          <table>
            <thead>
              <tr>
                {titulo('previsao', 'Previsão')}
                {titulo('pedido', 'Pedido')}
                {titulo('destino', 'Destino')}
                {titulo('entregador', 'Entregador')}
                {titulo('situacao', 'Situação')}
                <th />
              </tr>
            </thead>
            <tbody>
              {paginas.visiveis.map((e) => {
                const whatsapp = linkWhatsapp(e.telefone)
                return (
                  <tr key={e.id}>
                    <td>{dataBr(e.dataPrevista)}</td>
                    <td>
                      #{e.pedido.numero} <span className="texto-suave">· {brl(e.pedido.total)}</span>
                      <small className="bloco texto-suave">{e.pedido.cliente.nome}</small>
                    </td>
                    <td>
                      {e.destinatario}
                      <small className="bloco texto-suave">{enderecoTexto(e)}</small>
                      <small className="bloco">
                        <a href={linkRota(e)} target="_blank" rel="noreferrer">
                          Abrir rota
                        </a>
                        {whatsapp && (
                          <>
                            {' · '}
                            <a href={whatsapp} target="_blank" rel="noreferrer">
                              WhatsApp
                            </a>
                          </>
                        )}
                      </small>
                    </td>
                    <td>
                      {e.entregador?.nome ?? <span className="texto-suave">A definir</span>}
                      {e.rota && <small className="bloco texto-suave">Rota {e.rota.nome} · parada {e.sequencia}</small>}
                    </td>
                    <td>
                      <Selo valor={e.status} />
                      {e.status === 'ENTREGUE' && e.concluidaEm && (
                        <small className="bloco texto-suave">
                          {dataBr(e.concluidaEm)} · recebeu {e.recebedor}
                        </small>
                      )}
                      {e.status === 'FALHOU' && <small className="bloco texto-ruim">{e.motivoFalha}</small>}
                    </td>
                    <td className="num">
                      {gerencia && e.status === 'PENDENTE' && (
                        <>
                          <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => direto(e, 'sair')}>
                            Saiu para entrega
                          </button>
                          <button type="button" className="botao botao-texto" onClick={() => setEditando(e)}>
                            Editar
                          </button>
                        </>
                      )}
                      {gerencia && e.status === 'EM_ROTA' && (
                        <>
                          <button type="button" className="botao botao-texto" onClick={() => setOperando({ entrega: e, operacao: 'concluir' })}>
                            Entregue
                          </button>
                          <button type="button" className="botao botao-texto" onClick={() => setOperando({ entrega: e, operacao: 'falhar' })}>
                            Não entregue
                          </button>
                        </>
                      )}
                      {gerencia && e.status === 'FALHOU' && (
                        <button type="button" className="botao botao-texto" onClick={() => setOperando({ entrega: e, operacao: 'reprogramar' })}>
                          Reprogramar
                        </button>
                      )}
                      {gerencia && (e.status === 'PENDENTE' || e.status === 'FALHOU') && (
                        <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => direto(e, 'cancelar')}>
                          Cancelar
                        </button>
                      )}
                      <button type="button" className="botao botao-texto" onClick={() => setVendoHistorico(e)}>
                        Histórico e documentos
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {paginas.controle}
      </section>
      </>
      )}

      {vendoHistorico && <HistoricoDaEntrega entrega={vendoHistorico} onFechar={() => setVendoHistorico(null)} />}
      {editando && (
        <FormEntrega entrega={editando === 'nova' ? null : editando} entregadores={entregadores} onFechar={() => setEditando(null)} onSalvo={fechar} />
      )}
      {operando && <FormOperacao {...operando} onFechar={() => setOperando(null)} onSalvo={fechar} />}
    </>
  )
}

function FormEntrega(props: { entrega: Entrega | null; entregadores: Entregador[]; onFechar: () => void; onSalvo: () => void }) {
  const { entrega } = props
  const pedidos = useDados<PedidoParaEntrega[]>(entrega ? null : '/entregas/pedidos-disponiveis')
  const [pedidoId, setPedidoId] = useState(0)
  const [f, setF] = useState({
    entregadorId: entrega?.entregador?.id ?? 0,
    dataPrevista: entrega ? entrega.dataPrevista.slice(0, 10) : hojeIso(),
    destinatario: entrega?.destinatario ?? '',
    telefone: entrega?.telefone ?? '',
    cep: entrega?.cep ?? '',
    logradouro: entrega?.logradouro ?? '',
    numero: entrega?.numero ?? '',
    complemento: entrega?.complemento ?? '',
    bairro: entrega?.bairro ?? '',
    cidade: entrega?.cidade ?? '',
    uf: entrega?.uf ?? '',
    observacao: entrega?.observacao ?? '',
    pesoKg: entrega?.pesoKg?.toString() ?? '',
    latitude: entrega?.latitude?.toString() ?? '',
    longitude: entrega?.longitude?.toString() ?? '',
    inicioRecebimento: entrega?.inicioRecebimento ?? '',
    fimRecebimento: entrega?.fimRecebimento ?? '',
  })
  const { erro, ocupado, executar } = useAcao()
  const disponiveis = pedidos.dados ?? []
  const texto = (nome: keyof typeof f) => ({
    value: mascarar(nome, f[nome] as string),
    onChange: (e: { target: { value: string } }) => setF({ ...f, [nome]: mascarar(nome, e.target.value) }),
  })

  // Ao escolher o pedido, o destino começa com os dados do cadastro do cliente.
  function escolherPedido(id: number) {
    setPedidoId(id)
    const escolhido = disponiveis.find((p) => p.id === id)
    if (!escolhido) return
    const { cliente } = escolhido
    // O endereço de entrega escolhido no pedido vale; sem ele, o do cadastro do cliente.
    const endereco = escolhido.enderecoEntrega ?? cliente
    setF({
      ...f,
      destinatario: cliente.nome,
      telefone: cliente.celular ?? cliente.telefone ?? '',
      complemento: endereco.complemento ?? '',
      cep: endereco.cep ?? '',
      logradouro: endereco.logradouro ?? '',
      numero: endereco.numero ?? '',
      bairro: endereco.bairro ?? '',
      cidade: endereco.cidade ?? '',
      uf: endereco.uf ?? '',
      observacao: escolhido.enderecoEntrega?.referencia ?? f.observacao,
    })
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const corpo = {
        ...f,
        entregadorId: f.entregadorId || null,
        pesoKg: numeroOuNulo(f.pesoKg),
        latitude: numeroOuNulo(f.latitude),
        longitude: numeroOuNulo(f.longitude),
      }
      if (entrega) await api(`/entregas/${entrega.id}`, { method: 'PUT', body: corpo })
      else await api('/entregas', { body: { ...corpo, pedidoId } })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={entrega ? `Entrega do pedido nº ${entrega.pedido.numero}` : 'Nova entrega'} onFechar={props.onFechar} largo>
      <form onSubmit={enviar} className="form">
        {!entrega && (
          <Campo rotulo="Pedido faturado" largura={3}>
            <Escolha
              required
              opcoes={disponiveis.map((p) => ({ id: p.id, rotulo: `#${p.numero} · ${p.cliente.nome}`, detalhe: brl(p.total), busca: String(p.numero) }))}
              valor={pedidoId}
              onChange={escolherPedido}
              placeholder={pedidos.carregando ? 'Carregando…' : 'Digite o número do pedido ou o cliente…'}
            />
            {!pedidos.carregando && disponiveis.length === 0 && (
              <small className="texto-suave">Não há pedidos faturados aguardando entrega.</small>
            )}
          </Campo>
        )}
        <Campo rotulo="Data prevista">
          <CampoData type="date" required {...texto('dataPrevista')} />
        </Campo>
        <Campo rotulo="Entregador" largura={2}>
          <select value={f.entregadorId} onChange={(e) => setF({ ...f, entregadorId: Number(e.target.value) })}>
            <option value={0}>A definir (assume quem registrar a saída)</option>
            {props.entregadores.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Destinatário" largura={2}>
          <input required {...texto('destinatario')} />
        </Campo>
        <Campo rotulo="Telefone">
          <input {...texto('telefone')} />
        </Campo>
        <Campo rotulo="CEP">
          <input {...texto('cep')} />
        </Campo>
        <Campo rotulo="Logradouro">
          <input required {...texto('logradouro')} />
        </Campo>
        <Campo rotulo="Número">
          <input {...texto('numero')} />
        </Campo>
        <Campo rotulo="Complemento" largura={2}>
          <input {...texto('complemento')} />
        </Campo>
        <Campo rotulo="Bairro">
          <input {...texto('bairro')} />
        </Campo>
        <Campo rotulo="Cidade">
          <input required {...texto('cidade')} />
        </Campo>
        <Campo rotulo="UF">
          <input maxLength={2} {...texto('uf')} />
        </Campo>
        <Campo rotulo="Observação para a entrega" largura={3}>
          <input {...texto('observacao')} placeholder="Ex.: entregar na portaria, horário comercial" />
        </Campo>
        <Campo rotulo="Peso em kg">
          <input inputMode="decimal" {...texto('pesoKg')} />
        </Campo>
        <Campo rotulo="Recebe a partir de">
          <input type="time" {...texto('inicioRecebimento')} />
        </Campo>
        <Campo rotulo="Recebe até">
          <input type="time" {...texto('fimRecebimento')} />
        </Campo>
        <Campo rotulo="Latitude">
          <input inputMode="decimal" {...texto('latitude')} placeholder="-20,3155" />
        </Campo>
        <Campo rotulo="Longitude">
          <input inputMode="decimal" {...texto('longitude')} placeholder="-40,3128" />
        </Campo>
        <p className="texto-suave">Peso, coordenadas e horário são opcionais e servem para montar a rota.</p>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            {entrega ? 'Salvar' : 'Programar entrega'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function FormOperacao(props: { entrega: Entrega; operacao: Operacao; onFechar: () => void; onSalvo: () => void }) {
  const config = operacoes[props.operacao]
  const [valor, setValor] = useState(
    props.operacao === 'reprogramar' ? hojeIso() : props.operacao === 'concluir' ? props.entrega.destinatario : '',
  )
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      await api(`/entregas/${props.entrega.id}/${props.operacao}`, { body: { [config.campo]: valor } })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={config.titulo} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <p className="col-3 texto-suave">
          Pedido nº {props.entrega.pedido.numero} · {props.entrega.destinatario}
        </p>
        <Campo rotulo={config.rotulo} largura={3}>
          <input type={config.tipo} required autoFocus value={valor} onChange={(e) => setValor(e.target.value)} />
        </Campo>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Voltar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            {config.botao}
          </button>
        </div>
      </form>
    </Modal>
  )
}
