import { useState, type FormEvent, type ReactNode } from 'react'
import { api, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import { brl, dataBr, estaVencida, hojeIso, origensMovimento, tiposContaFinanceira } from '../format'
import type { Conta, ContaFinanceira, Extrato, MovimentoFinanceiro, Pessoa } from '../types'
import { Cabecalho, Campo, Dinheiro, Erro, EstadoLista, Modal, Selo } from '../ui'
import { Conciliacao } from './Conciliacao'
import { Despesas } from './Despesas'

const abas = {
  'contas-receber': { rotulo: 'A receber', baixar: 'Receber', baixa: 'Recebimento', pessoa: 'Cliente', classificacao: 'cliente' },
  'contas-pagar': { rotulo: 'A pagar', baixar: 'Pagar', baixa: 'Pagamento', pessoa: 'Fornecedor', classificacao: 'fornecedor' },
} as const
type AbaContas = keyof typeof abas
type Aba = AbaContas | 'despesas' | 'caixa' | 'conciliacao'
const rotulosDasAbas: Record<Aba, string> = { 'contas-receber': 'A receber', 'contas-pagar': 'A pagar', despesas: 'Despesas', caixa: 'Caixa e bancos', conciliacao: 'Conciliação' }

const saldoDe = (c: Conta) => c.valor - c.valorPago

export function Financeiro() {
  const { pode } = useSessao()
  // Cada aba aparece para quem pode ao menos ver aquela parte do financeiro.
  const liberadas: Aba[] = [
    ...(pode('CONTAS_RECEBER_VISUALIZAR', 'CONTAS_RECEBER_BAIXAR') ? (['contas-receber'] as const) : []),
    ...(pode('CONTAS_PAGAR_VISUALIZAR', 'CONTAS_PAGAR_BAIXAR') ? (['contas-pagar'] as const) : []),
    ...(pode('DESPESAS_VISUALIZAR', 'DESPESAS_LANCAR') ? (['despesas'] as const) : []),
    ...(pode('CAIXA_VISUALIZAR', 'CAIXA_MOVIMENTAR') ? (['caixa'] as const) : []),
    ...(pode('OFX_IMPORTAR', 'CONCILIACAO_VISUALIZAR', 'CONCILIACAO_CONFIRMAR') ? (['conciliacao'] as const) : []),
  ]
  const [escolhida, setAba] = useState<Aba>('contas-receber')
  const aba = liberadas.includes(escolhida) ? escolhida : liberadas[0]

  // As abas ficam logo abaixo do cabeçalho, que muda conforme a aba.
  const seletor = (
    <div className="abas" role="tablist">
      {liberadas.map((chave) => (
        <button key={chave} type="button" role="tab" aria-selected={aba === chave} onClick={() => setAba(chave)}>
          {rotulosDasAbas[chave]}
        </button>
      ))}
    </div>
  )
  if (!aba) return <p className="aviso">Seu perfil de acesso não inclui o financeiro.</p>
  if (aba === 'despesas') return <Despesas seletor={seletor} />
  if (aba === 'conciliacao') return <Conciliacao seletor={seletor} />
  return aba === 'caixa' ? <CaixaBancos seletor={seletor} /> : <Contas key={aba} aba={aba} seletor={seletor} />
}

function Contas({ aba, seletor }: { aba: AbaContas; seletor: ReactNode }) {
  const [status, setStatus] = useState('ABERTA')
  const { dados, erro, carregando, recarregar } = useDados<Conta[]>(`/${aba}${status ? `?status=${status}` : ''}`)
  const [lancando, setLancando] = useState(false)
  const [baixando, setBaixando] = useState<Conta | null>(null)
  const acao = useAcao()
  const contas = dados ?? []
  const config = abas[aba]
  const total = contas.filter((c) => c.status === 'ABERTA').reduce((soma, c) => soma + saldoDe(c), 0)
  const vencido = contas.filter(estaVencida).reduce((soma, c) => soma + saldoDe(c), 0)

  function operar(conta: Conta, operacao: 'estornar' | 'cancelar') {
    const pergunta =
      operacao === 'cancelar' ? `Cancelar "${conta.descricao}"?` : `Estornar a última baixa de "${conta.descricao}"? O valor volta para o saldo da conta.`
    if (!window.confirm(pergunta)) return
    acao.executar(async () => {
      await api(`/${aba}/${conta.id}/${operacao}`, { method: 'POST' })
      recarregar()
    })
  }

  return (
    <>
      <Cabecalho titulo="Financeiro" descricao="Contas a receber e a pagar, com baixas totais ou parciais.">
        <button type="button" className="botao botao-primario" onClick={() => setLancando(true)}>
          Novo lançamento
        </button>
      </Cabecalho>
      {seletor}

      <div className="filtros">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="ABERTA">Em aberto</option>
          <option value="PAGA">Liquidadas</option>
          <option value="CANCELADA">Canceladas</option>
          <option value="">Abertas e liquidadas</option>
        </select>
        <span className="resumo-filtro">
          Em aberto: <strong>{brl(total)}</strong>
          {vencido > 0 && <span className="texto-ruim"> · vencido: {brl(vencido)}</span>}
        </span>
      </div>

      <Erro mensagem={acao.erro} />
      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={contas.length === 0} textoVazio="Nenhum lançamento nesta situação." />
        {contas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Descrição</th>
                <th>{config.pessoa}</th>
                <th>Situação</th>
                <th className="num">Valor</th>
                <th className="num">Saldo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contas.map((c) => {
                const parcial = c.status === 'ABERTA' && c.valorPago > 0
                return (
                  <tr key={c.id}>
                    <td>{dataBr(c.vencimento)}</td>
                    <td>{c.descricao}</td>
                    <td>{c.pessoa?.nome ?? '—'}</td>
                    <td>
                      {estaVencida(c) ? <Selo valor="VENCIDA" /> : <Selo valor={c.status} />}
                      {parcial && <> <Selo valor="PARCIAL" /></>}
                      {c.pagoEm && <small className="texto-suave"> em {dataBr(c.pagoEm)}</small>}
                    </td>
                    <td className="num">{brl(c.valor)}</td>
                    <td className="num">{c.status === 'ABERTA' ? brl(saldoDe(c)) : '—'}</td>
                    <td className="num">
                      {c.status === 'ABERTA' && (
                        <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => setBaixando(c)}>
                          {config.baixar}
                        </button>
                      )}
                      {c.status !== 'ABERTA' && c.valorPago > 0 && (
                        <button type="button" className="botao botao-texto" onClick={() => setBaixando(c)}>
                          Histórico
                        </button>
                      )}
                      {c.status !== 'CANCELADA' && c.valorPago > 0 && (
                        <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => operar(c, 'estornar')}>
                          Estornar
                        </button>
                      )}
                      {c.status === 'ABERTA' && c.valorPago === 0 && (
                        <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => operar(c, 'cancelar')}>
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {lancando && (
        <FormConta
          aba={aba}
          onFechar={() => setLancando(false)}
          onSalvo={() => {
            setLancando(false)
            recarregar()
          }}
        />
      )}
      {baixando && (
        <Baixa
          aba={aba}
          conta={baixando}
          onFechar={() => {
            setBaixando(null)
            recarregar()
          }}
        />
      )}
    </>
  )
}

// Recebe ou paga a conta, no todo ou em parte, e mostra o histórico de baixas e estornos.
function Baixa(props: { aba: AbaContas; conta: Conta; onFechar: () => void }) {
  const config = abas[props.aba]
  const [conta, setConta] = useState(props.conta)
  const contasFinanceiras = (useDados<ContaFinanceira[]>('/contas-financeiras').dados ?? []).filter((c) => c.ativa)
  const historico = useDados<MovimentoFinanceiro[]>(`/${props.aba}/${conta.id}/baixas`)
  const [contaFinanceiraId, setContaFinanceiraId] = useState(0)
  const [valor, setValor] = useState(saldoDe(props.conta))
  const [data, setData] = useState(hojeIso())
  const [observacao, setObservacao] = useState('')
  const { erro, ocupado, executar } = useAcao()
  const aberta = conta.status === 'ABERTA'
  // Com uma só conta financeira ativa, ela já vem escolhida.
  const escolhida = contaFinanceiraId || (contasFinanceiras.length === 1 ? contasFinanceiras[0].id : 0)

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const atualizada = await api<Conta>(`/${props.aba}/${conta.id}/baixar`, {
        body: { valor, data, contaFinanceiraId: escolhida || null, observacao },
      })
      setConta(atualizada)
      setValor(saldoDe(atualizada))
      setObservacao('')
      historico.recarregar()
    })
  }

  return (
    <Modal titulo={`${config.baixa} · ${conta.descricao}`} onFechar={props.onFechar} largo>
      <p>
        {conta.pessoa?.nome ?? `Sem ${config.pessoa.toLowerCase()}`} · vencimento {dataBr(conta.vencimento)} · valor {brl(conta.valor)} · saldo{' '}
        <strong>{brl(aberta ? saldoDe(conta) : 0)}</strong>
      </p>
      {aberta && (
        <form onSubmit={enviar} className="form">
          <Campo rotulo="Conta financeira" largura={3}>
            <select required value={escolhida || ''} onChange={(e) => setContaFinanceiraId(Number(e.target.value))}>
              <option value="">Selecione…</option>
              {contasFinanceiras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} · {tiposContaFinanceira[c.tipo] ?? c.tipo}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Valor (R$)">
            <Dinheiro required autoFocus valor={valor} onChange={setValor} />
          </Campo>
          <Campo rotulo="Data">
            <input type="date" required value={data} onChange={(e) => setData(e.target.value)} />
          </Campo>
          <Campo rotulo="Observação">
            <input value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </Campo>
          {valor > 0 && valor < saldoDe(conta) && (
            <p className="texto-suave col-3">Baixa parcial: a conta continua em aberto com saldo de {brl(saldoDe(conta) - valor)}.</p>
          )}
          <Erro mensagem={erro} />
          <div className="form-pe">
            <button type="button" className="botao" onClick={props.onFechar}>
              Fechar
            </button>
            <button className="botao botao-primario" disabled={ocupado || valor <= 0}>
              {config.baixar}
            </button>
          </div>
        </form>
      )}

      <h3>Histórico</h3>
      <EstadoLista carregando={historico.carregando} erro={historico.erro} vazia={(historico.dados ?? []).length === 0} textoVazio="Nenhuma baixa registrada." />
      {(historico.dados ?? []).length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Operação</th>
              <th>Conta financeira</th>
              <th>Observação</th>
              <th>Usuário</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {historico.dados!.map((m) => (
              <tr key={m.id}>
                <td>{dataBr(m.data)}</td>
                <td>
                  {origensMovimento[m.origem] ?? m.origem}
                  {m.estornado && <small className="texto-suave"> (estornado)</small>}
                </td>
                <td>{m.contaFinanceira.nome}</td>
                <td>{m.observacao ?? '—'}</td>
                <td>{m.usuario?.nome ?? '—'}</td>
                <td className="num">{brl(m.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!aberta && (
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Fechar
          </button>
        </div>
      )}
    </Modal>
  )
}

function FormConta(props: { aba: AbaContas; onFechar: () => void; onSalvo: () => void }) {
  const config = abas[props.aba]
  const pessoas = useDados<Pessoa[]>(`/pessoas?classificacao=${config.classificacao}`).dados ?? []
  const [pessoaId, setPessoaId] = useState(0)
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState(0)
  const [vencimento, setVencimento] = useState(hojeIso())
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      await api(`/${props.aba}`, { body: { pessoaId: pessoaId || null, descricao, valor, vencimento } })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={`Novo lançamento · ${config.rotulo.toLowerCase()}`} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Descrição" largura={3}>
          <input required autoFocus value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </Campo>
        <Campo rotulo={`${config.pessoa} (opcional)`} largura={3}>
          <select value={pessoaId} onChange={(e) => setPessoaId(Number(e.target.value))}>
            <option value={0}>—</option>
            {pessoas.filter((p) => p.ativo).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Valor (R$)">
          <Dinheiro required valor={valor} onChange={setValor} />
        </Campo>
        <Campo rotulo="Vencimento" largura={2}>
          <input type="date" required value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </Campo>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            Lançar
          </button>
        </div>
      </form>
    </Modal>
  )
}

// Contas financeiras com o saldo atual e o extrato dos movimentos.
function CaixaBancos({ seletor }: { seletor: ReactNode }) {
  const contas = useDados<ContaFinanceira[]>('/contas-financeiras')
  const [f, setF] = useState({ contaFinanceiraId: '', tipo: '', inicio: '', fim: '' })
  const consulta = new URLSearchParams(Object.entries(f).filter(([, valor]) => valor))
  const extrato = useDados<Extrato>(`/movimentos-financeiros?${consulta}`)
  const [editando, setEditando] = useState<ContaFinanceira | 'nova' | null>(null)
  const lista = contas.dados ?? []
  const linhas = extrato.dados?.linhas ?? []
  const resumo = extrato.dados?.resumo

  function atualizar() {
    contas.recarregar()
    extrato.recarregar()
  }

  return (
    <>
      <Cabecalho titulo="Caixa e bancos" descricao="Saldos das contas financeiras e o extrato de entradas e saídas.">
        <button type="button" className="botao" onClick={atualizar}>
          Atualizar
        </button>
        <button type="button" className="botao botao-primario" onClick={() => setEditando('nova')}>
          Nova conta financeira
        </button>
      </Cabecalho>
      {seletor}

      <EstadoLista carregando={contas.carregando} erro={contas.erro} vazia={lista.length === 0} textoVazio="Nenhuma conta financeira cadastrada." />
      <section className="indicadores">
        {lista.map((c) => (
          <button key={c.id} type="button" className="indicador" onClick={() => setEditando(c)} title="Editar conta financeira">
            <span>
              {c.nome}
              {!c.ativa && ' (inativa)'}
            </span>
            <strong className={c.saldo < 0 ? 'texto-ruim' : ''}>{brl(c.saldo)}</strong>
            <small className="texto-suave">{[tiposContaFinanceira[c.tipo] ?? c.tipo, c.instituicao].filter(Boolean).join(' · ')}</small>
          </button>
        ))}
      </section>

      <section className="painel filtros-relatorio">
        <Campo rotulo="Conta">
          <select value={f.contaFinanceiraId} onChange={(e) => setF({ ...f, contaFinanceiraId: e.target.value })}>
            <option value="">Todas as contas</option>
            {lista.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Tipo">
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            <option value="">Entradas e saídas</option>
            <option value="ENTRADA">Entradas</option>
            <option value="SAIDA">Saídas</option>
          </select>
        </Campo>
        <Campo rotulo="Período inicial">
          <input type="date" value={f.inicio} max={f.fim || undefined} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Período final">
          <input type="date" value={f.fim} min={f.inicio || undefined} onChange={(e) => setF({ ...f, fim: e.target.value })} />
        </Campo>
      </section>

      {resumo && (
        <section className="indicadores">
          <div className="indicador">
            <span>Saldo inicial</span>
            <strong>{brl(resumo.saldoInicial)}</strong>
          </div>
          <div className="indicador">
            <span>Entradas no período</span>
            <strong>{brl(resumo.entradas)}</strong>
          </div>
          <div className="indicador">
            <span>Saídas no período</span>
            <strong>{brl(resumo.saidas)}</strong>
          </div>
          {!f.tipo && (
            <div className="indicador">
              <span>Saldo final</span>
              <strong className={resumo.saldoFinal < 0 ? 'texto-ruim' : ''}>{brl(resumo.saldoFinal)}</strong>
            </div>
          )}
        </section>
      )}

      <section className="painel">
        <EstadoLista carregando={extrato.carregando} erro={extrato.erro} vazia={linhas.length === 0} textoVazio="Nenhuma movimentação para estes filtros." />
        {linhas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Conta</th>
                <th>Histórico</th>
                <th>Origem</th>
                <th className="num">Entrada</th>
                <th className="num">Saída</th>
                <th>Usuário</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((m) => (
                <tr key={m.id}>
                  <td>{dataBr(m.data)}</td>
                  <td>{m.contaFinanceira.nome}</td>
                  <td>
                    {m.historico}
                    {m.observacao && <small className="texto-suave"> · {m.observacao}</small>}
                  </td>
                  <td>
                    {origensMovimento[m.origem] ?? m.origem}
                    {m.estornado && <small className="texto-suave"> (estornado)</small>}
                    {m.extratoId && <small className="bloco texto-suave">conciliado com o banco</small>}
                  </td>
                  <td className="num">{m.tipo === 'ENTRADA' ? brl(m.valor) : '—'}</td>
                  <td className="num">{m.tipo === 'SAIDA' ? brl(m.valor) : '—'}</td>
                  <td>{m.usuario?.nome ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editando && (
        <FormContaFinanceira
          conta={editando === 'nova' ? null : editando}
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

function FormContaFinanceira(props: { conta: ContaFinanceira | null; onFechar: () => void; onSalvo: () => void }) {
  const { conta } = props
  const [f, setF] = useState({
    nome: conta?.nome ?? '',
    tipo: conta?.tipo ?? 'CONTA_CORRENTE',
    instituicao: conta?.instituicao ?? '',
    codigoBanco: conta?.codigoBanco ?? '',
    agencia: conta?.agencia ?? '',
    numeroConta: conta?.numeroConta ?? '',
    documentoTitular: conta?.documentoTitular ?? '',
    saldoInicial: conta?.saldoInicial ?? 0,
    ativa: conta?.ativa ?? true,
  })
  const { erro, ocupado, executar } = useAcao()
  const banco = f.tipo !== 'CAIXA'

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      await api(conta ? `/contas-financeiras/${conta.id}` : '/contas-financeiras', { method: conta ? 'PUT' : 'POST', body: f })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={conta ? `Conta financeira · ${conta.nome}` : 'Nova conta financeira'} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Nome" largura={2}>
          <input required autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="Tipo">
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as ContaFinanceira['tipo'] })}>
            {Object.entries(tiposContaFinanceira).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </Campo>
        {banco && (
          <>
            <Campo rotulo="Instituição financeira" largura={2}>
              <input value={f.instituicao} onChange={(e) => setF({ ...f, instituicao: e.target.value })} />
            </Campo>
            <Campo rotulo="Código do banco">
              <input value={f.codigoBanco} onChange={(e) => setF({ ...f, codigoBanco: e.target.value })} />
            </Campo>
            <Campo rotulo="Agência">
              <input value={f.agencia} onChange={(e) => setF({ ...f, agencia: e.target.value })} />
            </Campo>
            <Campo rotulo="Número da conta">
              <input value={f.numeroConta} onChange={(e) => setF({ ...f, numeroConta: e.target.value })} />
            </Campo>
            <Campo rotulo="CPF ou CNPJ do titular">
              <input value={f.documentoTitular} onChange={(e) => setF({ ...f, documentoTitular: e.target.value })} />
            </Campo>
          </>
        )}
        <Campo rotulo="Saldo inicial (R$)">
          <Dinheiro valor={f.saldoInicial} onChange={(saldoInicial) => setF({ ...f, saldoInicial })} />
        </Campo>
        <label className="marcar col-2">
          <input type="checkbox" checked={f.ativa} onChange={(e) => setF({ ...f, ativa: e.target.checked })} />
          Ativa (aparece para receber e pagar)
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
