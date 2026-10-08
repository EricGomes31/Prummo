// Baixa uma lista do SG Nexus usando a sessão aberta em uma janela do Chrome com depuração ligada.
// A chamada é feita dentro da própria página (GET, somente leitura); o token não sai do navegador.
//
// Uso: node scripts/sgnexus/baixar.mjs <arquivo de saída.json> <caminho>
// Caminhos usados na migração: /pessoas, /produtos, /pedidos, /contas-receber,
// /infinity/entregas, /infinity/motoristas, /infinity/veiculos, /perfis-acesso
//
// Antes, abra o Chrome com um perfil separado e a porta de depuração, e faça o login no SG Nexus nele:
//   chrome.exe --remote-debugging-port=9222 --user-data-dir=<pasta vazia> https://infinitylabs.sgnexus.com.br/
import { writeFileSync } from 'node:fs'

const [saida, caminho = '/pessoas'] = process.argv.slice(2)
const alvos = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const alvo = alvos.find((a) => a.type === 'page' && a.url.startsWith('https://infinitylabs.sgnexus.com.br'))
if (!alvo) throw new Error('Aba do SG Nexus não encontrada.')

const ws = new WebSocket(alvo.webSocketDebuggerUrl)
await new Promise((ok, erro) => {
  ws.onopen = ok
  ws.onerror = erro
})

const expressao = `(async () => {
  const token = localStorage.getItem('infinityLabsToken') || localStorage.getItem('sgNexusToken')
  if (!token) return JSON.stringify({ erro: 'sem token: faça o login nesta janela' })
  const r = await fetch('https://sg-nexus-infinitylabs-api.onrender.com' + ${JSON.stringify(caminho)}, { headers: { Authorization: 'Bearer ' + token } })
  return JSON.stringify({ status: r.status, corpo: await r.text() })
})()`

const resposta = await new Promise((ok) => {
  ws.onmessage = (m) => {
    const dados = JSON.parse(m.data)
    if (dados.id === 1) ok(dados)
  }
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expressao, awaitPromise: true, returnByValue: true } }))
})
ws.close()

const r = JSON.parse(resposta.result.result.value)
if (r.erro || r.status !== 200) {
  console.log('falhou:', r.erro ?? `HTTP ${r.status} ${r.corpo.slice(0, 200)}`)
  process.exit(1)
}
writeFileSync(saida, r.corpo)
const lista = JSON.parse(r.corpo)
console.log('registros:', Array.isArray(lista) ? lista.length : 1)
if (Array.isArray(lista) && lista.length) console.log('campos:', Object.keys(lista[0]).join(', '))
