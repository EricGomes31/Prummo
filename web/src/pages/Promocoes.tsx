import { useState, type FormEvent } from 'react'
import { api, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import { brl, dataBr, hojeIso, inteiro } from '../format'
import type { ItemPromocao, Modalidade, Produto, Promocao } from '../types'
import { Cabecalho, Campo, Dinheiro, Erro, EstadoLista, Modal, Selo } from '../ui'

const modalidades: Record<Modalidade, { rotulo: string; ajuda: string }> = {
  PERCENTUAL: { rotulo: 'Desconto percentual', ajuda: 'Desconto sobre todas as unidades de cada produto que atingir a quantidade mínima.' },
  PRECO: { rotulo: 'Preço promocional', ajuda: 'Cada produto que atingir a quantidade mínima sai pelo preço unitário promocional.' },
  LEVE_PAGUE: { rotulo: 'Leve e pague', ajuda: 'A cada grupo completo de unidades levadas de um produto, só parte é cobrada. As unidades que sobram ficam no preço normal.' },
  COMBO: { rotulo: 'Combo', ajuda: 'As quantidades formam um conjunto com preço fechado. Só conjuntos completos recebem o preço do combo.' },
  BRINDE: { rotulo: 'Brinde', ajuda: 'A cada conjunto comprado, os brindes saem de graça. Os brindes precisam estar lançados no pedido.' },
}

const percentualTexto = (centesimos: number) => `${(centesimos / 100).toLocaleString('pt-BR')}%`

function regra(c: Promocao) {
  switch (c.modalidade) {
    case 'PERCENTUAL':
      return `${percentualTexto(c.percentual ?? 0)} de desconto`
    case 'PRECO':
      return `${brl(c.preco ?? 0)} por unidade`
    case 'LEVE_PAGUE':
      return `Leve ${c.leve}, pague ${c.pague}`
    case 'COMBO':
      return `Conjunto por ${brl(c.preco ?? 0)}`
    case 'BRINDE':
      return 'Brinde na compra'
  }
}

function situacao(c: Promocao): { texto: string; tom: string } {
  if (!c.ativo) return { texto: 'Inativa', tom: 'apagado' }
  if (c.vigente) return { texto: 'Vigente', tom: 'bom' }
  return new Date(c.inicio) > new Date() ? { texto: 'Agendada', tom: 'neutro' } : { texto: 'Encerrada', tom: 'apagado' }
}

type Rascunho = {
  id?: number
  nome: string
  modalidade: Modalidade
  inicio: string
  fim: string
  percentual: string
  preco: number
  leve: number
  pague: number
  ativo: boolean
  itens: ItemPromocao[]
}

const linha = (papel: ItemPromocao['papel']): ItemPromocao => ({ produtoId: 0, quantidade: 1, papel })

const nova = (): Rascunho => ({
  nome: '', modalidade: 'PERCENTUAL', inicio: hojeIso(), fim: hojeIso(), percentual: '', preco: 0, leve: 3, pague: 2, ativo: true,
  itens: [linha('COMPRA')],
})

const paraRascunho = (c: Promocao): Rascunho => ({
  id: c.id,
  nome: c.nome,
  modalidade: c.modalidade,
  inicio: c.inicio.slice(0, 10),
  fim: c.fim.slice(0, 10),
  percentual: c.percentual ? String(c.percentual / 100).replace('.', ',') : '',
  preco: c.preco ?? 0,
  leve: c.leve ?? 3,
  pague: c.pague ?? 2,
  ativo: c.ativo,
  itens: c.itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, papel: i.papel })),
})

export function Promocoes() {
  const admin = useSessao().pode('PROMOCOES_GERENCIAR')
  const { dados, erro, carregando, recarregar } = useDados<Promocao[]>('/promocoes')
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const campanhas = dados ?? []

  return (
    <>
      <Cabecalho titulo="Promoções" descricao="Campanhas aplicadas aos pedidos.">
        {admin && (
          <button type="button" className="botao botao-primario" onClick={() => setEditando(nova())}>
            Nova campanha
          </button>
        )}
      </Cabecalho>

      <section className="cartao explicacao">
        <h2>Como funciona</h2>
        <ul>
          <li>Cada pedido aceita uma campanha, escolhida no próprio pedido. Ela não acumula com desconto manual.</li>
          <li>A campanha é conferida ao salvar o pedido: precisa estar vigente e o pedido precisa cumprir as condições.</li>
          <li>Lance no pedido todos os produtos da campanha, inclusive os brindes.</li>
          <li>Quantidades além de conjuntos completos ficam no preço normal.</li>
        </ul>
      </section>

      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={campanhas.length === 0} textoVazio="Nenhuma campanha cadastrada." />
        {campanhas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Campanha</th>
                <th>Modalidade</th>
                <th>Vigência</th>
                <th>Regra</th>
                <th>Produtos</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {campanhas.map((c) => {
                const s = situacao(c)
                const lista = (papel: string) =>
                  c.itens
                    .filter((i) => i.papel === papel)
                    .map((i) => (c.modalidade === 'LEVE_PAGUE' ? i.produto.nome : `${i.quantidade}× ${i.produto.nome}`))
                    .join(', ')
                return (
                  <tr key={c.id} className={c.ativo ? '' : 'linha-inativa'}>
                    <td>{c.nome}</td>
                    <td>{modalidades[c.modalidade].rotulo}</td>
                    <td className="sem-quebra">
                      {dataBr(c.inicio)} a {dataBr(c.fim)}
                    </td>
                    <td>{regra(c)}</td>
                    <td>
                      {lista('COMPRA')}
                      {c.modalidade === 'BRINDE' && <small className="bloco texto-suave">Brinde: {lista('BRINDE')}</small>}
                    </td>
                    <td>
                      <Selo valor={s.texto} tom={s.tom} />
                    </td>
                    <td className="num">
                      {admin && (
                        <button type="button" className="botao botao-texto" onClick={() => setEditando(paraRascunho(c))}>
                          Editar
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

      {editando && (
        <FormCampanha
          inicial={editando}
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

function FormCampanha(props: { inicial: Rascunho; onFechar: () => void; onSalvo: () => void }) {
  const [c, setC] = useState(props.inicial)
  const produtos = useDados<Produto[]>('/produtos').dados ?? []
  const { erro, ocupado, executar } = useAcao()
  const m = c.modalidade

  function trocarModalidade(modalidade: Modalidade) {
    // Fora da modalidade brinde não existe produto de brinde; ao entrar nela, abre uma linha para ele.
    const compra = c.itens.filter((i) => i.papel === 'COMPRA')
    setC({ ...c, modalidade, itens: modalidade === 'BRINDE' ? [...compra, linha('BRINDE')] : compra })
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const percentual = Math.round(Number(c.percentual.replace(',', '.')) * 100)
      const corpo = {
        nome: c.nome, modalidade: m, inicio: c.inicio, fim: c.fim, ativo: c.ativo,
        percentual: m === 'PERCENTUAL' && percentual > 0 ? percentual : null,
        preco: m === 'PRECO' || m === 'COMBO' ? c.preco : null,
        leve: m === 'LEVE_PAGUE' ? c.leve : null,
        pague: m === 'LEVE_PAGUE' ? c.pague : null,
        itens: c.itens,
      }
      await api(c.id ? `/promocoes/${c.id}` : '/promocoes', { method: c.id ? 'PUT' : 'POST', body: corpo })
      props.onSalvo()
    })
  }

  const rotuloQuantidade = m === 'COMBO' || m === 'BRINDE' ? 'Qtd. por conjunto' : 'Qtd. mínima'

  return (
    <Modal titulo={c.id ? 'Editar campanha' : 'Nova campanha'} onFechar={props.onFechar} largo>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Nome da campanha" largura={2}>
          <input required autoFocus value={c.nome} onChange={(e) => setC({ ...c, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="Modalidade">
          <select value={m} onChange={(e) => trocarModalidade(e.target.value as Modalidade)}>
            {(Object.keys(modalidades) as Modalidade[]).map((chave) => (
              <option key={chave} value={chave}>
                {modalidades[chave].rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <p className="texto-suave col-3">{modalidades[m].ajuda}</p>

        <Campo rotulo="Início">
          <input type="date" required value={c.inicio} onChange={(e) => setC({ ...c, inicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Fim">
          <input type="date" required min={c.inicio} value={c.fim} onChange={(e) => setC({ ...c, fim: e.target.value })} />
        </Campo>
        {m === 'PERCENTUAL' && (
          <Campo rotulo="Desconto (%)">
            <input required inputMode="decimal" placeholder="Ex.: 10 ou 12,5" value={c.percentual} onChange={(e) => setC({ ...c, percentual: e.target.value })} />
          </Campo>
        )}
        {(m === 'PRECO' || m === 'COMBO') && (
          <Campo rotulo={m === 'PRECO' ? 'Preço promocional por unidade (R$)' : 'Preço do conjunto (R$)'}>
            <Dinheiro valor={c.preco} onChange={(preco) => setC({ ...c, preco })} />
          </Campo>
        )}
        {m === 'LEVE_PAGUE' && (
          <div className="campo-duplo">
            <Campo rotulo="Leve">
              <input type="number" min={2} required value={c.leve} onChange={(e) => setC({ ...c, leve: inteiro(e.target.value) })} />
            </Campo>
            <Campo rotulo="Pague">
              <input type="number" min={1} max={c.leve - 1} required value={c.pague} onChange={(e) => setC({ ...c, pague: inteiro(e.target.value) })} />
            </Campo>
          </div>
        )}
        {m === 'BRINDE' && <span />}

        <ListaProdutos
          titulo={m === 'BRINDE' ? 'Produtos comprados' : 'Produtos participantes'}
          papel="COMPRA"
          rotuloQuantidade={m === 'LEVE_PAGUE' ? null : rotuloQuantidade}
          produtos={produtos}
          itens={c.itens}
          onChange={(itens) => setC({ ...c, itens })}
        />
        {m === 'BRINDE' && (
          <ListaProdutos titulo="Brindes" papel="BRINDE" rotuloQuantidade="Qtd. grátis por conjunto" produtos={produtos} itens={c.itens}
            onChange={(itens) => setC({ ...c, itens })} />
        )}

        {c.id && (
          <label className="marcar col-3">
            <input type="checkbox" checked={c.ativo} onChange={(e) => setC({ ...c, ativo: e.target.checked })} />
            Campanha ativa
          </label>
        )}
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

// Edita as linhas de um papel (comprados ou brindes) dentro da lista única de itens da campanha.
function ListaProdutos(props: {
  titulo: string
  papel: ItemPromocao['papel']
  rotuloQuantidade: string | null
  produtos: Produto[]
  itens: ItemPromocao[]
  onChange: (itens: ItemPromocao[]) => void
}) {
  const { itens, papel } = props
  const usados = new Set(itens.map((i) => i.produtoId))
  const doPapel = itens.map((item, indice) => ({ item, indice })).filter(({ item }) => item.papel === papel)
  const trocar = (indice: number, parte: Partial<ItemPromocao>) =>
    props.onChange(itens.map((item, n) => (n === indice ? { ...item, ...parte } : item)))

  return (
    <div className="itens col-3">
      <table>
        <thead>
          <tr>
            <th>{props.titulo}</th>
            {props.rotuloQuantidade && <th className="num">{props.rotuloQuantidade}</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {doPapel.map(({ item, indice }) => (
            <tr key={indice}>
              <td>
                <select required value={item.produtoId || ''} onChange={(e) => trocar(indice, { produtoId: Number(e.target.value) })}>
                  <option value="">Selecione…</option>
                  {props.produtos
                    .filter((p) => p.id === item.produtoId || (p.ativo && !usados.has(p.id)))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.nome}
                      </option>
                    ))}
                </select>
              </td>
              {props.rotuloQuantidade && (
                <td className="num">
                  <input type="number" min={1} required className="curto" value={item.quantidade || ''}
                    onChange={(e) => trocar(indice, { quantidade: inteiro(e.target.value) })} />
                </td>
              )}
              <td className="num">
                <button type="button" className="botao-icone" aria-label="Remover produto" disabled={doPapel.length === 1}
                  onClick={() => props.onChange(itens.filter((_, n) => n !== indice))}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="botao botao-texto" onClick={() => props.onChange([...itens, linha(papel)])}>
        + Adicionar produto
      </button>
    </div>
  )
}
