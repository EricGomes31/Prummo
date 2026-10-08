import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAcao } from '../api'
import { useSessao } from '../auth'
import { Marca } from '../Layout'
import { Campo, Erro } from '../ui'

export function Entrar() {
  const { usuario, entrar } = useSessao()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const { erro, ocupado, executar } = useAcao()

  if (usuario) return <Navigate to="/" replace />

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(() => entrar(email, senha))
  }

  return (
    <div className="entrar">
      <form className="entrar-cartao" onSubmit={enviar}>
        <Marca />
        <p className="texto-suave">Vendas, estoque e financeiro no mesmo lugar.</p>
        <Campo rotulo="E-mail">
          <input type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo rotulo="Senha">
          <input type="password" required autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Campo>
        <Erro mensagem={erro} />
        <button className="botao botao-primario" disabled={ocupado}>
          {ocupado ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
