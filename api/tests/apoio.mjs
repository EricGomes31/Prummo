// Apoio comum às suítes: chamadas à API de teste e contagem das verificações.
// As suítes só rodam pelo `npm test`, que sobe um PostgreSQL e uma API descartáveis e passa o endereço aqui.

export const BASE = process.env.TESTE_API ?? ''
export const SENHA_ADMIN = process.env.TESTE_SENHA_ADMIN ?? ''

// As suítes criam, alteram e cancelam registros. Só aceitam a API local levantada pelo executor,
// para nunca rodarem por engano contra o banco de verdade.
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE) || !SENHA_ADMIN) {
  console.error('Esta suíte só roda pelo executor de testes: use "npm test" na pasta api.')
  process.exit(2)
}

// Token usado nas chamadas; as suítes trocam de usuário alterando este valor.
export const sessao = { token: '' }

let total = 0
let falhas = 0

export async function chamar(method, caminho, body) {
  const res = await fetch(BASE + caminho, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(sessao.token ? { Authorization: `Bearer ${sessao.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const texto = await res.text()
  let json = null
  try {
    json = texto ? JSON.parse(texto) : null
  } catch {
    json = { bruto: texto }
  }
  return { status: res.status, json }
}

export function conferir(nome, ok, extra = '') {
  total++
  if (!ok) falhas++
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${nome}${extra && !ok ? `  [${extra}]` : ''}`)
}

export async function entrarComoAdmin() {
  sessao.token = (await chamar('POST', '/auth/login', { email: 'admin@prumo.local', senha: SENHA_ADMIN })).json.token
}

// Fecha a suíte: a última linha é lida pelo executor para montar o resumo.
export function encerrar() {
  console.log(`RESULTADO ${total - falhas}/${total}`)
  process.exit(falhas ? 1 : 0)
}
