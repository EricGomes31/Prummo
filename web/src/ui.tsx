import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { brl, centavosParaTexto, inteiro, paraCentavos, qtd, saldoBase, unidadesDe } from './format'
import { Icone } from './icones'
import type { ItemEdicao, Produto } from './types'

// Janelas abertas, da mais antiga para a mais nova. A rolagem da página só volta quando a última fecha,
// e o Esc fecha só a de cima (uma janela pode abrir outra, como o cadastro rápido dentro de um lançamento).
const janelasAbertas: object[] = []
const FOCAVEIS = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function Cabecalho({ titulo, descricao, children }: { titulo: string; descricao?: string; children?: ReactNode }) {
  return (
    <header className="cabecalho">
      <div>
        <h1>{titulo}</h1>
        {descricao && <p>{descricao}</p>}
      </div>
      <div className="acoes">{children}</div>
    </header>
  )
}

export function Modal(props: { titulo: string; onFechar: () => void; largo?: boolean; children: ReactNode }) {
  const { onFechar } = props
  const esta = useRef({})
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (janelasAbertas.at(-1) !== esta.current) return
      if (e.key === 'Escape') onFechar()
      // O Tab circula só pelos controles da janela, sem cair na página por trás.
      if (e.key === 'Tab' && caixa.current) {
        const focaveis = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => el.offsetParent !== null)
        if (focaveis.length === 0) return
        const primeiro = focaveis[0]
        const ultimo = focaveis[focaveis.length - 1]
        const dentro = caixa.current.contains(document.activeElement)
        if (e.shiftKey && (document.activeElement === primeiro || !dentro)) {
          e.preventDefault()
          ultimo.focus()
        } else if (!e.shiftKey && (document.activeElement === ultimo || !dentro)) {
          e.preventDefault()
          primeiro.focus()
        }
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onFechar])

  // Ao abrir, o foco entra na janela (a menos que um campo dela já o tenha pego com autoFocus);
  // ao fechar, volta ao botão que a abriu.
  useEffect(() => {
    const origem = document.activeElement as HTMLElement | null
    if (!caixa.current?.contains(document.activeElement)) caixa.current?.focus({ preventScroll: true })
    return () => {
      if (origem?.isConnected) origem.focus({ preventScroll: true })
    }
  }, [])

  // Com a janela aberta, a página por trás não rola.
  useEffect(() => {
    const propria = esta.current
    janelasAbertas.push(propria)
    document.body.style.overflow = 'hidden'
    return () => {
      janelasAbertas.splice(janelasAbertas.indexOf(propria), 1)
      if (janelasAbertas.length === 0) document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div ref={caixa} tabIndex={-1} className={`modal ${props.largo ? 'modal-largo' : ''}`} role="dialog" aria-modal="true" aria-label={props.titulo}>
        <div className="modal-topo">
          <h2>{props.titulo}</h2>
          <button type="button" className="botao-icone" onClick={onFechar} aria-label="Fechar">
            <Icone nome="fechar" />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}

export function Campo({ rotulo, children, largura }: { rotulo: string; children: ReactNode; largura?: 1 | 2 | 3 }) {
  return (
    <label className={`campo ${largura ? `col-${largura}` : ''}`}>
      <span>{rotulo}</span>
      {children}
    </label>
  )
}

export function Erro({ mensagem }: { mensagem: string }) {
  return mensagem ? (
    <p className="erro" role="alert">
      {mensagem}
    </p>
  ) : null
}

const tons: Record<string, string> = {
  ABERTO: 'neutro',
  ABERTA: 'neutro',
  FATURADO: 'bom',
  PAGA: 'bom',
  CANCELADO: 'apagado',
  CANCELADA: 'apagado',
  VENCIDA: 'ruim',
  PARCIAL: 'alerta',
  PENDENTE: 'neutro',
  EM_ROTA: 'alerta',
  ENTREGUE: 'bom',
  FALHOU: 'ruim',
}

export function Selo({ valor, tom }: { valor: string; tom?: string }) {
  const texto = (valor.charAt(0) + valor.slice(1).toLowerCase()).replace(/_/g, ' ')
  return <span className={`selo selo-${tom ?? tons[valor] ?? 'neutro'}`}>{texto}</span>
}

// Estados de lista: carregando, erro, vazia. Devolve null quando há linhas para mostrar.
export function EstadoLista(props: { carregando: boolean; erro: string; vazia: boolean; textoVazio: string }) {
  if (props.erro) return <Erro mensagem={props.erro} />
  // Enquanto os dados não chegam, linhas de esqueleto ocupam o lugar do conteúdo.
  if (props.carregando && props.vazia) {
    return (
      <div className="esqueleto" role="status" aria-label="Carregando">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    )
  }
  // Sem texto para a lista vazia, quem chama mostra o próprio conteúdo.
  if (props.vazia && props.textoVazio) {
    return (
      <div className="estado">
        <Icone nome="vazio" />
        {props.textoVazio}
      </div>
    )
  }
  return null
}

// Divide uma lista em páginas. Devolve as linhas da página atual e o rodapé com os controles,
// que só aparece quando a lista passa de uma página. Mudar a lista (um filtro, uma busca) volta
// para a primeira página.
export function usePaginacao<T>(itens: T[], porPagina = 25) {
  const [pagina, setPagina] = useState(1)
  const paginas = Math.max(1, Math.ceil(itens.length / porPagina))
  const atual = Math.min(pagina, paginas)
  useEffect(() => setPagina(1), [itens.length])

  const inicio = (atual - 1) * porPagina
  const visiveis = itens.slice(inicio, inicio + porPagina)
  const controle =
    paginas > 1 ? (
      <nav className="paginacao" aria-label="Páginas">
        <span>
          {inicio + 1} a {inicio + visiveis.length} de {itens.length}
        </span>
        <div>
          <button type="button" className="botao" disabled={atual === 1} onClick={() => setPagina(atual - 1)}>
            Anterior
          </button>
          <span>
            {atual} de {paginas}
          </span>
          <button type="button" className="botao" disabled={atual === paginas} onClick={() => setPagina(atual + 1)}>
            Próxima
          </button>
        </div>
      </nav>
    ) : null
  return { visiveis, controle }
}

type PropsDinheiro = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  valor: number
  onChange: (centavos: number) => void
  // Aceita valor negativo (saldo inicial de conta no cheque especial).
  negativo?: boolean
}

export function Dinheiro({ valor, onChange, negativo, ...resto }: PropsDinheiro) {
  const [texto, setTexto] = useState(centavosParaTexto(valor))
  useEffect(() => {
    setTexto((atual) => (paraCentavos(atual, negativo) === valor ? atual : centavosParaTexto(valor)))
  }, [valor, negativo])

  return (
    <input
      {...resto}
      // O teclado numérico do celular não tem o sinal de menos.
      inputMode={negativo ? 'text' : 'decimal'}
      placeholder="0,00"
      value={texto}
      onChange={(e) => {
        setTexto(e.target.value)
        onChange(paraCentavos(e.target.value, negativo))
      }}
      onBlur={() => setTexto(centavosParaTexto(valor))}
    />
  )
}

export function EditorItens(props: {
  produtos: Produto[]
  itens: ItemEdicao[]
  onChange: (itens: ItemEdicao[]) => void
  campoPreco: 'precoCusto' | 'precoVenda'
  rotuloValor: string
  mostrarSaldo?: boolean
  // Colunas de desconto por item, em percentual e em reais por unidade.
  comDesconto?: boolean
  // Esconde preço, desconto e total (a perda só baixa o estoque).
  semValores?: boolean
  // Produtos em que o desconto fica bloqueado (os da campanha escolhida).
  semDescontoEm?: Set<number>
}) {
  const { produtos, itens, onChange, campoPreco } = props
  const comDesconto = props.comDesconto && !props.semValores
  const trocar = (i: number, parte: Partial<ItemEdicao>) =>
    onChange(itens.map((item, n) => (n === i ? { ...item, ...parte } : item)))
  const usados = new Set(itens.map((i) => i.produtoId))

  return (
    <div className="itens">
      <table>
        <thead>
          <tr>
            <th>Produto</th>
            <th>Unidade</th>
            <th className="num">Qtd.</th>
            {!props.semValores && <th className="num">{props.rotuloValor}</th>}
            {comDesconto && <th className="num">Desc. %</th>}
            {comDesconto && <th className="num">Desc. unit.</th>}
            {!props.semValores && <th className="num">Total</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {itens.map((item, i) => {
            const produto = produtos.find((p) => p.id === item.produtoId)
            const opcoes = produto ? unidadesDe(produto) : []
            const fator = opcoes.find((u) => u.sigla === item.unidade)?.fator ?? 1
            const descontoBloqueado = !!props.semDescontoEm?.has(item.produtoId)
            return (
              <tr key={i}>
                <td>
                  <select
                    value={item.produtoId || ''}
                    required
                    onChange={(e) => {
                      const escolhido = produtos.find((p) => p.id === Number(e.target.value))
                      // Um produto novo começa na unidade base, com o preço dela.
                      trocar(i, { produtoId: escolhido?.id ?? 0, unidade: escolhido?.unidade ?? '', valor: escolhido?.[campoPreco] ?? 0, desconto: 0 })
                    }}
                  >
                    <option value="">Selecione…</option>
                    {produtos
                      .filter((p) => p.id === item.produtoId || (p.ativo && !usados.has(p.id)))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} · {p.nome}
                        </option>
                      ))}
                  </select>
                  {props.mostrarSaldo && produto?.controlaEstoque && (
                    <small className={saldoBase(produto) < item.quantidade / fator ? 'texto-ruim' : 'texto-suave'}>
                      Saldo: {qtd(saldoBase(produto))} {produto.unidade}
                      {fator > 1 && ` (${qtd(saldoBase(produto) * fator)} ${item.unidade})`}
                    </small>
                  )}
                </td>
                <td>
                  {opcoes.length > 1 ? (
                    <select
                      aria-label="Unidade"
                      value={item.unidade}
                      onChange={(e) => {
                        // Trocar a unidade troca o preço sugerido; a quantidade passa a ser nela.
                        const unidade = opcoes.find((u) => u.sigla === e.target.value)!
                        trocar(i, { unidade: unidade.sigla, valor: unidade[campoPreco], desconto: 0 })
                      }}
                    >
                      {opcoes.map((u) => (
                        <option key={u.sigla} value={u.sigla}>
                          {u.sigla}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="texto-suave">{produto?.unidade}</span>
                  )}
                </td>
                <td className="num">
                  <input
                    type="number"
                    min={1}
                    required
                    className="curto"
                    value={item.quantidade || ''}
                    onChange={(e) => trocar(i, { quantidade: inteiro(e.target.value) })}
                  />
                </td>
                {!props.semValores && (
                  <td className="num">
                    <Dinheiro
                      className="curto"
                      valor={item.valor}
                      onChange={(valor) => trocar(i, { valor, desconto: Math.min(item.desconto ?? 0, valor) })}
                    />
                  </td>
                )}
                {comDesconto && (
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      className="curto"
                      aria-label="Desconto em percentual"
                      disabled={descontoBloqueado}
                      title={descontoBloqueado ? 'Produto da campanha: sem desconto manual' : undefined}
                      value={item.valor && item.desconto ? Number((((item.desconto ?? 0) / item.valor) * 100).toFixed(2)) : ''}
                      onChange={(e) => {
                        const percentual = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                        trocar(i, { desconto: Math.round((item.valor * percentual) / 100) })
                      }}
                    />
                  </td>
                )}
                {comDesconto && (
                  <td className="num">
                    <Dinheiro
                      className="curto"
                      aria-label="Desconto por unidade"
                      disabled={descontoBloqueado}
                      title={descontoBloqueado ? 'Produto da campanha: sem desconto manual' : undefined}
                      valor={item.desconto ?? 0}
                      onChange={(desconto) => trocar(i, { desconto: Math.min(desconto, item.valor) })}
                    />
                  </td>
                )}
                {!props.semValores && <td className="num">{brl(item.quantidade * (item.valor - (item.desconto ?? 0)))}</td>}
                <td>
                  <button
                    type="button"
                    className="botao-icone"
                    aria-label="Remover item"
                    disabled={itens.length === 1}
                    onClick={() => onChange(itens.filter((_, n) => n !== i))}
                  >
                    <Icone nome="fechar" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button type="button" className="botao botao-texto" onClick={() => onChange([...itens, itemVazio()])}>
        + Adicionar item
      </button>
    </div>
  )
}

export const itemVazio = (): ItemEdicao => ({ produtoId: 0, unidade: '', quantidade: 1, valor: 0 })
export const totalItens = (itens: ItemEdicao[]) => itens.reduce((soma, i) => soma + i.quantidade * i.valor, 0)
export const descontoDosItens = (itens: ItemEdicao[]) => itens.reduce((soma, i) => soma + i.quantidade * (i.desconto ?? 0), 0)
