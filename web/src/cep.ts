import { useRef, type FocusEvent } from 'react'

type EnderecoDoCep = { logradouro: string; bairro: string; cidade: string; uf: string }

// Endereço a partir do CEP, pelo serviço público ViaCEP. Devolve null se o CEP não existir ou se o
// serviço não responder: aí o endereço é preenchido à mão.
export async function consultarCep(cep: string | null | undefined): Promise<EnderecoDoCep | null> {
  const digitos = (cep ?? '').replace(/\D/g, '')
  if (digitos.length !== 8) return null
  try {
    const r = await fetch(`https://viacep.com.br/ws/${digitos}/json/`).then((res) => res.json())
    if (r.erro) return null
    return { logradouro: r.logradouro as string, bairro: r.bairro as string, cidade: r.localidade as string, uf: r.uf as string }
  } catch {
    return null
  }
}

// Endereço com o que veio do CEP. Rua e bairro do CEP substituem os anteriores (o CEP mudou, a rua
// também); CEP de cidade inteira vem sem rua e bairro, e aí fica o que já estava digitado.
export function comEnderecoDoCep<T extends { logradouro?: string | null; bairro?: string | null }>(atual: T, achado: EnderecoDoCep): T {
  return { ...atual, logradouro: achado.logradouro || atual.logradouro, bairro: achado.bairro || atual.bairro, cidade: achado.cidade, uf: achado.uf }
}

// onFocus e onBlur do campo CEP: ao sair do campo com o CEP diferente do que tinha ao entrar, busca o
// endereço. Passar pelo campo sem mudar o CEP não mexe no endereço já digitado.
export function useBuscaCep(aoAchar: (achado: EnderecoDoCep) => void) {
  const aoEntrar = useRef('')
  const digitos = (valor: string) => valor.replace(/\D/g, '')
  return {
    onFocus: (e: FocusEvent<HTMLInputElement>) => {
      aoEntrar.current = digitos(e.target.value)
    },
    onBlur: async (e: FocusEvent<HTMLInputElement>) => {
      const cep = digitos(e.target.value)
      if (cep === aoEntrar.current) return
      aoEntrar.current = cep
      const achado = await consultarCep(cep)
      if (achado) aoAchar(achado)
    },
  }
}
