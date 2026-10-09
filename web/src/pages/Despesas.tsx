// Aba de despesas do financeiro: lançar a despesa gera as contas a pagar dela.
import { useState, type FormEvent, type ReactNode } from 'react'
import { api, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import { Documentos } from '../Documentos'
import { brl, dataBr, formasPagamentoDespesa, hojeIso, mascaraDocumento, mascaraTelefone } from '../format'
import { exportarCsv, type Coluna } from '../relatorio'
import type { ContaFinanceira, Despesa, ListaDespesas, Pessoa } from '../types'
import { Cabecalho, Campo, Dinheiro, Erro, EstadoLista, Modal, Selo, usePaginacao } from '../ui'
import { CampoData } from '../calendario'

type Parcela = { vencimento: string; valor: number }

const colunasExportacao: Coluna<Despesa>[] = [
  { rotulo: 'Nº', valor: (d) => d.id },
  { rotulo: 'Fornecedor', valor: (d) => d.fornecedor.nome },
  { rotulo: 'Elemento', valor: (d) => d.elemento },
  { rotulo: 'Descrição', valor: (d) => d.descricao },
  { rotulo: 'Documento', valor: (d) => d.numeroDocumento },
  { rotulo: 'Emissão', valor: (d) => d.dataEmissao, tipo: 'data' },
  { rotulo: 'Competência', valor: (d) => d.dataCompetencia, tipo: 'data' },
  { rotulo: 'Caixa', valor: (d) => d.dataCaixa, tipo: 'data' },
  { rotulo: 'Condição', valor: (d) => (d.condicaoPagamento === 'A_PRAZO' ? `A prazo, ${d.contasPagar.length}x` : 'À vista') },
  { rotulo: 'Forma', valor: (d) => formasPagamentoDespesa[d.formaPagamento] ?? d.formaPagamento },
  { rotulo: 'Situação', valor: (d) => (d.status === 'CANCELADA' ? 'Cancelada' : 'Ativa') },
  { rotulo: 'Valor', valor: (d) => d.valor, tipo: 'dinheiro' },
  { rotulo: 'Pago', valor: (d) => d.valorPago, tipo: 'dinheiro' },
  { rotulo: 'Usuário', valor: (d) => d.usuario?.nome ?? null },
  { rotulo: 'Observação', valor: (d) => d.observacao },
]

// Data daqui a `meses` meses, no formato dos campos de data.
function daquiA(meses: number) {
  const d = new Date()
  d.setMonth(d.getMonth() + meses)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Divide o total em parcelas mensais iguais; os centavos que sobram vão na última.
function dividir(total: number, quantidade: number): Parcela[] {
  const base = Math.floor(total / quantidade)
  return Array.from({ length: quantidade }, (_, i) => ({ vencimento: daquiA(i + 1), valor: i === quantidade - 1 ? total - base * (quantidade - 1) : base }))
}

export function Despesas({ seletor }: { seletor: ReactNode }) {
  const { pode } = useSessao()
  const lanca = pode('DESPESAS_LANCAR')
  const [f, setF] = useState({ inicio: '', fim: '', fornecedorId: '', elemento: '', status: '' })
  const consulta = new URLSearchParams(Object.entries(f).filter(([, valor]) => valor))
  const despesas = useDados<ListaDespesas>(`/despesas?${consulta}`)
  const elementos = useDados<string[]>('/despesas/elementos')
  const pessoas = useDados<Pessoa[]>(lanca ? '/pessoas' : null)
  const fornecedores = (pessoas.dados ?? []).filter((p) => p.fornecedor || p.prestador)
  const [editando, setEditando] = useState<Despesa | 'nova' | null>(null)
  const [documentosDe, setDocumentosDe] = useState<Despesa | null>(null)
  const acao = useAcao()
  const linhas = despesas.dados?.linhas ?? []
  const paginas = usePaginacao(linhas)
  const resumo = despesas.dados?.resumo
  // No filtro entram os fornecedores que aparecem na lista, para não depender do cadastro de pessoas.
  const fornecedoresDaLista = [...new Map(linhas.map((d) => [d.fornecedor.id, d.fornecedor])).values()]

  const atualizar = () => {
    despesas.recarregar()
    elementos.recarregar()
  }

  function cancelar(d: Despesa) {
    if (!window.confirm(`Cancelar a despesa nº ${d.id} (${d.descricao})? As contas a pagar dela também são canceladas.`)) return
    acao.executar(async () => {
      await api(`/despesas/${d.id}/cancelar`, { method: 'POST' })
      atualizar()
    })
  }

  return (
    <>
      <Cabecalho titulo="Despesas" descricao="Registre as despesas; as contas a pagar são geradas automaticamente.">
        <button type="button" className="botao" onClick={atualizar}>
          Atualizar
        </button>
        <button type="button" className="botao" disabled={linhas.length === 0} onClick={() => exportarCsv('despesas', colunasExportacao, linhas)}>
          Exportar para Excel
        </button>
        {lanca && (
          <button type="button" className="botao botao-primario" onClick={() => setEditando('nova')}>
            Lançar despesa
          </button>
        )}
      </Cabecalho>
      {seletor}

      <section className="painel filtros-relatorio">
        <Campo rotulo="Competência de">
          <CampoData type="date" value={f.inicio} max={f.fim || undefined} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Competência até">
          <CampoData type="date" value={f.fim} min={f.inicio || undefined} onChange={(e) => setF({ ...f, fim: e.target.value })} />
        </Campo>
        <Campo rotulo="Fornecedor">
          <select value={f.fornecedorId} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })}>
            <option value="">Todos</option>
            {fornecedoresDaLista.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Elemento">
          <select value={f.elemento} onChange={(e) => setF({ ...f, elemento: e.target.value })}>
            <option value="">Todos</option>
            {(elementos.dados ?? []).map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Situação">
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Ativas</option>
            <option value="CANCELADA">Canceladas</option>
          </select>
        </Campo>
      </section>

      {resumo && (
        <section className="indicadores">
          <div className="indicador">
            <span>Despesas</span>
            <strong>{resumo.quantidade}</strong>
          </div>
          <div className="indicador">
            <span>Total</span>
            <strong>{brl(resumo.total)}</strong>
          </div>
          <div className="indicador">
            <span>Já pago</span>
            <strong>{brl(resumo.pago)}</strong>
          </div>
          <div className="indicador">
            <span>A pagar</span>
            <strong>{brl(f.status === 'CANCELADA' ? 0 : resumo.total - resumo.pago)}</strong>
          </div>
        </section>
      )}

      <Erro mensagem={acao.erro} />
      <section className="painel">
        <EstadoLista carregando={despesas.carregando} erro={despesas.erro} vazia={linhas.length === 0} textoVazio="Nenhuma despesa para estes filtros." />
        {linhas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Elemento</th>
                <th>Descrição</th>
                <th>Documento</th>
                <th>Competência</th>
                <th>Caixa</th>
                <th>Condição</th>
                <th>Forma</th>
                <th className="num">Valor</th>
                <th>Usuário</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paginas.visiveis.map((d) => (
                <tr key={d.id} className={d.status === 'CANCELADA' ? 'linha-inativa' : ''}>
                  <td>{d.fornecedor.nome}</td>
                  <td>{d.elemento}</td>
                  <td>{d.descricao}</td>
                  <td>{d.numeroDocumento ?? '—'}</td>
                  <td>{dataBr(d.dataCompetencia)}</td>
                  <td>
                    {d.status === 'CANCELADA' ? <Selo valor="CANCELADA" /> : d.dataCaixa ? dataBr(d.dataCaixa) : d.valorPago > 0 ? <Selo valor="PARCIAL" /> : '—'}
                  </td>
                  <td>{d.condicaoPagamento === 'A_PRAZO' ? `A prazo, ${d.contasPagar.length}×` : 'À vista'}</td>
                  <td>{formasPagamentoDespesa[d.formaPagamento] ?? d.formaPagamento}</td>
                  <td className="num">{brl(d.valor)}</td>
                  <td>{d.usuario?.nome ?? '—'}</td>
                  <td className="num">
                    <button type="button" className="botao botao-texto" onClick={() => setDocumentosDe(d)}>
                      Documentos
                    </button>
                    {lanca && d.status === 'ATIVA' && (
                      <>
                        <button type="button" className="botao botao-texto" onClick={() => setEditando(d)}>
                          Corrigir
                        </button>
                        {d.valorPago === 0 && (
                          <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => cancelar(d)}>
                            Cancelar
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
        {paginas.controle}
      </section>

      {editando && (
        <FormDespesa
          despesa={editando === 'nova' ? null : editando}
          fornecedores={fornecedores}
          onFornecedorNovo={pessoas.recarregar}
          elementos={elementos.dados ?? []}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            atualizar()
          }}
        />
      )}
      {documentosDe && (
        <Modal titulo={`Documentos da despesa nº ${documentosDe.id}`} onFechar={() => setDocumentosDe(null)} largo>
          <Documentos origem="DESPESA" origemId={documentosDe.id} />
        </Modal>
      )}
    </>
  )
}

function FormDespesa(props: {
  despesa: Despesa | null
  fornecedores: Pessoa[]
  onFornecedorNovo: () => void
  elementos: string[]
  onFechar: () => void
  onSalvo: () => void
}) {
  const { despesa } = props
  const { pode } = useSessao()
  // Pagar já no lançamento exige a permissão de pagar contas; a conta financeira sai daqui.
  const podePagar = pode('CONTAS_PAGAR_BAIXAR')
  const contas = (useDados<ContaFinanceira[]>(!despesa && podePagar ? '/contas-financeiras' : null).dados ?? []).filter((c) => c.ativa)
  const [pagarAgora, setPagarAgora] = useState(false)
  const [contaFinanceiraId, setContaFinanceiraId] = useState(0)
  const [cadastrando, setCadastrando] = useState(false)
  // O fornecedor recém-cadastrado aparece na lista antes de ela recarregar.
  const [novos, setNovos] = useState<Pessoa[]>([])
  const fornecedores = [...props.fornecedores, ...novos.filter((n) => !props.fornecedores.some((p) => p.id === n.id))]
  const [f, setF] = useState({
    fornecedorId: despesa?.fornecedor.id ?? 0,
    elemento: despesa?.elemento ?? '',
    descricao: despesa?.descricao ?? '',
    numeroDocumento: despesa?.numeroDocumento ?? '',
    dataEmissao: despesa ? despesa.dataEmissao.slice(0, 10) : hojeIso(),
    dataCompetencia: despesa ? despesa.dataCompetencia.slice(0, 10) : hojeIso(),
    formaPagamento: despesa?.formaPagamento ?? '',
    observacao: despesa?.observacao ?? '',
  })
  const [valor, setValor] = useState(despesa?.valor ?? 0)
  const [condicao, setCondicao] = useState<'A_VISTA' | 'A_PRAZO'>(despesa?.condicaoPagamento ?? 'A_VISTA')
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const { erro, ocupado, executar } = useAcao()
  const somaParcelas = parcelas.reduce((s, p) => s + p.valor, 0)

  function escolherCondicao(nova: 'A_VISTA' | 'A_PRAZO') {
    setCondicao(nova)
    setParcelas(nova === 'A_PRAZO' && valor > 0 ? dividir(valor, 2) : [])
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      if (despesa) await api(`/despesas/${despesa.id}`, { method: 'PUT', body: f })
      else
        await api('/despesas', {
          body: {
            ...f,
            valor,
            condicaoPagamento: condicao,
            parcelas: condicao === 'A_PRAZO' ? parcelas : [],
            pagamento: condicao === 'A_VISTA' && pagarAgora ? { contaFinanceiraId, data: f.dataEmissao } : null,
          },
        })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={despesa ? `Corrigir despesa nº ${despesa.id}` : 'Lançar despesa'} onFechar={props.onFechar} largo>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Fornecedor ou prestador" largura={2}>
          <select required autoFocus value={f.fornecedorId || ''} onChange={(e) => setF({ ...f, fornecedorId: Number(e.target.value) })}>
            <option value="">Selecione…</option>
            {fornecedores
              .filter((p) => p.ativo || p.id === f.fornecedorId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
          </select>
          {pode('PESSOAS_CADASTRAR') ? (
            <button type="button" className="botao botao-texto" style={{ alignSelf: 'flex-start' }} onClick={() => setCadastrando(true)}>
              + Cadastrar fornecedor
            </button>
          ) : (
            fornecedores.length === 0 && <small className="texto-suave">Marque "Fornecedor" ou "Prestador de serviço" no cadastro da pessoa para ela aparecer aqui.</small>
          )}
        </Campo>
        <Campo rotulo="Elemento">
          <input required list="elementos-despesa" value={f.elemento} onChange={(e) => setF({ ...f, elemento: e.target.value })} placeholder="Ex.: Aluguel, energia, frete" />
          <datalist id="elementos-despesa">
            {props.elementos.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </Campo>
        <Campo rotulo="Descrição" largura={2}>
          <input required value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        </Campo>
        <Campo rotulo="Nº do documento">
          <input value={f.numeroDocumento} onChange={(e) => setF({ ...f, numeroDocumento: e.target.value })} />
        </Campo>
        <Campo rotulo="Data de emissão">
          <CampoData type="date" required value={f.dataEmissao} onChange={(e) => setF({ ...f, dataEmissao: e.target.value })} />
        </Campo>
        <Campo rotulo="Competência">
          <CampoData type="date" required value={f.dataCompetencia} onChange={(e) => setF({ ...f, dataCompetencia: e.target.value })} />
        </Campo>
        <Campo rotulo="Forma de pagamento">
          <select required value={f.formaPagamento} onChange={(e) => setF({ ...f, formaPagamento: e.target.value })}>
            <option value="">Selecione…</option>
            {Object.entries(formasPagamentoDespesa).map(([codigo, rotulo]) => (
              <option key={codigo} value={codigo}>
                {rotulo}
              </option>
            ))}
          </select>
        </Campo>

        {despesa ? (
          <p className="texto-suave col-3">
            Valor ({brl(despesa.valor)}), condição e parcelas não mudam na correção. Para alterá-los, cancele esta despesa e lance outra.
          </p>
        ) : (
          <>
            <Campo rotulo="Valor total (R$)">
              <Dinheiro
                required
                valor={valor}
                onChange={(novo) => {
                  setValor(novo)
                  if (condicao === 'A_PRAZO') setParcelas(novo > 0 ? dividir(novo, Math.max(1, parcelas.length)) : [])
                }}
              />
            </Campo>
            <Campo rotulo="Condição de pagamento">
              <select value={condicao} onChange={(e) => escolherCondicao(e.target.value as 'A_VISTA' | 'A_PRAZO')}>
                <option value="A_VISTA">À vista</option>
                <option value="A_PRAZO">A prazo</option>
              </select>
            </Campo>
            {condicao === 'A_PRAZO' && (
              <Campo rotulo="Parcelas">
                <input type="number" min={1} max={60} value={parcelas.length || ''} onChange={(e) => setParcelas(valor > 0 ? dividir(valor, Math.min(60, Math.max(1, Number(e.target.value) || 1))) : [])} />
              </Campo>
            )}
            {condicao === 'A_VISTA' && podePagar && (
              <>
                <Campo rotulo="Pagamento">
                  <select value={pagarAgora ? 'AGORA' : 'DEPOIS'} onChange={(e) => setPagarAgora(e.target.value === 'AGORA')}>
                    <option value="DEPOIS">Pagar depois, em "A pagar"</option>
                    <option value="AGORA">Já pago, na data de emissão</option>
                  </select>
                </Campo>
                {pagarAgora && (
                  <Campo rotulo="Saiu da conta">
                    <select required value={contaFinanceiraId || ''} onChange={(e) => setContaFinanceiraId(Number(e.target.value))}>
                      <option value="">Selecione…</option>
                      {contas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </Campo>
                )}
              </>
            )}
            {condicao === 'A_VISTA' && (
              <p className="texto-suave col-3">
                {pagarAgora
                  ? 'Gera a conta a pagar já paga, com a saída na conta escolhida e na data de emissão.'
                  : 'Gera uma conta a pagar com vencimento na data de emissão. O pagamento é registrado em Financeiro, na aba "A pagar".'}
              </p>
            )}
            {condicao === 'A_PRAZO' && parcelas.length > 0 && (
              <div className="col-3">
                <table>
                  <thead>
                    <tr>
                      <th>Parcela</th>
                      <th>Vencimento</th>
                      <th className="num">Valor (R$)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcelas.map((p, i) => (
                      <tr key={i}>
                        <td>{i + 1}/{parcelas.length}</td>
                        <td>
                          <CampoData type="date" required aria-label={`Vencimento da parcela ${i + 1}`} value={p.vencimento} onChange={(e) => setParcelas(parcelas.map((x, n) => (n === i ? { ...x, vencimento: e.target.value } : x)))} />
                        </td>
                        <td className="num">
                          <Dinheiro className="curto" aria-label={`Valor da parcela ${i + 1}`} valor={p.valor} onChange={(novo) => setParcelas(parcelas.map((x, n) => (n === i ? { ...x, valor: novo } : x)))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {somaParcelas !== valor && <p className="texto-ruim">As parcelas somam {brl(somaParcelas)}; o total da despesa é {brl(valor)}.</p>}
              </div>
            )}
          </>
        )}
        <Campo rotulo="Observação" largura={3}>
          <input value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} />
        </Campo>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado || (!despesa && (valor <= 0 || (condicao === 'A_PRAZO' && somaParcelas !== valor)))}>
            {despesa ? 'Salvar' : 'Lançar despesa'}
          </button>
        </div>
      </form>
      {cadastrando && (
        <NovoFornecedor
          onFechar={() => setCadastrando(false)}
          onSalvo={(pessoa) => {
            setNovos([...novos, pessoa])
            setF((atual) => ({ ...atual, fornecedorId: pessoa.id }))
            setCadastrando(false)
            props.onFornecedorNovo()
          }}
        />
      )}
    </Modal>
  )
}

// Cadastro rápido de fornecedor ou prestador, sem sair do lançamento. O cadastro completo fica em Pessoas.
function NovoFornecedor(props: { onFechar: () => void; onSalvo: (pessoa: Pessoa) => void }) {
  const [f, setF] = useState({ nome: '', documento: '', telefone: '', email: '', tipo: 'fornecedor' as 'fornecedor' | 'prestador' })
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    // O formulário fica dentro de outro; o envio não pode chegar ao lançamento da despesa.
    e.stopPropagation()
    executar(async () => {
      const { tipo, ...dados } = f
      props.onSalvo(await api<Pessoa>('/pessoas', { body: { ...dados, [tipo]: true } }))
    })
  }

  return (
    <Modal titulo="Cadastrar fornecedor" onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Nome ou razão social" largura={3}>
          <input required autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="Tipo">
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as 'fornecedor' | 'prestador' })}>
            <option value="fornecedor">Fornecedor</option>
            <option value="prestador">Prestador de serviço</option>
          </select>
        </Campo>
        <Campo rotulo="CPF ou CNPJ">
          <input inputMode="numeric" value={mascaraDocumento(f.documento)} onChange={(e) => setF({ ...f, documento: mascaraDocumento(e.target.value) })} />
        </Campo>
        <Campo rotulo="Telefone">
          <input type="tel" value={mascaraTelefone(f.telefone)} onChange={(e) => setF({ ...f, telefone: mascaraTelefone(e.target.value) })} />
        </Campo>
        <Campo rotulo="E-mail" largura={3}>
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Campo>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            Cadastrar
          </button>
        </div>
      </form>
    </Modal>
  )
}
