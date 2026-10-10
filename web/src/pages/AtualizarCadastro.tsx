// Página pública para a pessoa conferir e atualizar o próprio cadastro, aberta pelo link que a empresa
// enviou. Não usa login: vale a chave que vem depois do "#", e o link vale uma vez.
import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { comEnderecoDoCep, useBuscaCep } from '../cep'
import { mascarar } from '../format'

type Dados = {
  empresa: string
  expiraEm: string
  nome: string
  nomeFantasia: string | null
  documento: string | null
  rgIe: string | null
  email: string | null
  telefone: string | null
  celular: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
}
type Campo = Exclude<keyof Dados, 'empresa' | 'expiraEm'>

export function AtualizarCadastro() {
  const { id } = useParams()
  const chave = new URLSearchParams(window.location.hash.slice(1)).get('chave') ?? ''
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(true)
  const [concluido, setConcluido] = useState(false)

  async function chamar(metodo: 'GET' | 'PUT', corpo?: unknown) {
    const res = await fetch(`/api/cadastro/${id}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-Cadastro-Token': chave },
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      body: corpo ? JSON.stringify(corpo) : undefined,
    })
    const resposta = await res.json().catch(() => null)
    if (!res.ok) throw new Error(resposta?.erro ?? 'Link indisponível ou expirado.')
    return resposta
  }

  useEffect(() => {
    chamar('GET')
      .then(setDados)
      .catch((e: Error) => setErro(e.message))
      .finally(() => setOcupado(false))
    // Carrega uma vez ao abrir o link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const campo = (nome: Campo) => ({
    value: mascarar(nome, dados?.[nome] ?? ''),
    onChange: (e: { target: { value: string } }) => dados && setDados({ ...dados, [nome]: mascarar(nome, e.target.value) }),
  })

  // Preenche o endereço a partir do CEP usando o serviço público ViaCEP.
  const buscaCep = useBuscaCep((achado) => setDados((atual) => atual && comEnderecoDoCep(atual, achado)))

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!dados) return
    setOcupado(true)
    setErro('')
    try {
      const { empresa: _empresa, expiraEm: _expira, ...corpo } = dados
      await chamar('PUT', corpo)
      setConcluido(true)
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível salvar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <main className="pagina-publica">
      <header>
        <small>{dados?.empresa.toUpperCase() ?? 'CADASTRO'}</small>
        <h1>Confira seus dados</h1>
        {dados && !concluido && <p>Corrija o que estiver diferente e salve. Este link vale até {new Date(dados.expiraEm).toLocaleString('pt-BR')} e pode ser usado uma vez.</p>}
      </header>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {ocupado && !dados && <p role="status" className="aviso">Carregando…</p>}
      {concluido && <p className="aviso">Pronto! Seus dados foram atualizados. Obrigado.</p>}

      {dados && !concluido && (
        <form onSubmit={enviar} className="form painel">
          <label className="campo col-3">
            <span>Nome completo ou razão social</span>
            <input required {...campo('nome')} />
          </label>
          <label className="campo">
            <span>Nome fantasia</span>
            <input {...campo('nomeFantasia')} />
          </label>
          <label className="campo">
            <span>CPF ou CNPJ</span>
            <input inputMode="numeric" {...campo('documento')} />
          </label>
          <label className="campo">
            <span>RG ou inscrição estadual</span>
            <input {...campo('rgIe')} />
          </label>
          <label className="campo">
            <span>Celular</span>
            <input type="tel" {...campo('celular')} />
          </label>
          <label className="campo">
            <span>Telefone</span>
            <input type="tel" {...campo('telefone')} />
          </label>
          <label className="campo">
            <span>E-mail</span>
            <input type="email" {...campo('email')} />
          </label>
          <label className="campo">
            <span>CEP</span>
            <input inputMode="numeric" {...campo('cep')} {...buscaCep} />
          </label>
          <label className="campo col-2">
            <span>Logradouro</span>
            <input {...campo('logradouro')} />
          </label>
          <label className="campo">
            <span>Número</span>
            <input {...campo('numero')} />
          </label>
          <label className="campo col-2">
            <span>Complemento</span>
            <input {...campo('complemento')} />
          </label>
          <label className="campo">
            <span>Bairro</span>
            <input {...campo('bairro')} />
          </label>
          <label className="campo">
            <span>Cidade</span>
            <input {...campo('cidade')} />
          </label>
          <label className="campo">
            <span>UF</span>
            <input maxLength={2} {...campo('uf')} onChange={(e) => setDados({ ...dados, uf: e.target.value.toUpperCase() })} />
          </label>
          <div className="form-pe">
            <button className="botao botao-primario" disabled={ocupado}>
              {ocupado ? 'Salvando…' : 'Salvar meus dados'}
            </button>
          </div>
        </form>
      )}
    </main>
  )
}
