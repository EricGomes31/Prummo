import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import { dataBr, documentoBr, mascaraDocumento } from '../format'
import type { Empresa } from '../types'
import { Cabecalho, Campo, Erro, EstadoLista, Modal, Selo, useOrdenacao, usePaginacao } from '../ui'

type Rascunho = { id?: number; nome: string; documento: string; ativa: boolean; admNome: string; admEmail: string; admSenha: string }

const vazia: Rascunho = { nome: '', documento: '', ativa: true, admNome: '', admEmail: '', admSenha: '' }

// Empresas que usam o Prumo. Só o administrador do sistema vê esta tela.
export function Empresas() {
  const { usuario } = useSessao()
  const empresas = useDados<Empresa[]>(usuario?.sistema ? '/sistema/empresas' : null)
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const lista = empresas.dados ?? []
  const { ordenados: ordenados, titulo: titulo } = useOrdenacao(lista, {
    empresa: (e) => e.nome,
    documento: (e) => e.documento,
    usuarios: (e) => e.usuarios,
    criada: (e) => e.criadoEm,
    situacao: (e) => (e.ativa ? 'Ativa' : 'Inativa'),
  })
  const paginas = usePaginacao(ordenados)

  if (!usuario?.sistema) return <Navigate to="/" replace />

  return (
    <>
      <Cabecalho titulo="Empresas" descricao="Cada empresa só vê os próprios dados: pessoas, produtos, pedidos, financeiro e usuários.">
        <button type="button" className="botao botao-primario" onClick={() => setEditando(vazia)}>
          Nova empresa
        </button>
      </Cabecalho>

      <section className="painel">
        <EstadoLista carregando={empresas.carregando} erro={empresas.erro} vazia={lista.length === 0} textoVazio="Nenhuma empresa." />
        {lista.length > 0 && (
          <table>
            <thead>
              <tr>
                {titulo('empresa', 'Empresa')}
                {titulo('documento', 'CNPJ ou CPF')}
                {titulo('usuarios', 'Usuários', 'num')}
                {titulo('criada', 'Criada em')}
                {titulo('situacao', 'Situação')}
                <th />
              </tr>
            </thead>
            <tbody>
              {paginas.visiveis.map((e) => (
                <tr key={e.id} className={e.ativa ? '' : 'linha-inativa'}>
                  <td>
                    {e.nome}
                    {e.id === usuario.empresa.id && <span className="texto-suave"> · sua empresa</span>}
                  </td>
                  <td>{documentoBr(e.documento) ?? '—'}</td>
                  <td className="num">{e.usuarios}</td>
                  <td>{dataBr(e.criadoEm)}</td>
                  <td><Selo valor={e.ativa ? 'Ativa' : 'Inativa'} tom={e.ativa ? 'bom' : 'apagado'} /></td>
                  <td className="num">
                    <button type="button" className="botao botao-texto" onClick={() => setEditando({ ...vazia, id: e.id, nome: e.nome, documento: e.documento ?? '', ativa: e.ativa })}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {paginas.controle}
      </section>

      {editando && (
        <FormEmpresa
          inicial={editando}
          propria={editando.id === usuario.empresa.id}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            empresas.recarregar()
          }}
        />
      )}
    </>
  )
}

function FormEmpresa(props: { inicial: Rascunho; propria: boolean; onFechar: () => void; onSalvo: () => void }) {
  const [e, setE] = useState(props.inicial)
  const { erro, ocupado, executar } = useAcao()

  function enviar(ev: FormEvent) {
    ev.preventDefault()
    executar(async () => {
      if (e.id) {
        await api(`/sistema/empresas/${e.id}`, { method: 'PUT', body: { nome: e.nome, documento: e.documento, ativa: e.ativa } })
      } else {
        await api('/sistema/empresas', {
          body: { nome: e.nome, documento: e.documento, administrador: { nome: e.admNome, email: e.admEmail, senha: e.admSenha } },
        })
      }
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={e.id ? 'Editar empresa' : 'Nova empresa'} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Nome da empresa" largura={2}>
          <input required autoFocus value={e.nome} onChange={(v) => setE({ ...e, nome: v.target.value })} />
        </Campo>
        <Campo rotulo="CNPJ ou CPF">
          <input inputMode="numeric" value={mascaraDocumento(e.documento)} onChange={(v) => setE({ ...e, documento: mascaraDocumento(v.target.value) })} />
        </Campo>

        {!e.id && (
          <>
            <h3 className="secao col-3">Administrador da empresa</h3>
            <p className="texto-suave col-3">
              Primeiro usuário da empresa, com acesso total a ela. Depois ele cria os demais usuários em Sistema → Usuários.
            </p>
            <Campo rotulo="Nome" largura={3}>
              <input required value={e.admNome} onChange={(v) => setE({ ...e, admNome: v.target.value })} />
            </Campo>
            <Campo rotulo="E-mail (usado para entrar)" largura={2}>
              <input type="email" required value={e.admEmail} onChange={(v) => setE({ ...e, admEmail: v.target.value })} />
            </Campo>
            <Campo rotulo="Senha (mínimo de 8)">
              <input type="password" required minLength={8} autoComplete="new-password" value={e.admSenha} onChange={(v) => setE({ ...e, admSenha: v.target.value })} />
            </Campo>
          </>
        )}

        {e.id && (
          <label className="marcar col-3">
            <input type="checkbox" checked={e.ativa} disabled={props.propria} onChange={(v) => setE({ ...e, ativa: v.target.checked })} />
            {props.propria ? 'Empresa ativa (a sua empresa não pode ser desativada)' : 'Empresa ativa: desmarque para bloquear o acesso de todos os usuários dela'}
          </label>
        )}
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            {e.id ? 'Salvar' : 'Criar empresa'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
