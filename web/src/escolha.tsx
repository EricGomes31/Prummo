import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { brl, documentoBr } from './format'
import { Icone } from './icones'
import type { Pessoa, Produto } from './types'

// Campo de escolha com busca, para listas longas (pessoas, vendas): digita-se parte do nome, do
// documento ou do telefone e escolhe-se na lista que aparece embaixo. Setas andam, Enter escolhe,
// Esc fecha a lista. O valor é o id (0 = nenhum).

export type Opcao = {
  id: number
  rotulo: string
  // Segunda linha na lista (documento, cidade, total…).
  detalhe?: string
  // Texto extra que a busca também olha, sem aparecer (telefones, documento só com dígitos).
  busca?: string
  // Códigos (SKU, EAN): digitado exatamente, a opção vai para o topo, e o Enter a escolhe.
  // É o que acontece com o leitor de código de barras, que digita o código e aperta Enter.
  codigos?: string[]
}

const LIMITE = 60

// Sem acentos e em minúsculas, para "jessica" achar "Jéssica".
const simples = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function Escolha(props: {
  opcoes: Opcao[]
  valor: number
  onChange: (id: number) => void
  required?: boolean
  disabled?: boolean
  autoFocus?: boolean
  placeholder?: string
  // Texto do campo quando nada está escolhido e a escolha é opcional (ex.: "Todos").
  nenhum?: string
  'aria-label'?: string
}) {
  const { opcoes, valor, onChange } = props
  const escolhida = opcoes.find((o) => o.id === valor)
  const [texto, setTexto] = useState(escolhida?.rotulo ?? '')
  const [aberto, setAberto] = useState(false)
  const [indice, setIndice] = useState(0)
  const [posicao, setPosicao] = useState<{ left: number; width: number; top?: number; bottom?: number }>({ left: -9999, width: 0, top: 0 })
  const campo = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLUListElement>(null)
  const idLista = useId()

  // Quando o valor muda por fora (ou as opções chegam depois), o texto mostra a escolhida.
  useEffect(() => {
    if (!aberto) setTexto(escolhida?.rotulo ?? '')
  }, [escolhida?.rotulo, aberto])

  // Campo obrigatório sem escolha não passa no envio do formulário, mesmo com texto digitado.
  useEffect(() => {
    campo.current?.setCustomValidity(props.required && !escolhida ? 'Escolha uma opção da lista.' : '')
  }, [props.required, escolhida])

  const achadas = useMemo(() => {
    const termos = simples(texto.trim()).split(/\s+/).filter(Boolean)
    // Com o campo mostrando a própria escolha, a lista abre inteira.
    if (!termos.length || (escolhida && texto === escolhida.rotulo)) return opcoes.slice(0, LIMITE)
    const digitado = simples(texto.trim())
    const exato = (o: Opcao) => !!o.codigos?.some((k) => simples(k) === digitado)
    return opcoes
      .filter((o) => {
        const alvo = simples(`${o.rotulo} ${o.detalhe ?? ''} ${o.busca ?? ''} ${o.codigos?.join(' ') ?? ''}`)
        return termos.every((t) => alvo.includes(t))
      })
      .sort((a, b) => Number(exato(b)) - Number(exato(a)))
      .slice(0, LIMITE)
  }, [opcoes, texto, escolhida])
  const marcada = Math.min(indice, Math.max(0, achadas.length - 1))

  // A lista fica fixa na tela, presa ao campo, para não ser cortada por painéis que rolam;
  // abre para cima quando não cabe embaixo.
  useLayoutEffect(() => {
    if (!aberto) return
    const posicionar = () => {
      const r = campo.current?.getBoundingClientRect()
      if (!r) return
      const largura = Math.max(r.width, 260)
      const left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8))
      const embaixo = window.innerHeight - r.bottom
      if (embaixo < 240 && r.top > embaixo) setPosicao({ left, width: largura, bottom: window.innerHeight - r.top + 4 })
      else setPosicao({ left, width: largura, top: r.bottom + 4 })
    }
    posicionar()
    window.addEventListener('resize', posicionar)
    window.addEventListener('scroll', posicionar, true)
    return () => {
      window.removeEventListener('resize', posicionar)
      window.removeEventListener('scroll', posicionar, true)
    }
  }, [aberto])

  // A opção marcada pelas setas fica sempre à vista na lista.
  useEffect(() => {
    lista.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [marcada, aberto])

  function escolher(opcao: Opcao | undefined) {
    if (!opcao) return
    onChange(opcao.id)
    setTexto(opcao.rotulo)
    setAberto(false)
  }

  function limpar() {
    onChange(0)
    setTexto('')
    setIndice(0)
    campo.current?.focus()
    setAberto(true)
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!aberto) return setAberto(true)
      const passo = e.key === 'ArrowDown' ? 1 : -1
      setIndice((marcada + passo + achadas.length) % Math.max(1, achadas.length))
    } else if (e.key === 'Enter' && aberto) {
      // Enter escolhe a marcada, sem enviar o formulário.
      e.preventDefault()
      escolher(achadas[marcada])
    } else if (e.key === 'Escape' && aberto) {
      // Fecha só a lista, não a janela em que o campo está.
      e.stopPropagation()
      setAberto(false)
      setTexto(escolhida?.rotulo ?? '')
    } else if (e.key === 'Tab' && aberto && texto && !(escolhida && texto === escolhida.rotulo) && achadas.length === 1) {
      // Saindo com uma só opção achada, ela é a escolhida.
      escolher(achadas[0])
    }
  }

  return (
    <div className="escolha">
      <input
        ref={campo}
        type="text"
        role="combobox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={aberto && achadas[marcada] ? `${idLista}-${achadas[marcada].id}` : undefined}
        aria-label={props['aria-label']}
        autoComplete="off"
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        required={props.required}
        placeholder={props.placeholder ?? (props.nenhum ? props.nenhum : 'Digite para buscar…')}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value)
          setIndice(0)
          setAberto(true)
        }}
        onFocus={(e) => e.target.select()}
        onClick={() => setAberto(true)}
        onKeyDown={aoTeclar}
        onBlur={() => {
          setAberto(false)
          // Apagar o texto de um campo opcional tira a escolha; texto que não é uma opção volta ao que estava.
          if (!texto.trim() && !props.required && valor) onChange(0)
          else setTexto(escolhida?.rotulo ?? '')
        }}
      />
      {escolhida && !props.disabled ? (
        <button type="button" className="escolha-limpar" aria-label="Limpar a escolha" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={limpar}>
          <Icone nome="fechar" />
        </button>
      ) : (
        <span className="escolha-seta" aria-hidden="true" />
      )}
      {aberto && (
        <ul ref={lista} id={idLista} role="listbox" className="escolha-lista" style={posicao}>
          {achadas.length === 0 ? (
            <li className="escolha-vazia">Nada encontrado.</li>
          ) : (
            achadas.map((o, i) => (
              <li
                key={o.id}
                id={`${idLista}-${o.id}`}
                role="option"
                aria-selected={i === marcada}
                className={o.id === valor ? 'escolha-atual' : undefined}
                // Sem isso o campo perderia o foco antes do clique chegar.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setIndice(i)}
                // Dentro de um <label>, o clique passaria para o campo e reabriria a lista.
                onClick={(e) => {
                  e.preventDefault()
                  escolher(o)
                }}
              >
                <span>{o.rotulo}</span>
                {o.detalhe && <small>{o.detalhe}</small>}
              </li>
            ))
          )}
          {achadas.length === LIMITE && <li className="escolha-vazia">Digite mais para ver outras opções.</li>}
        </ul>
      )}
    </div>
  )
}

// Pessoas como opções: nome (e nome fantasia), com documento e cidade embaixo. A busca acha também
// pelo documento e pelos telefones só com dígitos.
export const opcoesDePessoas = (pessoas: (Pick<Pessoa, 'id' | 'nome'> & Partial<Pessoa>)[]): Opcao[] =>
  pessoas.map((p) => ({
    id: p.id,
    rotulo: p.nome,
    detalhe: [p.nomeFantasia, documentoBr(p.documento), p.cidade && `${p.cidade}${p.uf ? `/${p.uf}` : ''}`, p.ativo === false && 'inativa'].filter(Boolean).join(' · ') || undefined,
    busca: [p.documento, p.celular, p.telefone, p.email].filter(Boolean).join(' '),
  }))

// Produtos como opções: "código · descrição", com EAN e preço embaixo; código e EAN exatos vão ao topo.
export const opcoesDeProdutos = (produtos: Produto[]): Opcao[] =>
  produtos.map((p) => ({
    id: p.id,
    rotulo: `${p.sku} · ${p.nome}`,
    detalhe: [p.ean && `EAN ${p.ean}`, p.precoVenda ? brl(p.precoVenda) : null, !p.ativo && 'inativo'].filter(Boolean).join(' · ') || undefined,
    codigos: [p.sku, p.ean].filter((k): k is string => !!k),
  }))
