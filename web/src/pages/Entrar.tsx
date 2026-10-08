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
      <aside className="entrar-painel">
        <Marca />
        <p className="entrar-frase">
          Vendas, estoque e financeiro no mesmo lugar.
          <small>Do pedido à entrega e do lançamento à conciliação, com os números do dia sempre à vista.</small>
        </p>
        <span className="entrar-rodape">Prumo · gestão empresarial</span>
      </aside>
      <div className="entrar-lado">
        <form className="entrar-cartao" onSubmit={enviar}>
          <Marca />
          <h1>Entrar</h1>
          <p className="texto-suave">Use o e-mail e a senha da sua conta.</p>
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
    </div>
  )
}
