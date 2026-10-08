import { useState, type FormEvent } from 'react'
import { api, useAcao, useDados } from '../api'
import type { Classificacao, Pessoa } from '../types'
import { Cabecalho, Campo, Erro, EstadoLista, Modal, Selo, usePaginacao } from '../ui'

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
})

export function Pessoas() {
  const [busca, setBusca] = useState('')
  const [classificacao, setClassificacao] = useState('')
  const consulta = new URLSearchParams({ ...(busca ? { busca } : {}), ...(classificacao ? { classificacao } : {}) })
  const { dados, erro, carregando, recarregar } = useDados<Pessoa[]>(`/pessoas?${consulta}`)
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const pessoas = dados ?? []
  const paginas = usePaginacao(pessoas)

  return (
    <>
      <Cabecalho titulo="Pessoas" descricao="Cadastro único de clientes, fornecedores e demais contatos.">
        <button type="button" className="botao botao-primario" onClick={() => setEditando(nova())}>
          Nova pessoa
        </button>
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
                <th>Nome</th>
                <th>Classificação</th>
                <th>Documento</th>
                <th>Contato</th>
                <th>Cidade</th>
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
                  <td>{p.documento}</td>
                  <td>{[p.celular, p.telefone, p.email].filter(Boolean).join(' · ')}</td>
                  <td>{[p.cidade, p.uf].filter(Boolean).join('/')}</td>
                  <td className="num">
                    <button type="button" className="botao botao-texto" onClick={() => setEditando(p)}>
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

type CampoTexto = Exclude<keyof Pessoa, 'id' | 'ativo' | Classificacao>

function FormPessoa(props: { inicial: Rascunho; onFechar: () => void; onSalvo: () => void }) {
  const [p, setP] = useState(props.inicial)
  const { erro, ocupado, executar } = useAcao()
  const campo = (nome: CampoTexto) => ({
    value: p[nome] ?? '',
    onChange: (e: { target: { value: string } }) => setP({ ...p, [nome]: e.target.value }),
  })

  // Preenche o endereço a partir do CEP usando o serviço público ViaCEP.
  async function buscarCep() {
    const cep = (p.cep ?? '').replace(/\D/g, '')
    if (cep.length !== 8) return
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((res) => res.json())
      if (r.erro) return
      setP((atual) => ({
        ...atual,
        logradouro: atual.logradouro || r.logradouro,
        bairro: atual.bairro || r.bairro,
        cidade: r.localidade,
        uf: r.uf,
      }))
    } catch {
      // Sem o serviço de CEP, o endereço é preenchido à mão.
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const { id, ...corpo } = p
      await api(id ? `/pessoas/${id}` : '/pessoas', { method: id ? 'PUT' : 'POST', body: corpo })
      props.onSalvo()
    })
  }

  function excluir() {
    if (!p.id || !window.confirm(`Excluir o cadastro de "${p.nome}"? Esta ação não pode ser desfeita.`)) return
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
          <input {...campo('cep')} onBlur={buscarCep} />
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
