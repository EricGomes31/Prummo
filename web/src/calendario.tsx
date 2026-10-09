import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type Ref, type RefObject } from 'react'
import { Icone } from './icones'

// Campo de data com o calendário no visual do sistema. O campo continua sendo o <input> do navegador
// (dá para digitar a data, e o valor segue no formato AAAA-MM-DD), só a janela de escolha é nossa:
// a do navegador não aceita estilo. No celular fica a do aparelho, mais fácil de usar com o dedo
// (o botão some pela regra de pointer: coarse no CSS).
// Aceita type="date", "month" (escolhe o mês) e "datetime-local" (escolhe o dia e mantém a hora).

type Tipo = 'date' | 'month' | 'datetime-local'
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & { type: Tipo; value: string }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const LARGURA = 296

const doisDigitos = (n: number) => String(n).padStart(2, '0')
const paraTexto = (d: Date) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`
const deTexto = (texto: string) => {
  const [a, m, d] = texto.slice(0, 10).split('-').map(Number)
  return a && m ? new Date(a, m - 1, d || 1) : null
}
const somarDias = (d: Date, dias: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias)
const somarMeses = (d: Date, meses: number) => {
  // No dia 31, ir para um mês mais curto para no último dia dele, e não no começo do seguinte.
  const ultimo = new Date(d.getFullYear(), d.getMonth() + meses + 1, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() + meses, Math.min(d.getDate(), ultimo))
}

// Escreve no <input> como se a pessoa tivesse digitado: o onChange de quem usa o campo dispara
// normalmente, com e.target.value, e a janela em volta percebe que algo foi preenchido.
function escrever(input: HTMLInputElement, valor: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, valor)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export function CampoData({ className, ...props }: Props) {
  const campo = useRef<HTMLInputElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const [aberto, setAberto] = useState(false)

  function fechar(devolverFoco: boolean) {
    setAberto(false)
    if (devolverFoco) botao.current?.focus()
  }

  function escolher(valor: string) {
    if (campo.current) escrever(campo.current, valor)
    fechar(true)
  }

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return
    const aoClicar = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (!caixa.current?.contains(alvo) && !botao.current?.contains(alvo)) setAberto(false)
    }
    document.addEventListener('mousedown', aoClicar)
    return () => document.removeEventListener('mousedown', aoClicar)
  }, [aberto])

  return (
    <div className={`data-campo ${className ?? ''}`}>
      <input ref={campo} {...props} />
      <button
        ref={botao}
        type="button"
        className="data-botao"
        aria-label={props.type === 'month' ? 'Escolher o mês' : 'Escolher a data'}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        disabled={props.disabled}
        onClick={() => setAberto(!aberto)}
      >
        <Icone nome="calendario" />
      </button>
      {aberto && (
        <Janela
          ref={caixa}
          ancora={campo}
          tipo={props.type}
          valor={props.value}
          min={typeof props.min === 'string' ? props.min : undefined}
          max={typeof props.max === 'string' ? props.max : undefined}
          podeLimpar={!props.required}
          onEscolher={escolher}
          onFechar={fechar}
        />
      )}
    </div>
  )
}

function Janela(props: {
  ref: Ref<HTMLDivElement>
  ancora: RefObject<HTMLInputElement | null>
  tipo: Tipo
  valor: string
  min?: string
  max?: string
  podeLimpar: boolean
  onEscolher: (valor: string) => void
  onFechar: (devolverFoco: boolean) => void
}) {
  const { tipo, valor, min, max } = props
  const hoje = new Date()
  const escolhida = deTexto(valor)
  // Dia com o foco do teclado; o mês mostrado é sempre o dele.
  const [foco, setFoco] = useState(() => escolhida ?? new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()))
  const [posicao, setPosicao] = useState<{ left: number; top?: number; bottom?: number }>({ left: -9999, top: 0 })
  const grade = useRef<HTMLDivElement>(null)
  // Só ao abrir e ao andar com as setas o foco vai para a grade; pelas setas do topo ele fica no botão.
  const focarGrade = useRef(true)

  // Fica preso ao campo, abrindo para cima quando não há espaço embaixo. É fixa na tela para não
  // ser cortada por painéis e tabelas que rolam de lado.
  useLayoutEffect(() => {
    const posicionar = () => {
      const r = props.ancora.current?.getBoundingClientRect()
      if (!r) return
      const left = Math.max(8, Math.min(r.left, window.innerWidth - LARGURA - 8))
      const altura = 360
      if (window.innerHeight - r.bottom < altura && r.top > window.innerHeight - r.bottom) setPosicao({ left, bottom: window.innerHeight - r.top + 6 })
      else setPosicao({ left, top: r.bottom + 6 })
    }
    posicionar()
    window.addEventListener('resize', posicionar)
    window.addEventListener('scroll', posicionar, true)
    return () => {
      window.removeEventListener('resize', posicionar)
      window.removeEventListener('scroll', posicionar, true)
    }
  }, [props.ancora])

  // O foco do teclado acompanha o dia (ou mês) escolhido com as setas.
  useEffect(() => {
    if (!focarGrade.current) return
    focarGrade.current = false
    grade.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus()
  }, [foco])

  const porMes = tipo === 'month'
  const chave = (d: Date) => (porMes ? paraTexto(d).slice(0, 7) : paraTexto(d))
  const foraDoLimite = (d: Date) => {
    const k = chave(d)
    return (!!min && k < min.slice(0, k.length)) || (!!max && k > max.slice(0, k.length))
  }

  function valorDe(d: Date) {
    if (porMes) return paraTexto(d).slice(0, 7)
    if (tipo === 'datetime-local') {
      // Troca só o dia; a hora digitada fica. Sem hora ainda, usa a de agora.
      const hora = valor.slice(11, 16) || `${doisDigitos(hoje.getHours())}:${doisDigitos(hoje.getMinutes())}`
      return `${paraTexto(d)}T${hora}`
    }
    return paraTexto(d)
  }

  function aoTeclar(e: KeyboardEvent) {
    // O Esc fecha só o calendário, não a janela em que o campo está.
    if (e.key === 'Escape') {
      e.stopPropagation()
      props.onFechar(true)
      return
    }
    const passos: Record<string, () => Date> = porMes
      ? {
          ArrowLeft: () => somarMeses(foco, -1),
          ArrowRight: () => somarMeses(foco, 1),
          ArrowUp: () => somarMeses(foco, -3),
          ArrowDown: () => somarMeses(foco, 3),
          PageUp: () => somarMeses(foco, -12),
          PageDown: () => somarMeses(foco, 12),
        }
      : {
          ArrowLeft: () => somarDias(foco, -1),
          ArrowRight: () => somarDias(foco, 1),
          ArrowUp: () => somarDias(foco, -7),
          ArrowDown: () => somarDias(foco, 7),
          Home: () => somarDias(foco, -foco.getDay()),
          End: () => somarDias(foco, 6 - foco.getDay()),
          PageUp: () => somarMeses(foco, e.shiftKey ? -12 : -1),
          PageDown: () => somarMeses(foco, e.shiftKey ? 12 : 1),
        }
    const passo = passos[e.key]
    if (passo && (e.target as HTMLElement).closest('.calendario-grade')) {
      e.preventDefault()
      focarGrade.current = true
      setFoco(passo())
    }
  }

  const titulo = porMes ? String(foco.getFullYear()) : `${MESES[foco.getMonth()]} de ${foco.getFullYear()}`
  const avancar = (n: number) => setFoco(porMes ? somarMeses(foco, 12 * n) : somarMeses(foco, n))
  const atual = porMes ? new Date(hoje.getFullYear(), hoje.getMonth(), 1) : new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())

  return (
    <div
      ref={props.ref}
      className="calendario"
      role="dialog"
      aria-label={porMes ? 'Escolher o mês' : 'Escolher a data'}
      style={{ ...posicao, width: LARGURA }}
      onKeyDown={aoTeclar}
      // Dentro de um rótulo (<label>), um clique no fundo do calendário passaria para o campo.
      onClick={(e) => e.preventDefault()}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && e.relatedTarget && props.onFechar(false)}
    >
      <div className="calendario-topo">
        <button type="button" className="botao-icone" aria-label={porMes ? 'Ano anterior' : 'Mês anterior'} onClick={() => avancar(-1)}>
          <Icone nome="anterior" />
        </button>
        <strong aria-live="polite">{titulo}</strong>
        <button type="button" className="botao-icone" aria-label={porMes ? 'Próximo ano' : 'Próximo mês'} onClick={() => avancar(1)}>
          <Icone nome="proximo" />
        </button>
      </div>

      {porMes ? (
        <div ref={grade} className="calendario-grade calendario-meses" role="grid" aria-label={titulo}>
          {MESES.map((nome, i) => {
            const mes = new Date(foco.getFullYear(), i, 1)
            const k = chave(mes)
            return (
              <button
                key={nome}
                type="button"
                className="calendario-celula"
                tabIndex={i === foco.getMonth() ? 0 : -1}
                aria-pressed={valor.slice(0, 7) === k}
                aria-current={k === chave(atual) ? 'date' : undefined}
                aria-label={`${nome} de ${foco.getFullYear()}`}
                disabled={foraDoLimite(mes)}
                onClick={() => props.onEscolher(valorDe(mes))}
              >
                {nome.slice(0, 3)}
              </button>
            )
          })}
        </div>
      ) : (
        <div ref={grade} className="calendario-grade" role="grid" aria-label={titulo}>
          {SEMANA.map((dia) => (
            <span key={dia} className="calendario-semana" aria-hidden="true" title={dia}>
              {dia[0].toUpperCase()}
            </span>
          ))}
          {Array.from({ length: 42 }, (_, i) => {
            const primeiro = new Date(foco.getFullYear(), foco.getMonth(), 1)
            const dia = somarDias(primeiro, i - primeiro.getDay())
            const k = paraTexto(dia)
            return (
              <button
                key={k}
                type="button"
                className={`calendario-celula ${dia.getMonth() !== foco.getMonth() ? 'calendario-fora' : ''}`}
                tabIndex={k === paraTexto(foco) ? 0 : -1}
                aria-pressed={valor.slice(0, 10) === k}
                aria-current={k === paraTexto(atual) ? 'date' : undefined}
                aria-label={`${SEMANA[dia.getDay()]}, ${dia.getDate()} de ${MESES[dia.getMonth()]} de ${dia.getFullYear()}`}
                disabled={foraDoLimite(dia)}
                onClick={() => props.onEscolher(valorDe(dia))}
              >
                {dia.getDate()}
              </button>
            )
          })}
        </div>
      )}

      <div className="calendario-pe">
        {props.podeLimpar && valor ? (
          <button type="button" className="botao botao-texto" onClick={() => props.onEscolher('')}>
            Limpar
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="botao botao-texto" disabled={foraDoLimite(atual)} onClick={() => props.onEscolher(valorDe(atual))}>
          {porMes ? 'Este mês' : 'Hoje'}
        </button>
      </div>
    </div>
  )
}
