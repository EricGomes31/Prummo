import { useSyncExternalStore } from 'react'

// Avisos rápidos no canto da tela (toasts). Qualquer parte do sistema chama avisar(); o componente
// Avisos, montado uma vez na raiz, mostra a fila e tira cada aviso depois de alguns segundos.
export type TipoAviso = 'sucesso' | 'informacao' | 'atencao' | 'erro'
type Aviso = { id: number; tipo: TipoAviso; texto: string }

let fila: Aviso[] = []
let proximo = 1
const ouvintes = new Set<() => void>()
const publicar = (nova: Aviso[]) => {
  fila = nova
  ouvintes.forEach((avisarOuvinte) => avisarOuvinte())
}

export function avisar(tipo: TipoAviso, texto: string) {
  const id = proximo++
  // No máximo três de uma vez; os mais antigos saem primeiro.
  publicar([...fila, { id, tipo, texto }].slice(-3))
  // Erro fica mais tempo na tela, porque costuma pedir uma ação.
  setTimeout(() => publicar(fila.filter((a) => a.id !== id)), tipo === 'erro' ? 6000 : 3200)
}

export function Avisos() {
  const avisos = useSyncExternalStore(
    (avisarOuvinte) => {
      ouvintes.add(avisarOuvinte)
      return () => ouvintes.delete(avisarOuvinte)
    },
    () => fila,
  )
  return (
    <div className="avisos" role="status" aria-live="polite">
      {avisos.map((a) => (
        <div key={a.id} className={`aviso-rapido aviso-${a.tipo}`}>
          {a.texto}
        </div>
      ))}
    </div>
  )
}
