import { useState, type FormEvent } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { api, useAcao } from './api'
import { useSessao } from './auth'
import { Campo, Erro, Modal } from './ui'

// Cada tela aparece para quem tem ao menos uma das permissões; o início é de todos.
// Os dashboards são liberados um a um no perfil, então a tela aparece para quem tem algum.
const menu: { para: string; rotulo: string; exige?: string[]; dashboards?: boolean }[] = [
  { para: '/', rotulo: 'Início' },
  { para: '/pessoas', rotulo: 'Pessoas', exige: ['PESSOAS_VISUALIZAR'] },
  { para: '/produtos', rotulo: 'Produtos e estoque', exige: ['PRODUTOS_VISUALIZAR'] },
  { para: '/entradas', rotulo: 'Entradas de estoque', exige: ['ESTOQUE_VISUALIZAR', 'ESTOQUE_ENTRADA'] },
  { para: '/pedidos', rotulo: 'Pedidos e vendas', exige: ['PEDIDOS_VISUALIZAR', 'PEDIDOS_CADASTRAR'] },
  { para: '/devolucoes', rotulo: 'Devoluções e créditos', exige: ['DEVOLUCOES_VISUALIZAR', 'DEVOLUCOES_REGISTRAR', 'CREDITOS_UTILIZAR'] },
  { para: '/entregas', rotulo: 'Logística e entregas', exige: ['LOGISTICA_VISUALIZAR', 'LOGISTICA_GERENCIAR'] },
  { para: '/promocoes', rotulo: 'Promoções', exige: ['PROMOCOES_VISUALIZAR', 'PROMOCOES_GERENCIAR'] },
  {
    para: '/financeiro',
    rotulo: 'Financeiro',
    exige: ['CONTAS_RECEBER_VISUALIZAR', 'CONTAS_RECEBER_BAIXAR', 'CONTAS_PAGAR_VISUALIZAR', 'CONTAS_PAGAR_BAIXAR', 'DESPESAS_VISUALIZAR', 'DESPESAS_LANCAR', 'CAIXA_VISUALIZAR', 'CAIXA_MOVIMENTAR', 'OFX_IMPORTAR', 'CONCILIACAO_VISUALIZAR', 'CONCILIACAO_CONFIRMAR'],
  },
  { para: '/dashboards', rotulo: 'Dashboards', dashboards: true },
  { para: '/relatorios', rotulo: 'Relatórios', exige: ['RELATORIOS_VISUALIZAR'] },
  { para: '/usuarios', rotulo: 'Usuários', exige: ['USUARIOS_GERENCIAR'] },
]

export function Marca() {
  return (
    <div className="marca">
      <span className="marca-glifo" aria-hidden="true" />
      prumo
    </div>
  )
}

export function Layout() {
  const { usuario, carregando, sair, pode } = useSessao()
  const [trocandoSenha, setTrocandoSenha] = useState(false)

  if (carregando) return <p className="aviso tela-cheia">Carregando…</p>
  if (!usuario) return <Navigate to="/entrar" replace />

  return (
    <div className="app">
      <aside className="lateral">
        <Marca />
        <nav>
          {menu
            .filter((item) => (item.dashboards ? usuario.dashboards.length > 0 : !item.exige || pode(...item.exige)))
            .map((item) => (
              <NavLink key={item.para} to={item.para} end={item.para === '/'}>
                {item.rotulo}
              </NavLink>
            ))}
        </nav>
        <div className="lateral-pe">
          <strong>{usuario.nome}</strong>
          <small>{usuario.perfilNome}</small>
          <div className="lateral-acoes">
            <button type="button" className="botao botao-texto" onClick={() => setTrocandoSenha(true)}>
              Alterar senha
            </button>
            <button type="button" className="botao botao-texto" onClick={sair}>
              Sair
            </button>
          </div>
        </div>
      </aside>
      <main className="conteudo">
        <Outlet />
      </main>
      {trocandoSenha && <TrocarSenha onFechar={() => setTrocandoSenha(false)} />}
    </div>
  )
}

function TrocarSenha({ onFechar }: { onFechar: () => void }) {
  const [senhaAtual, setSenhaAtual] = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      await api('/auth/senha', { method: 'PUT', body: { senhaAtual, novaSenha } })
      onFechar()
    })
  }

  return (
    <Modal titulo="Alterar senha" onFechar={onFechar}>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Senha atual" largura={3}>
          <input type="password" required autoComplete="current-password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
        </Campo>
        <Campo rotulo="Nova senha (mínimo de 8 caracteres)" largura={3}>
          <input type="password" required minLength={8} autoComplete="new-password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
        </Campo>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={onFechar}>
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
