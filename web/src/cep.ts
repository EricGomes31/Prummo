// Endereço a partir do CEP, pelo serviço público ViaCEP. Devolve null se o CEP não existir ou se o
// serviço não responder: aí o endereço é preenchido à mão.
export async function consultarCep(cep: string | null | undefined) {
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
