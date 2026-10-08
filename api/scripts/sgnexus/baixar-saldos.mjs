// Baixa o saldo de estoque de cada produto do SG Nexus pela sessão aberta na janela de depuração (somente leitura).
// Uso: node scripts/sgnexus/baixar-saldos.mjs <produtos.json baixado> <arquivo de saída.json>
// Precisa da mesma janela do Chrome descrita em baixar.mjs.
import { readFileSync, writeFileSync } from 'node:fs'

const [arquivoProdutos, saida] = process.argv.slice(2)
const ids = JSON.parse(readFileSync(arquivoProdutos, 'utf8')).map((p) => p.id)
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
  const saldos = {}
  for (const id of ${JSON.stringify(ids)}) {
    const r = await fetch('https://sg-nexus-infinitylabs-api.onrender.com/estoque/saldo/' + id, { headers: { Authorization: 'Bearer ' + token } })
    saldos[id] = r.ok ? await r.text() : 'HTTP ' + r.status
  }
  return JSON.stringify(saldos)
})()`

const resposta = await new Promise((ok) => {
  ws.onmessage = (m) => {
    const dados = JSON.parse(m.data)
    if (dados.id === 1) ok(dados)
  }
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expressao, awaitPromise: true, returnByValue: true } }))
})
ws.close()

writeFileSync(saida, resposta.result.result.value)
console.log(resposta.result.result.value)
