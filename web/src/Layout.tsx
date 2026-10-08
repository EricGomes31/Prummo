import { Fragment, useEffect, useState, type FormEvent } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { api, useAcao, useCarregando } from './api'
import { useSessao } from './auth'
import { Icone, type NomeIcone } from './icones'
import { Campo, Erro, Modal } from './ui'

type ItemMenu = { para: string; rotulo: string; icone: NomeIcone; grupo: string; exige?: string[]; dashboards?: boolean }

// Cada tela aparece para quem tem ao menos uma das permissões; o início é de todos.
// Os dashboards são liberados um a um no perfil, então a tela aparece para quem tem algum.
const menu: ItemMenu[] = [
  { para: '/', rotulo: 'Início', icone: 'inicio', grupo: 'Geral' },
  { para: '/pessoas', rotulo: 'Pessoas', icone: 'pessoas', grupo: 'Cadastros', exige: ['PESSOAS_VISUALIZAR'] },
  { para: '/produtos', rotulo: 'Produtos e estoque', icone: 'produtos', grupo: 'Cadastros', exige: ['PRODUTOS_VISUALIZAR'] },
  { para: '/entradas', rotulo: 'Entradas de estoque', icone: 'entradas', grupo: 'Operação', exige: ['ESTOQUE_VISUALIZAR', 'ESTOQUE_ENTRADA'] },
  { para: '/pedidos', rotulo: 'Pedidos e vendas', icone: 'pedidos', grupo: 'Operação', exige: ['PEDIDOS_VISUALIZAR', 'PEDIDOS_CADASTRAR'] },
  { para: '/devolucoes', rotulo: 'Devoluções e créditos', icone: 'devolucoes', grupo: 'Operação', exige: ['DEVOLUCOES_VISUALIZAR', 'DEVOLUCOES_REGISTRAR', 'CREDITOS_UTILIZAR'] },
  { para: '/entregas', rotulo: 'Logística e entregas', icone: 'entregas', grupo: 'Operação', exige: ['LOGISTICA_VISUALIZAR', 'LOGISTICA_GERENCIAR'] },
  { para: '/promocoes', rotulo: 'Promoções', icone: 'promocoes', grupo: 'Operação', exige: ['PROMOCOES_VISUALIZAR', 'PROMOCOES_GERENCIAR'] },
  {
    para: '/financeiro',
    rotulo: 'Financeiro',
    icone: 'financeiro',
    grupo: 'Gestão',
    exige: ['CONTAS_RECEBER_VISUALIZAR', 'CONTAS_RECEBER_BAIXAR', 'CONTAS_PAGAR_VISUALIZAR', 'CONTAS_PAGAR_BAIXAR', 'DESPESAS_VISUALIZAR', 'DESPESAS_LANCAR', 'CAIXA_VISUALIZAR', 'CAIXA_MOVIMENTAR', 'OFX_IMPORTAR', 'CONCILIACAO_VISUALIZAR', 'CONCILIACAO_CONFIRMAR'],
  },
  { para: '/dashboards', rotulo: 'Dashboards', icone: 'dashboards', grupo: 'Gestão', dashboards: true },
  { para: '/relatorios', rotulo: 'Relatórios', icone: 'relatorios', grupo: 'Gestão', exige: ['RELATORIOS_VISUALIZAR'] },
  { para: '/usuarios', rotulo: 'Usuários', icone: 'usuarios', grupo: 'Sistema', exige: ['USUARIOS_GERENCIAR'] },
]

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0].toUpperCase())
    .join('')

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
  // No celular o menu é uma gaveta: abre pelo botão do topo e fecha ao escolher uma tela.
  const [menuAberto, setMenuAberto] = useState(false)
  const { pathname } = useLocation()
  const carregandoDados = useCarregando()
  // Cada tela nova começa fechando a gaveta e do topo, e não onde a anterior estava rolada.
  useEffect(() => {
    setMenuAberto(false)
    window.scrollTo(0, 0)
  }, [pathname])
  useEffect(() => {
    if (!menuAberto) return
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && setMenuAberto(false)
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [menuAberto])

  if (carregando) {
    return (
      <div className="estado tela-cheia" role="status">
        <span className="girando" />
        Carregando…
      </div>
    )
  }
  if (!usuario) return <Navigate to="/entrar" replace />

  const visiveis = menu.filter((item) => (item.dashboards ? usuario.dashboards.length > 0 : !item.exige || pode(...item.exige)))

  return (
    <div className="app">
      {carregandoDados && <div className="barra-carregando" role="progressbar" aria-label="Carregando" />}
      <header className="topo-movel">
        <button type="button" className="botao-icone" aria-label="Abrir o menu" aria-expanded={menuAberto} onClick={() => setMenuAberto(true)}>
          <Icone nome="menu" />
        </button>
        <Marca />
      </header>
      {menuAberto && <button type="button" className="lateral-fundo" aria-label="Fechar o menu" onClick={() => setMenuAberto(false)} />}
      <aside className={`lateral ${menuAberto ? 'aberta' : ''}`}>
        <Marca />
        <nav aria-label="Telas do sistema">
          {visiveis.map((item, i) => (
            <Fragment key={item.para}>
              {item.grupo !== visiveis[i - 1]?.grupo && <span className="menu-grupo">{item.grupo}</span>}
              <NavLink to={item.para} end={item.para === '/'}>
                <Icone nome={item.icone} />
                {item.rotulo}
              </NavLink>
            </Fragment>
          ))}
        </nav>
        <div className="lateral-pe">
          <span className="avatar" aria-hidden="true">
            {iniciais(usuario.nome)}
          </span>
          <div className="lateral-usuario">
            <strong title={usuario.nome}>{usuario.nome}</strong>
            <small>{usuario.perfilNome}</small>
          </div>
          <div className="lateral-acoes">
            <button type="button" className="botao-icone" title="Alterar senha" aria-label="Alterar senha" onClick={() => setTrocandoSenha(true)}>
              <Icone nome="chave" />
            </button>
            <button type="button" className="botao-icone" title="Sair" aria-label="Sair" onClick={sair}>
              <Icone nome="sair" />
            </button>
          </div>
        </div>
      </aside>
      <main className="conteudo">
        {/* A chave refaz o bloco a cada tela, e é isso que dispara a animação de entrada. */}
        <div key={pathname} className="pagina">
          <Outlet />
        </div>
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
