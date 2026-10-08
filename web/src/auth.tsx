import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, EVENTO_SAIR, token } from './api'
import type { UsuarioSessao } from './types'

type Sessao = {
  usuario: UsuarioSessao | null
  carregando: boolean
  entrar: (email: string, senha: string) => Promise<void>
  sair: () => void
  // Verdadeiro quando o perfil do usuário tem ao menos uma das permissões.
  pode: (...permissoes: string[]) => boolean
}

const Contexto = createContext<Sessao | null>(null)

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null)
  const [carregando, setCarregando] = useState(token.ler() !== null)

  useEffect(() => {
    if (token.ler()) {
      api<UsuarioSessao>('/auth/me')
        .then(setUsuario)
        .catch(() => setUsuario(null))
        .finally(() => setCarregando(false))
    }
    const aoSair = () => setUsuario(null)
    window.addEventListener(EVENTO_SAIR, aoSair)
    return () => window.removeEventListener(EVENTO_SAIR, aoSair)
  }, [])

  async function entrar(email: string, senha: string) {
    const r = await api<{ token: string; usuario: UsuarioSessao }>('/auth/login', { body: { email, senha } })
    token.gravar(r.token)
    setUsuario(r.usuario)
  }

  function sair() {
    token.apagar()
    setUsuario(null)
  }

  const pode = (...permissoes: string[]) => permissoes.some((p) => usuario?.permissoes.includes(p))

  return <Contexto.Provider value={{ usuario, carregando, entrar, sair, pode }}>{children}</Contexto.Provider>
}

export function useSessao() {
  const sessao = useContext(Contexto)
  if (!sessao) throw new Error('useSessao fora do ProvedorSessao')
  return sessao
}
