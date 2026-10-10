import { useState, type FormEvent } from 'react'
import { api, useAcao, useDados } from '../api'
import { confirmar } from '../confirmacao'
import { useSessao } from '../auth'
import { comEnderecoDoCep, useBuscaCep } from '../cep'
import { documentoBr, mascarar, telefoneBr } from '../format'
import type { Classificacao, Pessoa } from '../types'
import { Cabecalho, Campo, Erro, EstadoLista, Modal, Selo, useOrdenacao, usePaginacao } from '../ui'

type Rascunho = Omit<Pessoa, 'id'> & { id?: number }

const classificacoes: Record<Classificacao, string> = {
  cliente: 'Cliente',
  fornecedor: 'Fornecedor',
  prestador: 'Prestador de serviço',
  paciente: 'Paciente',
  medico: 'Médico',
  vendedor: 'Vendedor',
}
const chaves = Object.keys(classificacoes) as Classificacao[]

const nova = (): Rascunho => ({
  nome: '', nomeFantasia: '', documento: '', rgIe: '', email: '', telefone: '', celular: '', cep: '',
  logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
  cliente: true, fornecedor: false, prestador: false, paciente: false, medico: false, vendedor: false, ativo: true,
  cadastroLinkExpiraEm: null, cadastroAtualizadoEm: null,
})

export function Pessoas() {
  const [busca, setBusca] = useState('')
  const [classificacao, setClassificacao] = useState('')
  const consulta = new URLSearchParams({ ...(busca ? { busca } : {}), ...(classificacao ? { classificacao } : {}) })
  const { dados, erro, carregando, recarregar } = useDados<Pessoa[]>(`/pessoas?${consulta}`)
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const pessoas = dados ?? []
  const { ordenados, titulo } = useOrdenacao(pessoas, {
    nome: (p) => p.nome,
    classificacao: (p) => chaves.filter((chave) => p[chave]).map((chave) => classificacoes[chave]).join(', '),
    documento: (p) => p.documento,
    contato: (p) => p.celular || p.telefone || p.email,
    cidade: (p) => [p.cidade, p.uf].filter(Boolean).join('/'),
  })
  const paginas = usePaginacao(ordenados)
  const { pode } = useSessao()

  return (
    <>
      <Cabecalho titulo="Pessoas" descricao="Cadastro único de clientes, fornecedores e demais contatos.">
        {pode('PESSOAS_CADASTRAR') && (
          <button type="button" className="botao botao-primario" onClick={() => setEditando(nova())}>
            Nova pessoa
          </button>
        )}
      </Cabecalho>

      <div className="filtros">
        <input type="search" placeholder="Buscar por nome, documento, telefone ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select value={classificacao} onChange={(e) => setClassificacao(e.target.value)} aria-label="Classificação">
          <option value="">Todas as classificações</option>
          {chaves.map((chave) => (
            <option key={chave} value={chave}>
              {classificacoes[chave]}
            </option>
          ))}
        </select>
      </div>

      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={pessoas.length === 0} textoVazio="Nenhuma pessoa encontrada." />
        {pessoas.length > 0 && (
          <table>
            <thead>
              <tr>
                {titulo('nome', 'Nome')}
                {titulo('classificacao', 'Classificação')}
                {titulo('documento', 'Documento')}
                {titulo('contato', 'Contato')}
                {titulo('cidade', 'Cidade')}
                <th />
              </tr>
            </thead>
            <tbody>
              {paginas.visiveis.map((p) => (
                <tr key={p.id} className={p.ativo ? '' : 'linha-inativa'}>
                  <td>
                    {p.nome} {!p.ativo && <Selo valor="Inativa" tom="apagado" />}
                    {p.nomeFantasia && <small className="bloco texto-suave">{p.nomeFantasia}</small>}
                  </td>
                  <td>{chaves.filter((chave) => p[chave]).map((chave) => classificacoes[chave]).join(', ')}</td>
                  <td>{documentoBr(p.documento)}</td>
                  <td>{[telefoneBr(p.celular), telefoneBr(p.telefone), p.email].filter(Boolean).join(' · ')}</td>
                  <td>{[p.cidade, p.uf].filter(Boolean).join('/')}</td>
                  <td className="num">
                    {pode('PESSOAS_ALTERAR') && (
                      <button type="button" className="botao botao-texto" onClick={() => setEditando(p)}>
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {paginas.controle}
      </section>

      {editando && (
        <FormPessoa
          inicial={editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            recarregar()
          }}
        />
      )}
    </>
  )
}

type CampoTexto = Exclude<keyof Pessoa, 'id' | 'ativo' | Classificacao | 'cadastroLinkExpiraEm' | 'cadastroAtualizadoEm'>

// Link para a própria pessoa conferir e atualizar identificação, contato e endereço. Vale uma vez.
function LinkCadastro({ pessoa }: { pessoa: Rascunho & { id: number } }) {
  const [link, setLink] = useState<{ url: string; expiraEm: string } | null>(null)
  const [ativoAte, setAtivoAte] = useState(pessoa.cadastroLinkExpiraEm && new Date(pessoa.cadastroLinkExpiraEm) > new Date() ? pessoa.cadastroLinkExpiraEm : null)
  const { erro, ocupado, executar } = useAcao()
  const digitos = (pessoa.celular || pessoa.telefone || '').replace(/\D/g, '')
  const whatsapp = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : ''

  const gerar = () =>
    executar(async () => {
      const r = await api<{ chave: string; expiraEm: string }>(`/pessoas/${pessoa.id}/link-cadastro`, { body: { dias: 7 } })
      setLink({ url: `${window.location.origin}/cadastro/${pessoa.id}#chave=${r.chave}`, expiraEm: r.expiraEm })
      setAtivoAte(r.expiraEm)
    })
  const revogar = () =>
    executar(async () => {
      await api(`/pessoas/${pessoa.id}/link-cadastro`, { method: 'DELETE' })
      setLink(null)
      setAtivoAte(null)
    })

  return (
    <div className="col-3">
      <h3 className="secao">Atualização pelo próprio cliente</h3>
      <p className="texto-suave">
        {pessoa.cadastroAtualizadoEm && `Atualizado pela pessoa em ${new Date(pessoa.cadastroAtualizadoEm).toLocaleString('pt-BR')}. `}
        {ativoAte ? `Há um link valendo até ${new Date(ativoAte).toLocaleString('pt-BR')}.` : 'Gere um link para a pessoa conferir e corrigir os próprios dados. Ele vale uma vez, por 7 dias.'}
      </p>
      {link && (
        <p className="rota-link">
          Envie este link à pessoa. Ele só aparece agora; gerar outro invalida este.
          <input readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Link de atualização do cadastro" />
          {whatsapp && (
            <a
              className="botao botao-texto"
              target="_blank"
              rel="noreferrer"
              href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Olá! Confira e atualize seu cadastro pelo link: ${link.url}`)}`}
            >
              Enviar pelo WhatsApp
            </a>
          )}
        </p>
      )}
      <Erro mensagem={erro} />
      <button type="button" className="botao" disabled={ocupado} onClick={gerar}>
        {ativoAte ? 'Gerar novo link' : 'Gerar link'}
      </button>
      {ativoAte && (
        <button type="button" className="botao botao-texto" disabled={ocupado} onClick={revogar}>
          Revogar
        </button>
      )}
    </div>
  )
}

function FormPessoa(props: { inicial: Rascunho; onFechar: () => void; onSalvo: () => void }) {
  const [p, setP] = useState(props.inicial)
  const { pode } = useSessao()
  const { erro, ocupado, executar } = useAcao()
  const campo = (nome: CampoTexto) => ({
    value: mascarar(nome, p[nome] ?? ''),
    onChange: (e: { target: { value: string } }) => setP({ ...p, [nome]: mascarar(nome, e.target.value) }),
  })

  // Preenche o endereço a partir do CEP usando o serviço público ViaCEP.
  const buscaCep = useBuscaCep((achado) => setP((atual) => comEnderecoDoCep(atual, achado)))

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const { id, ...corpo } = p
      await api(id ? `/pessoas/${id}` : '/pessoas', { method: id ? 'PUT' : 'POST', body: corpo })
      props.onSalvo()
    })
  }

  async function excluir() {
    if (!p.id || !(await confirmar({ texto: `Excluir o cadastro de "${p.nome}"? Esta ação não pode ser desfeita.`, botao: 'Excluir', perigo: true }))) return
    executar(async () => {
      await api(`/pessoas/${p.id}`, { method: 'DELETE' })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={p.id ? 'Editar pessoa' : 'Nova pessoa'} onFechar={props.onFechar} largo>
      <form onSubmit={enviar} className="form">
        <h3 className="secao col-3">Dados principais</h3>
        <Campo rotulo="Nome ou razão social" largura={3}>
          <input required autoFocus {...campo('nome')} />
        </Campo>
        <Campo rotulo="Nome fantasia">
          <input {...campo('nomeFantasia')} />
        </Campo>
        <Campo rotulo="CPF ou CNPJ">
          <input {...campo('documento')} />
        </Campo>
        <Campo rotulo="RG ou inscrição estadual">
          <input {...campo('rgIe')} />
        </Campo>

        <h3 className="secao col-3">Contato</h3>
        <Campo rotulo="Telefone">
          <input type="tel" {...campo('telefone')} />
        </Campo>
        <Campo rotulo="Celular">
          <input type="tel" {...campo('celular')} />
        </Campo>
        <Campo rotulo="E-mail">
          <input type="email" {...campo('email')} />
        </Campo>

        <h3 className="secao col-3">Endereço</h3>
        <Campo rotulo="CEP">
          <input {...campo('cep')} {...buscaCep} />
        </Campo>
        <Campo rotulo="Logradouro" largura={2}>
          <input {...campo('logradouro')} />
        </Campo>
        <Campo rotulo="Número">
          <input {...campo('numero')} />
        </Campo>
        <Campo rotulo="Complemento" largura={2}>
          <input {...campo('complemento')} />
        </Campo>
        <Campo rotulo="Bairro">
          <input {...campo('bairro')} />
        </Campo>
        <Campo rotulo="Cidade">
          <input {...campo('cidade')} />
        </Campo>
        <Campo rotulo="UF">
          <input maxLength={2} {...campo('uf')} onChange={(e) => setP({ ...p, uf: e.target.value.toUpperCase() })} />
        </Campo>

        <h3 className="secao col-3">Classificação</h3>
        <fieldset className="marcacoes col-3">
          <legend className="oculto">Classificação</legend>
          {chaves.map((chave) => (
            <label key={chave} className="marcar">
              <input type="checkbox" checked={p[chave]} onChange={(e) => setP({ ...p, [chave]: e.target.checked })} />
              {classificacoes[chave]}
            </label>
          ))}
          <label className="marcar marcar-ativo">
            <input type="checkbox" checked={p.ativo} onChange={(e) => setP({ ...p, ativo: e.target.checked })} />
            Ativo
          </label>
        </fieldset>

        {p.id && pode('PESSOAS_ALTERAR') && <LinkCadastro pessoa={{ ...p, id: p.id }} />}

        <Erro mensagem={erro} />
        <div className="form-pe">
          {p.id && (
            <button type="button" className="botao botao-perigo empurra" onClick={excluir} disabled={ocupado}>
              Excluir cadastro
            </button>
          )}
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            {p.id ? 'Salvar alterações' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
