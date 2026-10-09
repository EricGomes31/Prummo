// Abas da logística além das entregas: rotas com sequência de paradas, motoristas e veículos.
import { useState, type FormEvent } from 'react'
import { api, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import { Documentos } from '../Documentos'
import { dataBr, hojeIso, mascarar, qtd, telefoneBr } from '../format'
import type { Entrega, HistoricoEntrega, Motorista, Rota, Veiculo } from '../types'
import { Campo, Erro, EstadoLista, Modal, Selo, useOrdenacao, usePaginacao } from '../ui'
import { CampoData } from '../calendario'

// Campos numéricos opcionais ficam como texto no formulário e viram número ou vazio ao enviar.
export const numeroOuNulo = (texto: string) => (texto.trim() === '' ? null : Number(texto.replace(',', '.')))
const comoTexto = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

export function Rotas() {
  const rotas = useDados<Rota[]>('/rotas')
  const gerencia = useSessao().pode('LOGISTICA_GERENCIAR')
  const motoristas = (useDados<Motorista[]>('/motoristas').dados ?? []).filter((m) => m.ativo)
  const veiculos = (useDados<Veiculo[]>('/veiculos').dados ?? []).filter((v) => v.ativo)
  const pendentes = useDados<Entrega[]>('/entregas?status=PENDENTE')
  const [editando, setEditando] = useState<Rota | 'nova' | null>(null)
  const [link, setLink] = useState<{ rotaId: number; url: string; expiraEm: string } | null>(null)
  const [horas, setHoras] = useState(24)
  const acao = useAcao()
  const lista = rotas.dados ?? []
  const semRota = (pendentes.dados ?? []).filter((e) => !e.rota)

  const atualizar = () => {
    rotas.recarregar()
    pendentes.recarregar()
  }
  const executar = (operacao: () => Promise<unknown>) =>
    acao.executar(async () => {
      await operacao()
      atualizar()
    })

  function mover(rota: Rota, indice: number, passo: number) {
    const ids = rota.entregas.map((e) => e.id)
    const destino = indice + passo
    if (destino < 0 || destino >= ids.length) return
    ;[ids[indice], ids[destino]] = [ids[destino], ids[indice]]
    executar(() => api(`/rotas/${rota.id}/sequencia`, { method: 'PUT', body: { entregaIds: ids } }))
  }

  function gerarLink(rota: Rota) {
    acao.executar(async () => {
      const r = await api<{ chave: string; expiraEm: string }>(`/rotas/${rota.id}/link`, { body: { horas } })
      // A chave vai depois do "#", que o navegador não envia ao servidor nem a outros sites.
      setLink({ rotaId: rota.id, url: `${window.location.origin}/rota/${rota.id}#chave=${r.chave}`, expiraEm: r.expiraEm })
      atualizar()
    })
  }

  return (
    <>
      <div className="filtros">
        {gerencia && (
          <button type="button" className="botao botao-primario" onClick={() => setEditando('nova')}>
            Nova rota
          </button>
        )}
        <span className="resumo-filtro">{semRota.length} entrega(s) pendente(s) sem rota</span>
      </div>
      <Erro mensagem={acao.erro} />
      <EstadoLista carregando={rotas.carregando} erro={rotas.erro} vazia={lista.length === 0} textoVazio="Nenhuma rota cadastrada." />

      {lista.map((rota) => (
        <section key={rota.id} className="painel rota">
          <header className="rota-topo">
            <div>
              <strong>{rota.nome}</strong> · {dataBr(rota.data)}
              <small className="bloco texto-suave">
                {rota.motorista.nome} · {rota.veiculo.placa}
                {rota.veiculo.descricao && ` (${rota.veiculo.descricao})`} · carga {qtd(rota.cargaKg)} de {qtd(rota.veiculo.capacidadeKg)} kg · saída: {rota.pontoSaida}
              </small>
            </div>
            {gerencia && (
              <div className="acoes">
                <button type="button" className="botao botao-texto" onClick={() => setEditando(rota)}>
                  Editar
                </button>
                <button type="button" className="botao botao-texto" disabled={acao.ocupado || rota.entregas.length < 2} onClick={() => executar(() => api(`/rotas/${rota.id}/organizar`, { method: 'POST' }))}>
                  Organizar paradas
                </button>
              </div>
            )}
          </header>

          {rota.entregas.length === 0 ? (
            <p className="aviso">Nenhuma entrega nesta rota.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Parada</th>
                  <th>Pedido</th>
                  <th>Destino</th>
                  <th>Recebe</th>
                  <th className="num">Peso</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rota.entregas.map((e, i) => (
                  <tr key={e.id}>
                    <td>{i + 1}</td>
                    <td>#{e.pedido.numero}</td>
                    <td>
                      {e.destinatario}
                      <small className="bloco texto-suave">
                        {[[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro, [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')}
                        {e.latitude === null && ' · sem coordenadas'}
                      </small>
                    </td>
                    <td>{e.inicioRecebimento || e.fimRecebimento ? `${e.inicioRecebimento ?? '—'} às ${e.fimRecebimento ?? '—'}` : '—'}</td>
                    <td className="num">{e.pesoKg === null ? '—' : `${qtd(e.pesoKg)} kg`}</td>
                    <td><Selo valor={e.status} /></td>
                    <td className="num">
                      {gerencia && (
                        <>
                          <button type="button" className="botao-icone" aria-label="Subir parada" disabled={acao.ocupado || i === 0} onClick={() => mover(rota, i, -1)}>
                            ↑
                          </button>
                          <button type="button" className="botao-icone" aria-label="Descer parada" disabled={acao.ocupado || i === rota.entregas.length - 1} onClick={() => mover(rota, i, 1)}>
                            ↓
                          </button>
                          {e.status === 'PENDENTE' && (
                            <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => executar(() => api(`/entregas/${e.id}/rota`, { method: 'PUT', body: { rotaId: null } }))}>
                              Tirar
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="filtros rota-pe">
            <select
              value=""
              aria-label="Incluir entrega pendente"
              disabled={acao.ocupado || semRota.length === 0}
              onChange={(e) => e.target.value && executar(() => api(`/entregas/${e.target.value}/rota`, { method: 'PUT', body: { rotaId: rota.id } }))}
            >
              <option value="">{semRota.length ? 'Incluir entrega pendente…' : 'Sem entregas pendentes fora de rota'}</option>
              {semRota.map((e) => (
                <option key={e.id} value={e.id}>
                  #{e.pedido.numero} · {e.destinatario} · {e.cidade}
                  {e.pesoKg !== null && ` · ${qtd(e.pesoKg)} kg`}
                </option>
              ))}
            </select>
            <span className="resumo-filtro">
              {rota.linkAtivo ? `Link do entregador válido até ${new Date(rota.linkExpiraEm!).toLocaleString('pt-BR')}` : 'Sem link do entregador'}
              {rota.linkAtivo && (
                <small className={`bloco ${rota.linkAbertoEm ? 'texto-bom' : 'texto-suave'}`}>
                  {rota.linkAbertoEm
                    ? `Aberto pelo entregador em ${new Date(rota.linkAbertoEm).toLocaleString('pt-BR')} · ${rota.linkAcessos} acesso(s), o último em ${new Date(rota.linkUltimoAcesso!).toLocaleString('pt-BR')}`
                    : 'O entregador ainda não abriu o link'}
                </small>
              )}
            </span>
            {gerencia && (
              <>
                <input type="number" min={1} max={168} className="curto" aria-label="Validade do link em horas" value={horas} onChange={(e) => setHoras(Math.min(168, Math.max(1, Number(e.target.value) || 1)))} />
                <span className="texto-suave">h</span>
                <button type="button" className="botao" disabled={acao.ocupado} onClick={() => gerarLink(rota)}>
                  {rota.linkAtivo ? 'Gerar novo link' : 'Gerar link'}
                </button>
                {rota.linkAtivo && (
                  <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => executar(() => api(`/rotas/${rota.id}/link`, { method: 'DELETE' }))}>
                    Revogar
                  </button>
                )}
              </>
            )}
          </div>
          {link?.rotaId === rota.id && (
            <p className="rota-link">
              Envie este link ao entregador. Ele só aparece agora; gerar outro invalida este.
              <input readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Link do entregador" />
            </p>
          )}
        </section>
      ))}

      {editando && (
        <FormRota
          rota={editando === 'nova' ? null : editando}
          motoristas={motoristas}
          veiculos={veiculos}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            atualizar()
          }}
        />
      )}
    </>
  )
}

function FormRota(props: { rota: Rota | null; motoristas: Motorista[]; veiculos: Veiculo[]; onFechar: () => void; onSalvo: () => void }) {
  const { rota } = props
  const [f, setF] = useState({
    nome: rota?.nome ?? '',
    data: rota ? rota.data.slice(0, 10) : hojeIso(),
    motoristaId: rota?.motorista.id ?? 0,
    veiculoId: rota?.veiculo.id ?? 0,
    pontoSaida: rota?.pontoSaida ?? '',
    latitudeSaida: comoTexto(rota?.latitudeSaida),
    longitudeSaida: comoTexto(rota?.longitudeSaida),
  })
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const corpo = { ...f, latitudeSaida: numeroOuNulo(f.latitudeSaida), longitudeSaida: numeroOuNulo(f.longitudeSaida) }
      await api(rota ? `/rotas/${rota.id}` : '/rotas', { method: rota ? 'PUT' : 'POST', body: corpo })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={rota ? `Rota ${rota.nome}` : 'Nova rota'} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Nome da rota" largura={2}>
          <input required autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="Data">
          <CampoData type="date" required value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </Campo>
        <Campo rotulo="Motorista" largura={2}>
          <select required value={f.motoristaId || ''} onChange={(e) => setF({ ...f, motoristaId: Number(e.target.value) })}>
            <option value="">Selecione…</option>
            {props.motoristas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Veículo">
          <select required value={f.veiculoId || ''} onChange={(e) => setF({ ...f, veiculoId: Number(e.target.value) })}>
            <option value="">Selecione…</option>
            {props.veiculos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.placa} · {qtd(v.capacidadeKg)} kg
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Endereço de saída" largura={3}>
          <input required value={f.pontoSaida} onChange={(e) => setF({ ...f, pontoSaida: e.target.value })} />
        </Campo>
        <Campo rotulo="Latitude de saída">
          <input inputMode="decimal" value={f.latitudeSaida} onChange={(e) => setF({ ...f, latitudeSaida: e.target.value })} placeholder="-20,3155" />
        </Campo>
        <Campo rotulo="Longitude de saída">
          <input inputMode="decimal" value={f.longitudeSaida} onChange={(e) => setF({ ...f, longitudeSaida: e.target.value })} placeholder="-40,3128" />
        </Campo>
        <p className="texto-suave col-3">
          "Organizar paradas" ordena pela distância em linha reta entre as coordenadas. Não considera vias, trânsito nem os horários de recebimento; revise antes de enviar ao entregador.
        </p>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function Motoristas() {
  const { dados, erro, carregando, recarregar } = useDados<Motorista[]>('/motoristas')
  const [editando, setEditando] = useState<Partial<Motorista> | null>(null)
  const lista = dados ?? []
  const { ordenados: ordenados, titulo: titulo } = useOrdenacao(lista, {
    nome: (m) => m.nome,
    telefone: (m) => m.telefone,
    cnh: (m) => m.cnh,
    validade: (m) => m.validadeCnh,
    situacao: (m) => (m.ativo ? 'Ativo' : 'Inativo'),
  })
  const paginas = usePaginacao(ordenados)
  const gerencia = useSessao().pode('LOGISTICA_GERENCIAR')

  return (
    <>
      <div className="filtros">
        {gerencia && (
          <button type="button" className="botao botao-primario" onClick={() => setEditando({ ativo: true })}>
            Novo motorista
          </button>
        )}
      </div>
      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={lista.length === 0} textoVazio="Nenhum motorista cadastrado." />
        {lista.length > 0 && (
          <table>
            <thead>
              <tr>
                {titulo('nome', 'Nome')}
                {titulo('telefone', 'Telefone')}
                {titulo('cnh', 'CNH')}
                {titulo('validade', 'Validade da CNH')}
                {titulo('situacao', 'Situação')}
                <th />
              </tr>
            </thead>
            <tbody>
              {paginas.visiveis.map((m) => (
                <tr key={m.id} className={m.ativo ? '' : 'linha-inativa'}>
                  <td>{m.nome}</td>
                  <td>{telefoneBr(m.telefone) ?? '—'}</td>
                  <td>{m.cnh ?? '—'}</td>
                  <td>{m.validadeCnh ? dataBr(m.validadeCnh) : '—'}</td>
                  <td><Selo valor={m.ativo ? 'Ativo' : 'Inativo'} tom={m.ativo ? 'bom' : 'apagado'} /></td>
                  <td className="num">
                    {gerencia && (
                      <button type="button" className="botao botao-texto" onClick={() => setEditando(m)}>
                        Editar
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
        <FormSimples
          titulo={editando.id ? 'Editar motorista' : 'Novo motorista'}
          caminho={editando.id ? `/motoristas/${editando.id}` : '/motoristas'}
          metodo={editando.id ? 'PUT' : 'POST'}
          inicial={{ nome: editando.nome ?? '', telefone: editando.telefone ?? '', cnh: editando.cnh ?? '', validadeCnh: editando.validadeCnh?.slice(0, 10) ?? '', ativo: editando.ativo ?? true }}
          campos={[
            { chave: 'nome', rotulo: 'Nome', obrigatorio: true, largura: 2 },
            { chave: 'telefone', rotulo: 'Telefone' },
            { chave: 'cnh', rotulo: 'CNH' },
            { chave: 'validadeCnh', rotulo: 'Validade da CNH', tipo: 'date' },
          ]}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            recarregar()
          }}
        />
      )}
    </>
  )
}

export function Veiculos() {
  const { dados, erro, carregando, recarregar } = useDados<Veiculo[]>('/veiculos')
  const [editando, setEditando] = useState<Partial<Veiculo> | null>(null)
  const lista = dados ?? []
  const { ordenados: ordenados, titulo: titulo } = useOrdenacao(lista, {
    placa: (v) => v.placa,
    descricao: (v) => v.descricao,
    capacidade: (v) => v.capacidadeKg,
    situacao: (v) => (v.ativo ? 'Ativo' : 'Inativo'),
  })
  const paginas = usePaginacao(ordenados)
  const gerencia = useSessao().pode('LOGISTICA_GERENCIAR')

  return (
    <>
      <div className="filtros">
        {gerencia && (
          <button type="button" className="botao botao-primario" onClick={() => setEditando({ ativo: true })}>
            Novo veículo
          </button>
        )}
      </div>
      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={lista.length === 0} textoVazio="Nenhum veículo cadastrado." />
        {lista.length > 0 && (
          <table>
            <thead>
              <tr>
                {titulo('placa', 'Placa')}
                {titulo('descricao', 'Descrição')}
                {titulo('capacidade', 'Capacidade', 'num')}
                {titulo('situacao', 'Situação')}
                <th />
              </tr>
            </thead>
            <tbody>
              {paginas.visiveis.map((v) => (
                <tr key={v.id} className={v.ativo ? '' : 'linha-inativa'}>
                  <td>{v.placa}</td>
                  <td>{v.descricao ?? '—'}</td>
                  <td className="num">{qtd(v.capacidadeKg)} kg</td>
                  <td><Selo valor={v.ativo ? 'Ativo' : 'Inativo'} tom={v.ativo ? 'bom' : 'apagado'} /></td>
                  <td className="num">
                    {gerencia && (
                      <button type="button" className="botao botao-texto" onClick={() => setEditando(v)}>
                        Editar
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
        <FormSimples
          titulo={editando.id ? 'Editar veículo' : 'Novo veículo'}
          caminho={editando.id ? `/veiculos/${editando.id}` : '/veiculos'}
          metodo={editando.id ? 'PUT' : 'POST'}
          inicial={{ placa: editando.placa ?? '', descricao: editando.descricao ?? '', capacidadeKg: comoTexto(editando.capacidadeKg), ativo: editando.ativo ?? true }}
          campos={[
            { chave: 'placa', rotulo: 'Placa', obrigatorio: true },
            { chave: 'descricao', rotulo: 'Descrição' },
            { chave: 'capacidadeKg', rotulo: 'Capacidade em kg', obrigatorio: true, numero: true },
          ]}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            recarregar()
          }}
        />
      )}
    </>
  )
}

// Formulário de cadastro com poucos campos de texto, usado por motoristas e veículos.
function FormSimples(props: {
  titulo: string
  caminho: string
  metodo: 'POST' | 'PUT'
  inicial: Record<string, string | boolean>
  campos: { chave: string; rotulo: string; obrigatorio?: boolean; tipo?: string; largura?: 1 | 2 | 3; numero?: boolean }[]
  onFechar: () => void
  onSalvo: () => void
}) {
  const [f, setF] = useState(props.inicial)
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const corpo = Object.fromEntries(
        Object.entries(f).map(([chave, valor]) => [chave, props.campos.find((c) => c.chave === chave)?.numero ? numeroOuNulo(String(valor)) : valor]),
      )
      await api(props.caminho, { method: props.metodo, body: corpo })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={props.titulo} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        {props.campos.map((c, i) => (
          <Campo key={c.chave} rotulo={c.rotulo} largura={c.largura}>
            <input
              type={c.tipo ?? 'text'}
              inputMode={c.numero ? 'decimal' : undefined}
              required={c.obrigatorio}
              autoFocus={i === 0}
              value={mascarar(c.chave, String(f[c.chave] ?? ''))}
              onChange={(e) => setF({ ...f, [c.chave]: mascarar(c.chave, e.target.value) })}
            />
          </Campo>
        ))}
        <label className="marcar col-3">
          <input type="checkbox" checked={f.ativo === true} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
          Ativo
        </label>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  )
}

const rotulosDeSituacao: Record<string, string> = { PENDENTE: 'Pendente', EM_ROTA: 'Em rota', ENTREGUE: 'Entregue', FALHOU: 'Não entregue', CANCELADA: 'Cancelada' }

export function HistoricoDaEntrega({ entrega, onFechar }: { entrega: Entrega; onFechar: () => void }) {
  const { dados, erro, carregando } = useDados<HistoricoEntrega[]>(`/entregas/${entrega.id}/historico`)
  const lista = dados ?? []

  return (
    <Modal titulo={`Histórico e documentos da entrega · pedido nº ${entrega.pedido.numero}`} onFechar={onFechar} largo>
      <h3>Documentos</h3>
      <p className="texto-suave">Comprovante assinado, foto da entrega ou do local. O entregador também envia pelo link da rota.</p>
      <Documentos origem="ENTREGA" origemId={entrega.id} />
      <h3>Histórico</h3>
      <EstadoLista carregando={carregando} erro={erro} vazia={lista.length === 0} textoVazio="Sem registros. Entregas anteriores a este recurso não têm histórico." />
      {lista.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Situação</th>
              <th>Registro</th>
              <th>Quem</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((h) => (
              <tr key={h.id}>
                <td>{new Date(h.criadoEm).toLocaleString('pt-BR')}</td>
                <td>{rotulosDeSituacao[h.status] ?? h.status}</td>
                <td>{h.observacao ?? '—'}</td>
                <td>{h.origem === 'ENTREGADOR' ? 'Entregador, pelo link da rota' : (h.usuario?.nome ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="form-pe">
        <button type="button" className="botao" onClick={onFechar}>
          Fechar
        </button>
      </div>
    </Modal>
  )
}
