import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, useAcao, useCarregando } from './api'
import { useSessao } from './auth'
import { Icone, type NomeIcone } from './icones'
import type { Resumo } from './types'
import { Campo, Erro, Modal } from './ui'

// `sistema`: só para o administrador do sistema.
type ItemMenu = { para: string; rotulo: string; icone: NomeIcone; grupo: string; exige?: string[]; dashboards?: boolean; sistema?: boolean }

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
    exige: ['CONTAS_RECEBER_VISUALIZAR', 'CONTAS_RECEBER_BAIXAR', 'CONTAS_PAGAR_VISUALIZAR', 'CONTAS_PAGAR_BAIXAR', 'DESPESAS_VISUALIZAR', 'DESPESAS_LANCAR', 'CAIXA_VISUALIZAR', 'CAIXA_MOVIMENTAR', 'CAIXA_LANCAR', 'OFX_IMPORTAR', 'CONCILIACAO_VISUALIZAR', 'CONCILIACAO_CONFIRMAR'],
  },
  { para: '/dashboards', rotulo: 'Dashboards', icone: 'dashboards', grupo: 'Gestão', dashboards: true },
  { para: '/relatorios', rotulo: 'Relatórios', icone: 'relatorios', grupo: 'Gestão', exige: ['RELATORIOS_VISUALIZAR'] },
  { para: '/usuarios', rotulo: 'Usuários', icone: 'usuarios', grupo: 'Sistema', exige: ['USUARIOS_GERENCIAR'] },
  { para: '/empresas', rotulo: 'Empresas', icone: 'empresas', grupo: 'Sistema', sistema: true },
]

const CHAVE_MENU = 'prumo.menu-recolhido'

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0].toUpperCase())
    .join('')

// Sem acentos e em minúsculas, para a busca achar "relatorios" e "Relatórios".
const simples = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

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
  // No computador o menu pode ficar recolhido, só com os ícones; a escolha fica guardada no navegador.
  const [recolhido, setRecolhido] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_MENU) === '1'
    } catch {
      return false
    }
  })
  const [buscando, setBuscando] = useState(false)
  const { pathname } = useLocation()
  const carregandoDados = useCarregando()
  const conteudo = useRef<HTMLElement>(null)
  const primeiraTela = useRef(true)

  // Cada tela nova começa fechando a gaveta e do topo, e não onde a anterior estava rolada.
  useEffect(() => {
    setMenuAberto(false)
    window.scrollTo(0, 0)
    // O leitor de tela passa a ler a tela nova; na primeira o foco fica onde o navegador pôs.
    if (primeiraTela.current) primeiraTela.current = false
    else conteudo.current?.focus({ preventScroll: true })
  }, [pathname])

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAberto(false)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBuscando(true)
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [])

  function alternarMenu() {
    setRecolhido((atual) => {
      try {
        localStorage.setItem(CHAVE_MENU, atual ? '0' : '1')
      } catch {
        // Sem armazenamento, a escolha vale só até recarregar a página.
      }
      return !atual
    })
  }

  if (carregando) {
    return (
      <div className="estado tela-cheia" role="status">
        <span className="girando" />
        Carregando…
      </div>
    )
  }
  if (!usuario) return <Navigate to="/entrar" replace />

  const visiveis = menu.filter((item) =>
    item.sistema ? usuario.sistema : item.dashboards ? usuario.dashboards.length > 0 : !item.exige || pode(...item.exige),
  )
  const atual = visiveis.find((item) => (item.para === '/' ? pathname === '/' : pathname.startsWith(item.para)))

  return (
    <div className={`app ${recolhido ? 'recolhida' : ''}`}>
      <a href="#conteudo" className="pular">
        Pular para o conteúdo
      </a>
      {carregandoDados && <div className="barra-carregando" role="progressbar" aria-label="Carregando" />}
      {menuAberto && <button type="button" className="lateral-fundo" aria-label="Fechar o menu" onClick={() => setMenuAberto(false)} />}

      <aside className={`lateral ${menuAberto ? 'aberta' : ''}`}>
        <div className="lateral-topo">
          <Marca />
          <button type="button" className="botao-icone lateral-recolher" onClick={alternarMenu}
            aria-label={recolhido ? 'Expandir o menu' : 'Recolher o menu'} title={recolhido ? 'Expandir o menu' : 'Recolher o menu'}>
            <Icone nome={recolhido ? 'expandir' : 'recolher'} />
          </button>
        </div>
        <nav aria-label="Telas do sistema">
          {visiveis.map((item, i) => (
            <Fragment key={item.para}>
              {item.grupo !== visiveis[i - 1]?.grupo && <span className="menu-grupo">{item.grupo}</span>}
              {/* Com o menu recolhido só o ícone aparece; o título vira a dica do navegador. */}
              <NavLink to={item.para} end={item.para === '/'} title={recolhido ? item.rotulo : undefined} aria-label={item.rotulo}>
                <Icone nome={item.icone} />
                {item.rotulo}
              </NavLink>
            </Fragment>
          ))}
        </nav>
        <div className="lateral-pe">
          <span className="avatar" aria-hidden="true" title={recolhido ? usuario.nome : undefined}>
            {iniciais(usuario.nome)}
          </span>
          <div className="lateral-usuario">
            <strong title={usuario.nome}>{usuario.nome}</strong>
            <small title={usuario.empresa.nome}>{usuario.empresa.nome}</small>
          </div>
          <button type="button" className="botao-icone" title="Sair" aria-label="Sair" onClick={sair}>
            <Icone nome="sair" />
          </button>
        </div>
      </aside>

      <div className="area">
        <header className="topo">
          <button type="button" className="botao-icone topo-menu" aria-label="Abrir o menu" aria-expanded={menuAberto} onClick={() => setMenuAberto(true)}>
            <Icone nome="menu" />
          </button>
          <nav className="trilha" aria-label="Onde você está">
            {atual && atual.para !== '/' && (
              <>
                <span>{atual.grupo}</span>
                <i aria-hidden="true">/</i>
              </>
            )}
            <strong>{atual?.rotulo ?? 'Prumo'}</strong>
          </nav>
          <div className="topo-acoes">
            <button type="button" className="busca-botao" onClick={() => setBuscando(true)} aria-label="Buscar uma tela">
              <Icone nome="busca" />
              <span>Buscar…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <Notificacoes chave={pathname} />
            <Suspenso
              rotulo="Sua conta"
              gatilho={<span className="avatar">{iniciais(usuario.nome)}</span>}
              classeDoBotao="topo-avatar"
            >
              {(fechar) => (
                <>
                  <div className="suspenso-titulo">
                    <strong>{usuario.nome}</strong>
                    <small>{usuario.perfilNome} · {usuario.empresa.nome}</small>
                  </div>
                  <hr />
                  <button type="button" className="suspenso-item" onClick={() => { fechar(); setTrocandoSenha(true) }}>
                    <Icone nome="chave" />
                    Alterar senha
                  </button>
                  <button type="button" className="suspenso-item" onClick={sair}>
                    <Icone nome="sair" />
                    Sair
                  </button>
                </>
              )}
            </Suspenso>
          </div>
        </header>

        <main className="conteudo" id="conteudo" tabIndex={-1} ref={conteudo}>
          {/* A chave refaz o bloco a cada tela, e é isso que dispara a animação de entrada. */}
          <div key={pathname} className="pagina">
            <Outlet />
          </div>
        </main>
      </div>

      {buscando && <BuscaDeTelas telas={visiveis} onFechar={() => setBuscando(false)} />}
      {trocandoSenha && <TrocarSenha onFechar={() => setTrocandoSenha(false)} />}
    </div>
  )
}

// Botão que abre uma caixa suspensa logo abaixo. Fecha ao clicar fora ou apertar Esc.
function Suspenso(props: { rotulo: string; gatilho: ReactNode; classeDoBotao: string; children: (fechar: () => void) => ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const aoClicar = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false)
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false)
    document.addEventListener('mousedown', aoClicar)
    window.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicar)
      window.removeEventListener('keydown', aoTeclar)
    }
  }, [aberto])

  return (
    <div className="suspenso" ref={caixa}>
      <button type="button" className={props.classeDoBotao} aria-label={props.rotulo} aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
        {props.gatilho}
      </button>
      {aberto && <div className="suspenso-caixa">{props.children(() => setAberto(false))}</div>}
    </div>
  )
}

// O sino mostra o que pede atenção agora, a partir dos mesmos números do Início.
function Notificacoes({ chave }: { chave: string }) {
  const [resumo, setResumo] = useState<Resumo | null>(null)
  // Atualiza ao entrar e a cada troca de tela. Quem não tem acesso ao resumo fica sem alertas.
  useEffect(() => {
    let ativo = true
    api<Resumo>('/dashboard/resumo').then((r) => ativo && setResumo(r), () => ativo && setResumo(null))
    return () => {
      ativo = false
    }
  }, [chave])

  const alertas = useMemo(() => {
    if (!resumo) return []
    const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
    return [
      !!resumo.receber?.vencidas && { tom: 'ruim', para: '/financeiro', titulo: plural(resumo.receber!.vencidas, 'parcela a receber vencida', 'parcelas a receber vencidas'), nota: 'Financeiro · A receber' },
      !!resumo.pagar?.vencidas && { tom: 'ruim', para: '/financeiro', titulo: plural(resumo.pagar!.vencidas, 'parcela a pagar vencida', 'parcelas a pagar vencidas'), nota: 'Financeiro · A pagar' },
      !!resumo.entregas?.falhas && { tom: 'alerta', para: '/entregas', titulo: plural(resumo.entregas!.falhas, 'entrega com falha', 'entregas com falha'), nota: 'Logística · reprogramar' },
      !!resumo.estoque?.semEstoque && { tom: 'alerta', para: '/produtos', titulo: plural(resumo.estoque!.semEstoque, 'produto sem estoque', 'produtos sem estoque'), nota: 'Produtos e estoque' },
      !!resumo.entregas?.pendentes && { tom: 'info', para: '/entregas', titulo: plural(resumo.entregas!.pendentes, 'entrega pendente', 'entregas pendentes'), nota: 'Logística' },
      // Avisos dos links públicos.
      ...resumo.avisos.linksAbertos.map((r) => ({
        tom: 'info',
        para: '/entregas',
        titulo: `Entregador abriu a rota "${r.nome}"`,
        nota: `Logística · ${new Date(r.linkAbertoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`,
      })),
      ...resumo.avisos.cadastrosAtualizados.map((p) => ({
        tom: 'info',
        para: '/pessoas',
        titulo: `${p.nome} atualizou o cadastro`,
        nota: `Pessoas · ${new Date(p.cadastroAtualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`,
      })),
    ].filter((a) => a !== false)
  }, [resumo])
  const urgentes = alertas.filter((a) => a.tom !== 'info').length

  return (
    <Suspenso
      rotulo={urgentes ? `Notificações: ${urgentes} pedem atenção` : 'Notificações'}
      classeDoBotao="botao-icone"
      gatilho={
        <>
          <Icone nome="sino" />
          {urgentes > 0 && <span className="contador">{urgentes}</span>}
        </>
      }
    >
      {(fechar) => (
        <>
          <div className="suspenso-titulo">
            <strong>Notificações</strong>
          </div>
          <hr />
          {alertas.length === 0 && <p className="aviso">Nada pedindo atenção agora.</p>}
          {alertas.map((a) => (
            <Link key={a.titulo} to={a.para} className="suspenso-item" onClick={fechar}>
              <span className={`ponto ${a.tom === 'info' ? '' : `ponto-${a.tom}`}`} />
              <span>
                {a.titulo}
                <small>{a.nota}</small>
              </span>
            </Link>
          ))}
        </>
      )}
    </Suspenso>
  )
}

// Busca rápida de telas, aberta pelo campo do topo ou por Ctrl K. Setas escolhem, Enter abre.
function BuscaDeTelas({ telas, onFechar }: { telas: ItemMenu[]; onFechar: () => void }) {
  const [termo, setTermo] = useState('')
  const [indice, setIndice] = useState(0)
  const navegar = useNavigate()
  const achadas = telas.filter((t) => simples(`${t.rotulo} ${t.grupo}`).includes(simples(termo.trim())))
  const escolhida = Math.min(indice, Math.max(0, achadas.length - 1))

  function abrir(tela: ItemMenu | undefined) {
    if (!tela) return
    navegar(tela.para)
    onFechar()
  }

  return (
    <div className="paleta-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="paleta" role="dialog" aria-modal="true" aria-label="Buscar uma tela">
        <div className="paleta-campo">
          <Icone nome="busca" />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="paleta-lista"
            aria-label="Buscar uma tela"
            placeholder="Para onde você quer ir?"
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value)
              setIndice(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onFechar()
              if (e.key === 'Enter') abrir(achadas[escolhida])
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const passo = e.key === 'ArrowDown' ? 1 : -1
                setIndice((escolhida + passo + achadas.length) % Math.max(1, achadas.length))
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        {achadas.length === 0 ? (
          <p className="aviso">Nenhuma tela com esse nome.</p>
        ) : (
          <ul className="paleta-lista" id="paleta-lista" role="listbox">
            {achadas.map((t, i) => (
              <li key={t.para} role="option" aria-selected={i === escolhida}>
                <button type="button" onClick={() => abrir(t)} onMouseEnter={() => setIndice(i)}>
                  <Icone nome={t.icone} />
                  {t.rotulo}
                  <small>{t.grupo}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
