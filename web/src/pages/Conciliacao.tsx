// Aba de conciliação do financeiro: importa o extrato do banco (OFX) e liga cada linha ao que a explica.
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, lerEmBase64, useAcao, useDados } from '../api'
import { confirmar } from '../confirmacao'
import { useSessao } from '../auth'
import { brl, dataBr, plural } from '../format'
import type { ArquivoOfx, Conta, ContaFinanceira, LinhaExtrato, Pessoa, SugestaoConciliacao } from '../types'
import { Cabecalho, Campo, Dinheiro, Erro, EstadoLista, Modal, Selo, usePaginacao } from '../ui'
import { Icone } from '../icones'
import { Escolha, opcoesDePessoas } from '../escolha'

const resolucoes: Record<string, string> = {
  BAIXA: 'Baixa de título',
  VINCULO: 'Vínculo com movimento já lançado',
  AVULSO: 'Lançamento avulso',
  CREDITO: 'Depósito a maior',
  TRANSFERENCIA: 'Transferência entre contas',
}
const acoesDaSugestao: Record<SugestaoConciliacao['acao'], string> = { BAIXA: 'Baixar', VINCULO: 'Vincular', CREDITO: 'Quitar e gerar crédito' }

const textoDaSugestao = (s: SugestaoConciliacao) =>
  s.acao === 'VINCULO'
    ? `Movimento já lançado: ${s.descricao}`
    : `${s.tipo === 'CONTA_RECEBER' ? 'A receber' : 'A pagar'}: ${s.descricao}${s.pessoa ? ` · ${s.pessoa}` : ''} · vence ${s.vencimento ? dataBr(s.vencimento) : '—'} · saldo ${brl(s.saldo ?? 0)}`

export function Conciliacao({ seletor }: { seletor: ReactNode }) {
  const { pode } = useSessao()
  const confirma = pode('CONCILIACAO_CONFIRMAR')
  const [aba, setAba] = useState<'pendentes' | 'concluidas'>('pendentes')
  const pendentes = useDados<LinhaExtrato[]>('/conciliacao/pendentes')
  const concluidas = useDados<LinhaExtrato[]>(aba === 'concluidas' ? '/conciliacao/concluidas' : null)
  const [resolvendo, setResolvendo] = useState<LinhaExtrato | null>(null)
  const [aviso, setAviso] = useState('')
  const acao = useAcao()
  const linhas = pendentes.dados ?? []
  const paginaPendentes = usePaginacao(linhas)
  const feitas = concluidas.dados ?? []
  const paginaFeitas = usePaginacao(feitas)

  const atualizar = () => {
    pendentes.recarregar()
    concluidas.recarregar()
  }
  const executar = (operacao: () => Promise<unknown>) =>
    acao.executar(async () => {
      setAviso('')
      await operacao()
      atualizar()
    })

  function automatica() {
    executar(async () => {
      const r = await api<{ analisadas: number; conciliadas: number }>('/conciliacao/automatica', { method: 'POST' })
      setAviso(
        r.conciliadas
          ? `${r.conciliadas} de ${plural(r.analisadas, 'linha conciliada', 'linhas conciliadas')} automaticamente. As demais ficaram para conferência.`
          : 'Nenhuma linha tinha uma única correspondência segura. Todas ficaram para conferência.',
      )
    })
  }

  async function desfazer(linha: LinhaExtrato) {
    const efeito =
      linha.resolucao === 'VINCULO'
        ? 'O movimento continua lançado; só deixa de estar ligado a esta linha.'
        : 'O que foi lançado pela conciliação é estornado (baixas, lançamento avulso, depósito, transferência) e o crédito gerado, se houver, é cancelado.'
    if (!(await confirmar({ texto: `Desfazer a conciliação de ${brl(linha.valor)} (${linha.descricao})? ${efeito} A linha volta a ficar pendente.`, botao: 'Desfazer conciliação', perigo: true }))) return
    executar(() => api(`/conciliacao/${linha.id}/desfazer`, { method: 'POST' }))
  }

  // A sugestão principal é aplicada com um clique; o depósito a maior pede a confirmação do cliente.
  async function aceitar(linha: LinhaExtrato, s: SugestaoConciliacao) {
    if (s.acao === 'CREDITO') return setResolvendo(linha)
    const pergunta = s.acao === 'VINCULO' ? `Vincular ${brl(linha.valor)} ao movimento já lançado? Nenhuma nova baixa será feita.` : `Baixar ${brl(linha.valor)} em "${s.descricao}"?`
    if (!(await confirmar({ texto: pergunta, botao: 'Confirmar' }))) return
    executar(() =>
      s.acao === 'VINCULO'
        ? api(`/conciliacao/${linha.id}/vincular`, { body: { movimentoId: s.movimentoId } })
        : api(`/conciliacao/${linha.id}/baixar`, { body: { tipo: s.tipo, contaId: s.contaId } }),
    )
  }

  return (
    <>
      <Cabecalho titulo="Conciliação bancária" descricao="Importe o extrato do banco e confira cada linha com os títulos e os movimentos do sistema.">
        <button type="button" className="botao" onClick={atualizar}>
          Atualizar
        </button>
        {confirma && (
          <button type="button" className="botao botao-primario" disabled={acao.ocupado || linhas.length === 0} onClick={automatica}>
            Conciliar automaticamente
          </button>
        )}
      </Cabecalho>
      {seletor}

      {pode('OFX_IMPORTAR') && <ImportarOfx onImportado={atualizar} />}

      <section className="indicadores">
        <div className="indicador">
          <span>Linhas pendentes</span>
          <strong>{linhas.length}</strong>
        </div>
        <div className="indicador">
          <span>Com sugestão</span>
          <strong>{linhas.filter((l) => l.sugestoes?.length).length}</strong>
        </div>
        <div className="indicador">
          <span>Entradas pendentes</span>
          <strong>{brl(linhas.filter((l) => l.tipo === 'ENTRADA').reduce((s, l) => s + l.valor, 0))}</strong>
        </div>
        <div className="indicador">
          <span>Saídas pendentes</span>
          <strong>{brl(linhas.filter((l) => l.tipo === 'SAIDA').reduce((s, l) => s + l.valor, 0))}</strong>
        </div>
      </section>

      <div className="abas" role="tablist">
        <button type="button" role="tab" aria-selected={aba === 'pendentes'} onClick={() => setAba('pendentes')}>
          Pendentes ({linhas.length})
        </button>
        <button type="button" role="tab" aria-selected={aba === 'concluidas'} onClick={() => setAba('concluidas')}>
          Concluídas
        </button>
      </div>
      {aviso && <p className="aviso">{aviso}</p>}
      <Erro mensagem={acao.erro} />

      {aba === 'pendentes' && (
        <section className="painel">
          <EstadoLista carregando={pendentes.carregando} erro={pendentes.erro} vazia={linhas.length === 0} textoVazio="Não há linhas do extrato pendentes de conciliação." />
          {linhas.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Conta</th>
                  <th>Descrição do banco</th>
                  <th className="num">Entrada</th>
                  <th className="num">Saída</th>
                  <th>Sugestão</th>
                  <th className="num">Pontos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {paginaPendentes.visiveis.map((l) => {
                  const melhor = l.sugestoes?.[0]
                  return (
                    <tr key={l.id}>
                      <td>{dataBr(l.data)}</td>
                      <td>{l.contaFinanceira.nome}</td>
                      <td>{l.descricao}</td>
                      <td className="num">{l.tipo === 'ENTRADA' ? brl(l.valor) : '—'}</td>
                      <td className="num">{l.tipo === 'SAIDA' ? brl(l.valor) : '—'}</td>
                      <td>{melhor ? textoDaSugestao(melhor) : <span className="texto-suave">Sem correspondência</span>}</td>
                      <td className="num">{melhor?.pontuacao ?? '—'}</td>
                      <td className="num">
                        {confirma && melhor && (
                          <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => aceitar(l, melhor)}>
                            {acoesDaSugestao[melhor.acao]}
                          </button>
                        )}
                        {confirma && (
                          <button type="button" className="botao botao-texto" onClick={() => setResolvendo(l)}>
                            Resolver
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {paginaPendentes.controle}
        </section>
      )}

      {aba === 'concluidas' && (
        <section className="painel">
          <EstadoLista carregando={concluidas.carregando} erro={concluidas.erro} vazia={feitas.length === 0} textoVazio="Nenhuma linha conciliada ainda." />
          {feitas.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Conta</th>
                  <th>Descrição do banco</th>
                  <th className="num">Valor</th>
                  <th>Como foi resolvida</th>
                  <th>Quem</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {paginaFeitas.visiveis.map((l) => (
                  <tr key={l.id}>
                    <td>{dataBr(l.data)}</td>
                    <td>{l.contaFinanceira.nome}</td>
                    <td>{l.descricao}</td>
                    <td className="num">{l.tipo === 'SAIDA' ? `−${brl(l.valor)}` : brl(l.valor)}</td>
                    <td>
                      {l.status === 'IGNORADA' ? <Selo valor="Ignorada" tom="apagado" /> : (resolucoes[l.resolucao ?? ''] ?? '—')}
                      <small className="bloco texto-suave">{l.observacao ?? l.movimentos?.map((m) => m.historico).join(' · ')}</small>
                    </td>
                    <td>
                      {l.usuario?.nome ?? '—'}
                      {l.conciliadoEm && <small className="bloco texto-suave">{dataBr(l.conciliadoEm)}</small>}
                    </td>
                    <td className="num">
                      {confirma && l.status === 'IGNORADA' && (
                        <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => executar(() => api(`/conciliacao/${l.id}/reabrir`, { method: 'POST' }))}>
                          Reabrir
                        </button>
                      )}
                      {confirma && l.status === 'CONCILIADA' && (
                        <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => desfazer(l)}>
                          Desfazer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {paginaFeitas.controle}
        </section>
      )}

      {resolvendo && (
        <Resolver
          linha={resolvendo}
          onFechar={() => setResolvendo(null)}
          onResolvida={() => {
            setResolvendo(null)
            atualizar()
          }}
        />
      )}
    </>
  )
}

function ImportarOfx({ onImportado }: { onImportado: () => void }) {
  const contas = (useDados<ContaFinanceira[]>('/contas-financeiras').dados ?? []).filter((c) => c.ativa)
  const seletor = useRef<HTMLInputElement>(null)
  const [arquivo, setArquivo] = useState<{ nome: string; conteudo: string } | null>(null)
  const [lido, setLido] = useState<ArquivoOfx | null>(null)
  const [contaId, setContaId] = useState(0)
  const [aviso, setAviso] = useState('')
  const { erro, ocupado, executar } = useAcao()
  const novas = lido?.transacoes.filter((t) => !t.duplicada).length ?? 0

  function limpar() {
    setArquivo(null)
    setLido(null)
    setContaId(0)
    if (seletor.current) seletor.current.value = ''
  }

  function visualizar(escolhido: File | undefined) {
    setAviso('')
    setLido(null)
    if (!escolhido) return setArquivo(null)
    executar(async () => {
      const novo = { nome: escolhido.name, conteudo: await lerEmBase64(escolhido) }
      const r = await api<ArquivoOfx>('/ofx/ler', { body: novo })
      setArquivo(novo)
      setLido(r)
      setContaId(r.contaFinanceiraSugeridaId ?? (contas.length === 1 ? contas[0].id : 0))
    })
  }

  function importar(e: FormEvent) {
    e.preventDefault()
    if (!arquivo) return
    executar(async () => {
      const r = await api<{ importadas: number; duplicadas: number }>('/ofx/importar', { body: { ...arquivo, contaFinanceiraId: contaId } })
      setAviso(`${plural(r.importadas, 'transação importada', 'transações importadas')}${r.duplicadas ? `; ${r.duplicadas} já estavam no sistema e foram ignoradas` : ''}.`)
      limpar()
      onImportado()
    })
  }

  return (
    <section className="painel">
      <form onSubmit={importar} className="form">
        <Campo rotulo="Extrato do banco (arquivo .ofx, até 10 MB)" largura={2}>
          <input ref={seletor} type="file" accept=".ofx" disabled={ocupado} onChange={(e) => visualizar(e.target.files?.[0])} />
        </Campo>
        {lido && (
          <Campo rotulo="Conta financeira de destino">
            <select required value={contaId || ''} onChange={(e) => setContaId(Number(e.target.value))}>
              <option value="">Selecione…</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}
        {lido && (
          <p className="texto-suave col-3">
            No arquivo: banco {lido.banco ?? '—'}, agência {lido.agencia ?? '—'}, conta {lido.conta ?? '—'}.{' '}
            {lido.contaFinanceiraSugeridaId ? 'A conta financeira foi reconhecida pelo número.' : 'Nenhuma conta financeira tem este número; confira o destino antes de importar.'}
          </p>
        )}
        {lido && (
          <div className="col-3">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th className="num">Entrada</th>
                  <th className="num">Saída</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lido.transacoes.map((t) => (
                  <tr key={t.fitId} className={t.duplicada ? 'linha-inativa' : ''}>
                    <td>{dataBr(t.data)}</td>
                    <td>{t.descricao}</td>
                    <td className="num">{t.tipo === 'ENTRADA' ? brl(t.valor) : '—'}</td>
                    <td className="num">{t.tipo === 'SAIDA' ? brl(t.valor) : '—'}</td>
                    <td>{t.duplicada && <small className="texto-suave">já importada</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {aviso && <p className="texto-suave col-3">{aviso}</p>}
        <Erro mensagem={erro} />
        {lido && (
          <div className="form-pe">
            <button type="button" className="botao" onClick={limpar}>
              Descartar
            </button>
            <button className="botao botao-primario" disabled={ocupado || novas === 0}>
              {novas === 0 ? 'Tudo já foi importado' : `Importar ${plural(novas, 'transação', 'transações')}`}
            </button>
          </div>
        )}
      </form>
    </section>
  )
}

// Todas as formas de resolver uma linha do extrato.
function Resolver(props: { linha: LinhaExtrato; onFechar: () => void; onResolvida: () => void }) {
  const { linha } = props
  const entrada = linha.tipo === 'ENTRADA'
  const titulos = useDados<Conta[]>(`/${entrada ? 'contas-receber' : 'contas-pagar'}?status=ABERTA`).dados ?? []
  const clientes = (useDados<Pessoa[]>(entrada ? '/pessoas?classificacao=cliente' : null).dados ?? []).filter((p) => p.ativo)
  const [contaId, setContaId] = useState(0)
  const [historico, setHistorico] = useState('')
  const [clienteId, setClienteId] = useState(0)
  const [contaDoClienteId, setContaDoClienteId] = useState(0)
  const [observacao, setObservacao] = useState('')
  const [varios, setVarios] = useState<{ contaId: number; valor: number }[]>([])
  const somaVarios = varios.reduce((s, v) => s + v.valor, 0)
  const outrasContas = (useDados<ContaFinanceira[]>('/contas-financeiras').dados ?? []).filter((c) => c.ativa && c.id !== linha.contaFinanceira.id)
  const [outraContaId, setOutraContaId] = useState(0)
  const { erro, ocupado, executar } = useAcao()
  const cabem = titulos.filter((t) => t.valor - t.valorPago >= linha.valor)
  const doCliente = titulos.filter((t) => t.pessoa?.id === clienteId && t.valor - t.valorPago < linha.valor)

  const resolver = (acao: string, corpo: unknown) =>
    executar(async () => {
      await api(`/conciliacao/${linha.id}/${acao}`, { body: corpo })
      props.onResolvida()
    })
  const aplicar = (s: SugestaoConciliacao) => {
    if (s.acao === 'VINCULO') return resolver('vincular', { movimentoId: s.movimentoId })
    if (s.acao === 'BAIXA') return resolver('baixar', { tipo: s.tipo, contaId: s.contaId })
    // A sugestão de crédito só preenche o formulário de depósito a maior; quem confirma é o usuário.
    const titulo = titulos.find((t) => t.id === s.contaId)
    setClienteId(titulo?.pessoa?.id ?? 0)
    setContaDoClienteId(s.contaId ?? 0)
  }

  return (
    <Modal titulo={`${entrada ? 'Entrada' : 'Saída'} de ${brl(linha.valor)} em ${dataBr(linha.data)}`} onFechar={props.onFechar} largo>
      <p>
        {linha.contaFinanceira.nome} · <strong>{linha.descricao}</strong>
      </p>
      <Erro mensagem={erro} />

      {linha.sugestoes && linha.sugestoes.length > 0 && (
        <>
          <h3>Sugestões</h3>
          <table>
            <tbody>
              {linha.sugestoes.map((s, i) => (
                <tr key={i}>
                  <td>{textoDaSugestao(s)}</td>
                  <td className="num">{s.pontuacao} pontos</td>
                  <td className="num">
                    <button type="button" className="botao botao-texto" disabled={ocupado} onClick={() => aplicar(s)}>
                      {s.acao === 'CREDITO' ? 'Preencher abaixo' : acoesDaSugestao[s.acao]}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Baixar outro título</h3>
      <div className="form">
        <Campo rotulo={entrada ? 'Conta a receber com saldo suficiente' : 'Conta a pagar com saldo suficiente'} largura={2}>
          <select value={contaId || ''} onChange={(e) => setContaId(Number(e.target.value))}>
            <option value="">{cabem.length ? 'Selecione…' : 'Nenhum título em aberto com saldo suficiente'}</option>
            {cabem.map((t) => (
              <option key={t.id} value={t.id}>
                {t.descricao}
                {t.pessoa && ` · ${t.pessoa.nome}`} · saldo {brl(t.valor - t.valorPago)}
              </option>
            ))}
          </select>
        </Campo>
        <div className="form-pe">
          <button type="button" className="botao" disabled={ocupado || !contaId} onClick={() => resolver('baixar', { tipo: entrada ? 'CONTA_RECEBER' : 'CONTA_PAGAR', contaId })}>
            Baixar {brl(linha.valor)}
          </button>
        </div>
      </div>

      <h3>Baixar vários títulos</h3>
      <p className="texto-suave">Um depósito que paga duas vendas, um pagamento que quita várias contas. Os valores precisam somar {brl(linha.valor)}.</p>
      <div className="form">
        <Campo rotulo="Incluir título" largura={3}>
          <select
            value=""
            onChange={(e) => {
              const titulo = titulos.find((t) => t.id === Number(e.target.value))
              if (!titulo) return
              const falta = Math.max(0, linha.valor - somaVarios)
              setVarios([...varios, { contaId: titulo.id, valor: Math.min(titulo.valor - titulo.valorPago, falta) }])
            }}
          >
            <option value="">Selecione…</option>
            {titulos
              .filter((t) => !varios.some((v) => v.contaId === t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.descricao}
                  {t.pessoa && ` · ${t.pessoa.nome}`} · saldo {brl(t.valor - t.valorPago)}
                </option>
              ))}
          </select>
        </Campo>
        {varios.length > 0 && (
          <div className="col-3">
            <table>
              <tbody>
                {varios.map((v, i) => {
                  const titulo = titulos.find((t) => t.id === v.contaId)
                  return (
                    <tr key={v.contaId}>
                      <td>
                        {titulo?.descricao}
                        {titulo?.pessoa && <small className="texto-suave"> · {titulo.pessoa.nome}</small>}
                      </td>
                      <td className="num">
                        <Dinheiro
                          className="curto"
                          aria-label="Valor a baixar"
                          valor={v.valor}
                          onChange={(valor) => setVarios(varios.map((x, n) => (n === i ? { ...x, valor } : x)))}
                        />
                      </td>
                      <td>
                        <button type="button" className="botao-icone" aria-label="Tirar título" onClick={() => setVarios(varios.filter((_, n) => n !== i))}>
                          <Icone nome="fechar" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className={somaVarios === linha.valor ? 'texto-suave' : 'texto-ruim'}>
              Soma {brl(somaVarios)} de {brl(linha.valor)}
            </p>
          </div>
        )}
        <div className="form-pe">
          <button
            type="button"
            className="botao"
            disabled={ocupado || varios.length < 2 || somaVarios !== linha.valor || varios.some((v) => v.valor <= 0)}
            onClick={() => resolver('baixar', { titulos: varios.map((v) => ({ ...v, tipo: entrada ? 'CONTA_RECEBER' : 'CONTA_PAGAR' })) })}
          >
            Baixar {varios.length || ''} títulos
          </button>
        </div>
      </div>

      {outrasContas.length > 0 && (
        <>
          <h3>Transferência entre contas próprias</h3>
          <div className="form">
            <Campo rotulo={entrada ? 'Veio da conta' : 'Foi para a conta'} largura={2}>
              <select value={outraContaId || ''} onChange={(e) => setOutraContaId(Number(e.target.value))}>
                <option value="">Selecione…</option>
                {outrasContas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </Campo>
            <div className="form-pe">
              <button type="button" className="botao" disabled={ocupado || !outraContaId} onClick={() => resolver('transferencia', { contaFinanceiraId: outraContaId })}>
                Lançar a transferência
              </button>
            </div>
            <p className="texto-suave col-3">
              A outra ponta é lançada na conta escolhida. Quando o extrato dela for importado, a linha correspondente é sugerida para vínculo.
            </p>
          </div>
        </>
      )}

      {entrada && (
        <>
          <h3>Depósito a maior</h3>
          <div className="form">
            <Campo rotulo="Cliente">
              <Escolha
                opcoes={opcoesDePessoas(clientes)}
                valor={clienteId}
                onChange={(id) => {
                  setClienteId(id)
                  setContaDoClienteId(0)
                }}
              />
            </Campo>
            <Campo rotulo="Conta a quitar (opcional)" largura={2}>
              <select value={contaDoClienteId || ''} onChange={(e) => setContaDoClienteId(Number(e.target.value))} disabled={!clienteId}>
                <option value="">Nenhuma: o depósito inteiro vira crédito</option>
                {doCliente.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.descricao} · saldo {brl(t.valor - t.valorPago)}
                  </option>
                ))}
              </select>
            </Campo>
            <div className="form-pe">
              <button type="button" className="botao" disabled={ocupado || !clienteId} onClick={() => resolver('credito', { clienteId, contaReceberId: contaDoClienteId || null })}>
                {contaDoClienteId ? 'Quitar a conta e gerar crédito do excedente' : `Gerar crédito de ${brl(linha.valor)}`}
              </button>
            </div>
          </div>
        </>
      )}

      <h3>Lançamento avulso</h3>
      <div className="form">
        <Campo rotulo="O que é (tarifa bancária, rendimento, imposto…)" largura={2}>
          <input value={historico} onChange={(e) => setHistorico(e.target.value)} />
        </Campo>
        <div className="form-pe">
          <button type="button" className="botao" disabled={ocupado || historico.trim().length < 2} onClick={() => resolver('avulso', { historico })}>
            Lançar no extrato da conta
          </button>
        </div>
      </div>

      <h3>Ignorar</h3>
      <div className="form">
        <Campo rotulo="Motivo (opcional). A linha fica de fora e o saldo não muda." largura={2}>
          <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: transferência entre contas próprias" />
        </Campo>
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Fechar
          </button>
          <button type="button" className="botao botao-perigo" disabled={ocupado} onClick={() => resolver('ignorar', { observacao })}>
            Ignorar esta linha
          </button>
        </div>
      </div>
    </Modal>
  )
}
