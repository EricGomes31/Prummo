import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

const CHAVE_TOKEN = 'prumo.token'
export const EVENTO_SAIR = 'prumo:sair'

export const token = {
  ler: () => localStorage.getItem(CHAVE_TOKEN),
  gravar: (valor: string) => localStorage.setItem(CHAVE_TOKEN, valor),
  apagar: () => localStorage.removeItem(CHAVE_TOKEN),
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// Quantas chamadas à API estão em andamento. A barra de carregamento do topo acompanha este número.
let emAndamento = 0
const ouvintes = new Set<() => void>()
function contar(passo: 1 | -1) {
  emAndamento += passo
  ouvintes.forEach((avisar) => avisar())
}

export function useCarregando() {
  return useSyncExternalStore(
    (avisar) => {
      ouvintes.add(avisar)
      return () => ouvintes.delete(avisar)
    },
    () => emAndamento > 0,
  )
}

export async function api<T>(caminho: string, opcoes: { method?: string; body?: unknown } = {}): Promise<T> {
  contar(1)
  try {
    return await chamar<T>(caminho, opcoes)
  } finally {
    contar(-1)
  }
}

async function chamar<T>(caminho: string, opcoes: { method?: string; body?: unknown }): Promise<T> {
  const atual = token.ler()
  const temCorpo = opcoes.body !== undefined
  let res: Response
  try {
    res = await fetch(`/api${caminho}`, {
      method: opcoes.method ?? (temCorpo ? 'POST' : 'GET'),
      headers: {
        ...(temCorpo ? { 'Content-Type': 'application/json' } : {}),
        ...(atual ? { Authorization: `Bearer ${atual}` } : {}),
      },
      body: temCorpo ? JSON.stringify(opcoes.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Não foi possível falar com o servidor.')
  }
  if (res.status === 401 && caminho !== '/auth/login') {
    token.apagar()
    window.dispatchEvent(new Event(EVENTO_SAIR))
  }
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { erro?: string } | null
    throw new ApiError(res.status, corpo?.erro ?? 'Erro inesperado.')
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

// Baixa um arquivo protegido por login: busca com o token e entrega ao navegador como download.
export async function baixar(caminho: string, nome: string) {
  const atual = token.ler()
  const res = await fetch(`/api${caminho}`, { headers: atual ? { Authorization: `Bearer ${atual}` } : {} })
  if (!res.ok) throw new ApiError(res.status, 'Não foi possível baixar o arquivo.')
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  URL.revokeObjectURL(url)
}

export const TAMANHO_MAXIMO_ANEXO = 10 * 1024 * 1024
export const TIPOS_DE_ANEXO = '.pdf,.png,.jpg,.jpeg,.webp,.xml,.txt,.csv,.ofx,.xls,.xlsx,.doc,.docx'

// Conteúdo de um arquivo em base64, para ir dentro do JSON.
export async function lerEmBase64(arquivo: File) {
  if (arquivo.size > TAMANHO_MAXIMO_ANEXO) throw new ApiError(400, `"${arquivo.name}" passa de 10 MB.`)
  return new Promise<string>((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result).split(',')[1] ?? '')
    leitor.onerror = () => reject(new ApiError(0, `Não foi possível ler "${arquivo.name}".`))
    leitor.readAsDataURL(arquivo)
  })
}

// Envia um arquivo como anexo de um registro.
export async function anexar(origem: string, origemId: number, arquivo: File) {
  return api(`/documentos/${origem}/${origemId}`, { body: { nome: arquivo.name, conteudo: await lerEmBase64(arquivo) } })
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : 'Erro inesperado.')

// Carrega uma lista ou recurso e permite recarregar depois de uma alteração.
export function useDados<T>(caminho: string | null) {
  const [dados, setDados] = useState<T | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(caminho !== null)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    if (caminho === null) return
    let ativo = true
    setCarregando(true)
    api<T>(caminho)
      .then((d) => {
        if (!ativo) return
        setDados(d)
        setErro('')
      })
      .catch((e) => ativo && setErro(mensagem(e)))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [caminho, versao])

  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  return { dados, erro, carregando, recarregar }
}

// Executa uma ação de escrita controlando estado de envio e mensagem de erro.
export function useAcao() {
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function executar(acao: () => Promise<void>) {
    setErro('')
    setOcupado(true)
    try {
      await acao()
    } catch (e) {
      setErro(mensagem(e))
    } finally {
      setOcupado(false)
    }
  }
  return { erro, ocupado, executar }
}
