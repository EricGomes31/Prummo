// Lista as rotas da API que não estão no mapa de permissões (REGRAS em api/src/permissoes.ts).
// Rota fora do mapa vale para qualquer usuário logado — o que é certo para login, sessão, links públicos
// e /sistema (que confere req.usuario.sistema), e um furo para qualquer rota que leia ou grave dados.
// Uso, da raiz do projeto: node .claude/skills/seguranca-prumo/scripts/rotas-sem-regra.mjs
import { readFileSync, readdirSync } from 'node:fs'

const permissoes = readFileSync('api/src/permissoes.ts', 'utf8')
const regras = new Set([...permissoes.matchAll(/'((GET|POST|PUT|PATCH|DELETE) [^']+)'\s*:/g)].map((m) => m[1]))
const rotas = []
for (const arquivo of readdirSync('api/src/routes')) {
  const texto = readFileSync(`api/src/routes/${arquivo}`, 'utf8')
  for (const m of texto.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) rotas.push([arquivo, `${m[1].toUpperCase()} ${m[2]}`])
}
const fora = rotas.filter(([, rota]) => !regras.has(rota))
console.log(`${rotas.length} rotas, ${rotas.length - fora.length} com regra de permissão. Sem regra:`)
for (const [arquivo, rota] of fora) console.log(`  ${rota.padEnd(60)} ${arquivo}`)
