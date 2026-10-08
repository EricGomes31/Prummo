import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import type { Perfil, PerfilAcesso, PerfilPadrao, Perfis, Usuario } from '../types'
import { Cabecalho, Campo, Erro, EstadoLista, Modal, Selo } from '../ui'

type Rascunho = { id?: number; nome: string; email: string; perfil: Perfil; perfilId: number | null; ativo: boolean; senha: string }
type RascunhoPerfil = { id?: number; nome: string; descricao: string; permissoes: string[]; dashboards: string[]; ativo: boolean }

const perfilVazio: RascunhoPerfil = { nome: '', descricao: '', permissoes: [], dashboards: [], ativo: true }

export function Usuarios() {
  const { pode } = useSessao()
  const gerencia = pode('USUARIOS_GERENCIAR')
  const [aba, setAba] = useState<'usuarios' | 'perfis'>('usuarios')
  const usuarios = useDados<Usuario[]>(gerencia ? '/usuarios' : null)
  const perfis = useDados<Perfis>(gerencia ? '/perfis' : null)
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const [editandoPerfil, setEditandoPerfil] = useState<RascunhoPerfil | null>(null)
  const [vendoPerfil, setVendoPerfil] = useState<PerfilPadrao | null>(null)
  const lista = usuarios.dados ?? []

  if (!gerencia) return <Navigate to="/" replace />

  function atualizar() {
    usuarios.recarregar()
    perfis.recarregar()
  }

  return (
    <>
      <Cabecalho titulo="Usuários e perfis" descricao="Quem pode acessar o sistema e o que cada perfil pode fazer.">
        {aba === 'usuarios' ? (
          <button
            type="button"
            className="botao botao-primario"
            onClick={() => setEditando({ nome: '', email: '', perfil: 'OPERADOR', perfilId: null, ativo: true, senha: '' })}
          >
            Novo usuário
          </button>
        ) : (
          <button type="button" className="botao botao-primario" onClick={() => setEditandoPerfil(perfilVazio)}>
            Novo perfil
          </button>
        )}
      </Cabecalho>

      <div className="abas" role="tablist">
        <button type="button" role="tab" aria-selected={aba === 'usuarios'} onClick={() => setAba('usuarios')}>
          Usuários
        </button>
        <button type="button" role="tab" aria-selected={aba === 'perfis'} onClick={() => setAba('perfis')}>
          Perfis de acesso
        </button>
      </div>

      {aba === 'usuarios' && (
        <section className="painel">
          <EstadoLista carregando={usuarios.carregando} erro={usuarios.erro} vazia={lista.length === 0} textoVazio="Nenhum usuário." />
          {lista.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.map((u) => (
                  <tr key={u.id} className={u.ativo ? '' : 'linha-inativa'}>
                    <td>{u.nome}</td>
                    <td>{u.email}</td>
                    <td>{u.perfilNome}</td>
                    <td><Selo valor={u.ativo ? 'Ativo' : 'Inativo'} tom={u.ativo ? 'bom' : 'apagado'} /></td>
                    <td className="num">
                      <button type="button" className="botao botao-texto" onClick={() => setEditando({ ...u, senha: '' })}>
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {aba === 'perfis' && (
        <section className="painel">
          <EstadoLista carregando={perfis.carregando} erro={perfis.erro} vazia={!perfis.dados} textoVazio="" />
          {perfis.dados && (
            <table>
              <thead>
                <tr>
                  <th>Perfil</th>
                  <th>Descrição</th>
                  <th className="num">Permissões</th>
                  <th>Dashboards</th>
                  <th className="num">Usuários</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {perfis.dados.padrao.map((p) => (
                  <tr key={p.codigo}>
                    <td>{p.nome} <small className="texto-suave">(de fábrica)</small></td>
                    <td>{p.descricao}</td>
                    <td className="num">{p.permissoes.length}</td>
                    <td>{nomesDosDashboards(perfis.dados!, p.dashboards)}</td>
                    <td className="num">{lista.filter((u) => !u.perfilId && u.perfil === p.codigo).length}</td>
                    <td><Selo valor="Ativo" tom="bom" /></td>
                    <td className="num">
                      <button type="button" className="botao botao-texto" onClick={() => setVendoPerfil(p)}>
                        Ver acessos
                      </button>
                    </td>
                  </tr>
                ))}
                {perfis.dados.personalizados.map((p) => (
                  <tr key={p.id} className={p.ativo ? '' : 'linha-inativa'}>
                    <td>{p.nome}</td>
                    <td>{p.descricao ?? '—'}</td>
                    <td className="num">{p.permissoes.length}</td>
                    <td>{nomesDosDashboards(perfis.dados!, p.dashboards)}</td>
                    <td className="num">{p.usuarios}</td>
                    <td><Selo valor={p.ativo ? 'Ativo' : 'Inativo'} tom={p.ativo ? 'bom' : 'apagado'} /></td>
                    <td className="num">
                      <button type="button" className="botao botao-texto" onClick={() => setEditandoPerfil({ ...p, descricao: p.descricao ?? '' })}>
                        Editar acessos
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {editando && (
        <FormUsuario
          inicial={editando}
          perfis={perfis.dados?.personalizados ?? []}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            atualizar()
          }}
        />
      )}
      {perfis.dados && (editandoPerfil || vendoPerfil) && (
        <FormPerfil
          inicial={editandoPerfil ?? { ...vendoPerfil!, id: undefined, ativo: true }}
          somenteLeitura={!editandoPerfil}
          catalogo={perfis.dados.catalogo}
          onFechar={() => {
            setEditandoPerfil(null)
            setVendoPerfil(null)
          }}
          onSalvo={() => {
            setEditandoPerfil(null)
            atualizar()
          }}
        />
      )}
    </>
  )
}

const nomesDosDashboards = (perfis: Perfis, codigos: string[]) =>
  codigos.length === perfis.catalogo.dashboards.length
    ? 'Todos'
    : perfis.catalogo.dashboards.filter((d) => codigos.includes(d.codigo)).map((d) => d.rotulo).join(', ') || 'Nenhum'

function FormUsuario(props: { inicial: Rascunho; perfis: PerfilAcesso[]; onFechar: () => void; onSalvo: () => void }) {
  const [u, setU] = useState(props.inicial)
  const { erro, ocupado, executar } = useAcao()
  // O seletor junta os perfis de fábrica e os personalizados: "ADMIN", "OPERADOR" ou o número do perfil.
  const escolha = u.perfilId ? String(u.perfilId) : u.perfil
  const escolher = (valor: string) =>
    setU(valor === 'ADMIN' || valor === 'OPERADOR' ? { ...u, perfil: valor, perfilId: null } : { ...u, perfil: 'OPERADOR', perfilId: Number(valor) })

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const corpo = { nome: u.nome, email: u.email, perfil: u.perfil, perfilId: u.perfilId, ativo: u.ativo, ...(u.senha ? { senha: u.senha } : {}) }
      await api(u.id ? `/usuarios/${u.id}` : '/usuarios', { method: u.id ? 'PUT' : 'POST', body: corpo })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={u.id ? 'Editar usuário' : 'Novo usuário'} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Nome" largura={3}>
          <input required autoFocus value={u.nome} onChange={(e) => setU({ ...u, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="E-mail" largura={3}>
          <input type="email" required value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} />
        </Campo>
        <Campo rotulo="Perfil de acesso">
          <select value={escolha} onChange={(e) => escolher(e.target.value)}>
            <option value="OPERADOR">Operador</option>
            <option value="ADMIN">Administrador</option>
            {props.perfis
              .filter((p) => p.ativo || p.id === u.perfilId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
          </select>
        </Campo>
        <Campo rotulo={u.id ? 'Nova senha (deixe vazio para manter)' : 'Senha (mínimo de 8 caracteres)'} largura={2}>
          <input type="password" minLength={8} required={!u.id} autoComplete="new-password" value={u.senha} onChange={(e) => setU({ ...u, senha: e.target.value })} />
        </Campo>
        {u.id && (
          <label className="marcar col-3">
            <input type="checkbox" checked={u.ativo} onChange={(e) => setU({ ...u, ativo: e.target.checked })} />
            Usuário ativo
          </label>
        )}
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
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

// Cria ou altera um perfil personalizado; para os perfis de fábrica só mostra os acessos.
function FormPerfil(props: {
  inicial: RascunhoPerfil
  somenteLeitura: boolean
  catalogo: Perfis['catalogo']
  onFechar: () => void
  onSalvo: () => void
}) {
  const [p, setP] = useState(props.inicial)
  const { erro, ocupado, executar } = useAcao()
  const alternar = (campo: 'permissoes' | 'dashboards', codigos: string[], marcar: boolean) =>
    setP({ ...p, [campo]: marcar ? [...new Set([...p[campo], ...codigos])] : p[campo].filter((c) => !codigos.includes(c)) })

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const { id, ...corpo } = p
      await api(id ? `/perfis/${id}` : '/perfis', { method: id ? 'PUT' : 'POST', body: corpo })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={props.somenteLeitura ? `Perfil ${p.nome}` : p.id ? `Editar perfil ${props.inicial.nome}` : 'Novo perfil de acesso'} onFechar={props.onFechar} largo>
      <form onSubmit={enviar} className="form">
        {props.somenteLeitura ? (
          <p className="texto-suave col-3">{p.descricao} Os perfis de fábrica não podem ser alterados; crie um perfil novo para ajustar os acessos.</p>
        ) : (
          <>
            <Campo rotulo="Nome do perfil">
              <input required autoFocus value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} />
            </Campo>
            <Campo rotulo="Descrição" largura={2}>
              <input value={p.descricao} onChange={(e) => setP({ ...p, descricao: e.target.value })} />
            </Campo>
          </>
        )}

        <fieldset className="marcacoes col-3" disabled={props.somenteLeitura}>
          <legend className="oculto">Dashboards</legend>
          <strong>Dashboards</strong>
          {props.catalogo.dashboards.map((d) => (
            <label key={d.codigo} className="marcar">
              <input type="checkbox" checked={p.dashboards.includes(d.codigo)} onChange={(e) => alternar('dashboards', [d.codigo], e.target.checked)} />
              {d.rotulo}
            </label>
          ))}
        </fieldset>

        {props.catalogo.grupos.map((g) => {
          const codigos = g.permissoes.map((x) => x.codigo)
          const todas = codigos.every((c) => p.permissoes.includes(c))
          return (
            <fieldset key={g.grupo} className="marcacoes col-3" disabled={props.somenteLeitura}>
              <legend className="oculto">{g.grupo}</legend>
              <label className="marcar">
                <input type="checkbox" checked={todas} onChange={(e) => alternar('permissoes', codigos, e.target.checked)} />
                <strong>{g.grupo}</strong>
              </label>
              {g.permissoes.map((x) => (
                <label key={x.codigo} className="marcar">
                  <input type="checkbox" checked={p.permissoes.includes(x.codigo)} onChange={(e) => alternar('permissoes', [x.codigo], e.target.checked)} />
                  {x.rotulo}
                </label>
              ))}
            </fieldset>
          )
        })}

        {!props.somenteLeitura && p.id && (
          <label className="marcar col-3">
            <input type="checkbox" checked={p.ativo} onChange={(e) => setP({ ...p, ativo: e.target.checked })} />
            Perfil ativo (inativo, os usuários dele ficam sem nenhum acesso)
          </label>
        )}
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            {props.somenteLeitura ? 'Fechar' : 'Cancelar'}
          </button>
          {!props.somenteLeitura && (
            <button className="botao botao-primario" disabled={ocupado}>
              Salvar
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
