import { useState, type FormEvent } from 'react'
import { api, useAcao, useDados } from '../api'
import { brl, dataBr, inteiro, qtd, saldoBase, unidades } from '../format'
import type { Movimento, Produto } from '../types'
import { Cabecalho, Campo, Dinheiro, Erro, EstadoLista, Modal, Selo } from '../ui'

type Rascunho = Omit<Produto, 'id' | 'saldo' | 'divisor'> & { id?: number }

const novo = (): Rascunho => ({
  sku: '', nome: '', ean: '', unidade: 'UN', unidades: [], controlaEstoque: true, precoCusto: 0, precoVenda: 0, estoqueMinimo: 0, ativo: true,
})

export function Produtos() {
  const [busca, setBusca] = useState('')
  const { dados, erro, carregando, recarregar } = useDados<Produto[]>(`/produtos?${new URLSearchParams(busca ? { busca } : {})}`)
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const [estoqueDe, setEstoqueDe] = useState<Produto | null>(null)
  const produtos = dados ?? []

  return (
    <>
      <Cabecalho titulo="Produtos e estoque" descricao="Cadastro, preços e saldo em estoque.">
        <button type="button" className="botao botao-primario" onClick={() => setEditando(novo())}>
          Novo produto
        </button>
      </Cabecalho>

      <div className="filtros">
        <input type="search" placeholder="Buscar por descrição, código ou EAN" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={produtos.length === 0} textoVazio="Nenhum produto encontrado." />
        {produtos.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Unidade</th>
                <th className="num">Custo atual</th>
                <th className="num">Venda</th>
                <th className="num">Saldo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={p.id} className={p.ativo ? '' : 'linha-inativa'}>
                  <td className="texto-suave">{p.sku}</td>
                  <td>
                    {p.nome} {!p.ativo && <Selo valor="Inativo" tom="apagado" />}
                    {p.ean && <small className="bloco texto-suave">EAN {p.ean}</small>}
                  </td>
                  <td>
                    {p.unidade}
                    {p.unidades.length > 0 && (
                      <small className="bloco texto-suave">{p.unidades.map((u) => `${u.fator} ${u.sigla}`).join(' · ')}</small>
                    )}
                  </td>
                  <td className="num">{brl(p.precoCusto)}</td>
                  <td className="num">{brl(p.precoVenda)}</td>
                  <td className="num">
                    {!p.controlaEstoque ? (
                      <span className="texto-suave">Não controla</span>
                    ) : (
                      <>
                        {qtd(saldoBase(p))}{' '}
                        {p.saldo <= 0 ? <Selo valor="Sem estoque" tom="ruim" /> : saldoBase(p) <= p.estoqueMinimo && <Selo valor="Baixo" tom="alerta" />}
                      </>
                    )}
                  </td>
                  <td className="num">
                    {p.controlaEstoque && (
                      <button type="button" className="botao botao-texto" onClick={() => setEstoqueDe(p)}>
                        Estoque
                      </button>
                    )}
                    <button type="button" className="botao botao-texto" onClick={() => setEditando(p)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editando && (
        <FormProduto
          inicial={editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            recarregar()
          }}
        />
      )}
      {estoqueDe && (
        <Estoque
          produto={estoqueDe}
          onFechar={() => setEstoqueDe(null)}
          onAjustado={() => {
            setEstoqueDe(null)
            recarregar()
          }}
        />
      )}
    </>
  )
}

function FormProduto(props: { inicial: Rascunho; onFechar: () => void; onSalvo: () => void }) {
  const [p, setP] = useState(props.inicial)
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      // O custo não vai no cadastro: ele é atualizado pelas entradas de estoque.
      const corpo = {
        sku: p.sku, nome: p.nome, ean: p.ean, unidade: p.unidade, controlaEstoque: p.controlaEstoque,
        precoVenda: p.precoVenda, estoqueMinimo: p.controlaEstoque ? p.estoqueMinimo : 0, ativo: p.ativo,
        // Preço zerado na unidade extra significa "proporcional ao da unidade base".
        unidades: p.unidades.map((u) => ({ sigla: u.sigla, fator: u.fator, precoVenda: u.precoVenda || null })),
      }
      await api(p.id ? `/produtos/${p.id}` : '/produtos', { method: p.id ? 'PUT' : 'POST', body: corpo })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={p.id ? 'Editar produto' : 'Novo produto'} onFechar={props.onFechar} largo>
      <form onSubmit={enviar} className="form">
        <h3 className="secao col-3">Dados do produto</h3>
        <Campo rotulo="Descrição" largura={3}>
          <input required autoFocus placeholder="Descrição do produto" value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="Código interno">
          <input placeholder={p.id ? '' : 'Gerado se ficar em branco'} required={Boolean(p.id)} value={p.sku} onChange={(e) => setP({ ...p, sku: e.target.value })} />
        </Campo>
        <Campo rotulo="EAN">
          <input inputMode="numeric" placeholder="Código de barras" value={p.ean ?? ''} onChange={(e) => setP({ ...p, ean: e.target.value.replace(/\D/g, '') })} />
        </Campo>
        <Campo rotulo="Unidade base do estoque e custo">
          <select
            value={p.unidade}
            // A unidade base não pode se repetir entre as extras.
            onChange={(e) => setP({ ...p, unidade: e.target.value, unidades: p.unidades.filter((u) => u.sigla !== e.target.value) })}
          >
            {!(p.unidade in unidades) && <option value={p.unidade}>{p.unidade}</option>}
            {Object.entries(unidades).map(([sigla, nome]) => (
              <option key={sigla} value={sigla}>
                {sigla} - {nome}
              </option>
            ))}
          </select>
        </Campo>

        <h3 className="secao col-3">Unidades para entrada e venda</h3>
        <div className="col-3">
          <p className="texto-suave">
            Estoque e custo permanecem em {p.unidade}. O fator diz quantas unidades cabem em 1 {p.unidade}: AMP com fator 4 significa
            quatro ampolas por {(unidades[p.unidade] ?? p.unidade).toLowerCase()}.
          </p>
          {p.unidades.length > 0 && (
            <table className="unidades-extras">
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th className="num">Fator (por {p.unidade})</th>
                  <th className="num">Preço de venda próprio (R$)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.unidades.map((u, i) => {
                  const trocar = (parte: Partial<Produto['unidades'][number]>) =>
                    setP({ ...p, unidades: p.unidades.map((x, n) => (n === i ? { ...x, ...parte } : x)) })
                  const emUso = new Set([p.unidade, ...p.unidades.filter((_, n) => n !== i).map((x) => x.sigla)])
                  return (
                    <tr key={i}>
                      <td>
                        <select aria-label="Unidade" value={u.sigla} onChange={(e) => trocar({ sigla: e.target.value })}>
                          {Object.entries(unidades).filter(([sigla]) => !emUso.has(sigla)).map(([sigla, nome]) => (
                            <option key={sigla} value={sigla}>
                              {sigla} - {nome}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num">
                        <input type="number" min={2} required className="curto" aria-label="Fator" value={u.fator || ''}
                          onChange={(e) => trocar({ fator: inteiro(e.target.value) })} />
                      </td>
                      <td className="num">
                        <Dinheiro className="curto" aria-label="Preço de venda próprio" valor={u.precoVenda ?? 0} onChange={(precoVenda) => trocar({ precoVenda })} />
                        {!u.precoVenda && u.fator > 0 && (
                          <small className="bloco texto-suave">proporcional: {brl(Math.round(p.precoVenda / u.fator))}</small>
                        )}
                      </td>
                      <td className="num">
                        <button type="button" className="botao-icone" aria-label={`Remover ${u.sigla}`}
                          onClick={() => setP({ ...p, unidades: p.unidades.filter((_, n) => n !== i) })}>
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <button
            type="button"
            className="botao botao-texto"
            onClick={() => {
              const livre = Object.keys(unidades).find((sigla) => sigla !== p.unidade && !p.unidades.some((u) => u.sigla === sigla))
              if (livre) setP({ ...p, unidades: [...p.unidades, { sigla: livre, fator: 2, precoVenda: null }] })
            }}
          >
            + Adicionar unidade
          </button>
        </div>

        <h3 className="secao col-3">Preço e estoque</h3>
        <Campo rotulo={`Preço de venda por ${p.unidade} (R$)`}>
          <Dinheiro valor={p.precoVenda} onChange={(precoVenda) => setP({ ...p, precoVenda })} />
        </Campo>
        <Campo rotulo="Estoque mínimo">
          <input type="number" min={0} disabled={!p.controlaEstoque} value={p.controlaEstoque ? p.estoqueMinimo : ''}
            onChange={(e) => setP({ ...p, estoqueMinimo: inteiro(e.target.value) })} />
        </Campo>
        <Campo rotulo="Custo atual">
          <input disabled value={brl(p.precoCusto)} title="Atualizado pela última entrada de estoque" />
        </Campo>

        <fieldset className="marcacoes col-3">
          <legend className="oculto">Opções</legend>
          <label className="marcar">
            <input type="checkbox" checked={p.controlaEstoque} onChange={(e) => setP({ ...p, controlaEstoque: e.target.checked })} />
            Controla estoque
          </label>
          <label className="marcar">
            <input type="checkbox" checked={p.ativo} onChange={(e) => setP({ ...p, ativo: e.target.checked })} />
            Ativo
          </label>
        </fieldset>
        <p className="texto-suave col-3">
          {p.controlaEstoque
            ? 'O saldo começa em zero e o custo vem das entradas de estoque.'
            : 'Sem controle de estoque, o produto é vendido sem conferir nem baixar saldo. Use para serviços.'}
        </p>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            Salvar produto
          </button>
        </div>
      </form>
    </Modal>
  )
}

const rotuloOrigem: Record<string, string> = {
  ENTRADA_ESTOQUE: 'Entrada nº',
  PEDIDO: 'Pedido nº',
  CANCELAMENTO: 'Cancelamento do pedido nº',
  AJUSTE: 'Ajuste de inventário',
}

function Estoque(props: { produto: Produto; onFechar: () => void; onAjustado: () => void }) {
  const { produto } = props
  const { dados, erro: erroLista, carregando } = useDados<Movimento[]>(`/produtos/${produto.id}/movimentos`)
  // O saldo é digitado na unidade base e pode ser fracionado (ex.: 2,5).
  const atual = saldoBase(produto)
  const [texto, setTexto] = useState(qtd(atual))
  const novoSaldo = Number(texto.replace(/\./g, '').replace(',', '.'))
  const valido = texto.trim() !== '' && Number.isFinite(novoSaldo) && novoSaldo >= 0
  const [observacao, setObservacao] = useState('')
  const { erro, ocupado, executar } = useAcao()
  const movimentos = dados ?? []

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      await api(`/produtos/${produto.id}/ajuste`, { body: { novoSaldo, observacao } })
      props.onAjustado()
    })
  }

  return (
    <Modal titulo={`Estoque · ${produto.nome}`} onFechar={props.onFechar} largo>
      <form onSubmit={enviar} className="form">
        <Campo rotulo={`Saldo contado em ${produto.unidade} (atual: ${qtd(atual)})`}>
          <input inputMode="decimal" required value={texto} onChange={(e) => setTexto(e.target.value)} />
          {produto.unidades.length > 0 && valido && (
            <small className="texto-suave">{produto.unidades.map((u) => `${qtd(novoSaldo * u.fator)} ${u.sigla}`).join(' · ')}</small>
          )}
        </Campo>
        <Campo rotulo="Motivo do ajuste" largura={2}>
          <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: contagem de inventário" />
        </Campo>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button className="botao botao-primario" disabled={ocupado || !valido || Math.abs(novoSaldo - atual) < 1e-9}>
            Ajustar saldo
          </button>
        </div>
      </form>

      <h3>Últimas movimentações</h3>
      <EstadoLista carregando={carregando} erro={erroLista} vazia={movimentos.length === 0} textoVazio="Sem movimentações." />
      {movimentos.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Origem</th>
              <th className="num">Quantidade</th>
              <th className="num">Saldo após</th>
            </tr>
          </thead>
          <tbody>
            {movimentos.map((m) => {
              const sinal = m.tipo === 'SAIDA' ? -m.quantidade : m.quantidade
              return (
                <tr key={m.id}>
                  <td>{dataBr(m.criadoEm)}</td>
                  <td>
                    {rotuloOrigem[m.origem] ?? m.origem} {m.origemId ?? ''}
                    {m.observacao && <small className="texto-suave"> · {m.observacao}</small>}
                  </td>
                  <td className={`num ${sinal < 0 ? 'texto-ruim' : 'texto-bom'}`}>{sinal > 0 ? `+${qtd(sinal)}` : qtd(sinal)}</td>
                  <td className="num">{qtd(m.saldoApos)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
