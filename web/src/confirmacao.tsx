import { useState, useSyncExternalStore } from 'react'
import { Modal } from './ui'

// Confirmações no visual do sistema, no lugar do confirm() e do prompt() do navegador. Qualquer parte
// do sistema chama confirmar() ou pedirMotivo() e espera a resposta; o componente Confirmacoes,
// montado uma vez na raiz, mostra a janela.
type Opcoes = {
  texto: string
  titulo?: string
  // Texto do botão que confirma, ex. "Cancelar pedido".
  botao?: string
  // Ação que desfaz ou apaga algo: botão em vermelho.
  perigo?: boolean
  // Pede um motivo, opcional, além da confirmação.
  motivo?: boolean
}
type Pedido = Opcoes & { id: number; responder: (resposta: string | null) => void }

let atual: Pedido | null = null
let proximo = 1
const ouvintes = new Set<() => void>()
const publicar = (novo: Pedido | null) => {
  atual = novo
  ouvintes.forEach((avisarOuvinte) => avisarOuvinte())
}

function perguntar(opcoes: Opcoes) {
  return new Promise<string | null>((resolver) => {
    // Uma pergunta por vez: se outra estava aberta, ela conta como "não".
    atual?.responder(null)
    publicar({
      ...opcoes,
      id: proximo++,
      responder: (resposta) => {
        publicar(null)
        resolver(resposta)
      },
    })
  })
}

export async function confirmar(opcoes: Omit<Opcoes, 'motivo'>) {
  return (await perguntar(opcoes)) !== null
}

// Devolve o motivo digitado ('' se ficou em branco) ou null se a pessoa desistiu.
export function pedirMotivo(opcoes: Omit<Opcoes, 'motivo'>) {
  return perguntar({ ...opcoes, motivo: true })
}

export function Confirmacoes() {
  const pedido = useSyncExternalStore(
    (avisarOuvinte) => {
      ouvintes.add(avisarOuvinte)
      return () => ouvintes.delete(avisarOuvinte)
    },
    () => atual,
  )
  // A chave refaz a janela a cada pergunta, para o motivo começar vazio.
  return <div className="confirmacoes">{pedido && <Janela key={pedido.id} pedido={pedido} />}</div>
}

function Janela({ pedido }: { pedido: Pedido }) {
  const [motivo, setMotivo] = useState('')
  const desistir = () => pedido.responder(null)
  const confirmarAgora = () => pedido.responder(motivo.trim())
  return (
    <Modal titulo={pedido.titulo ?? 'Confirmar'} onFechar={desistir}>
      <p className="confirmacao-texto">{pedido.texto}</p>
      {pedido.motivo && (
        <label className="campo confirmacao-motivo">
          <span>Motivo (opcional)</span>
          <textarea rows={3} value={motivo} autoFocus onChange={(e) => setMotivo(e.target.value)} />
        </label>
      )}
      <div className="form-pe">
        <button type="button" className="botao" onClick={desistir}>
          Voltar
        </button>
        <button type="button" className={`botao ${pedido.perigo ? 'botao-perigo-cheio' : 'botao-primario'}`} autoFocus={!pedido.motivo} onClick={confirmarAgora}>
          {pedido.botao ?? 'Confirmar'}
        </button>
      </div>
    </Modal>
  )
}
