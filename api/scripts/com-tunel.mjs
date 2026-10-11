// Roda um comando com o banco real (PostgreSQL da VPS, que só aceita conexões de dentro do servidor) acessível
// nesta máquina em 127.0.0.1:15433, por um túnel SSH com a chave ~/.ssh/prumo_vps. O túnel fecha ao terminar.
// Uso: node scripts/com-tunel.mjs <comando> [argumentos]   (ou: npm run vps -- <comando> [argumentos])
//   ex.: npm run vps -- node --env-file=.env.producao scripts/copiar-banco.mjs
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'

const PORTA_TUNEL = 15433
const SERVIDOR = process.env.SERVIDOR ?? 'root@179.236.68.14'
const CHAVE = process.env.CHAVE ?? path.join(homedir(), '.ssh', 'prumo_vps')

const [comando, ...argumentos] = process.argv.slice(2)
if (!comando) {
  console.error('Informe o comando a rodar com o túnel. Ex.: node scripts/com-tunel.mjs node --env-file=.env.producao scripts/copiar-banco.mjs')
  process.exit(1)
}

const porta_aberta = () =>
  new Promise((ok) => {
    const s = connect(PORTA_TUNEL, '127.0.0.1')
    s.once('connect', () => (s.destroy(), ok(true)))
    s.once('error', () => ok(false))
  })

if (await porta_aberta()) {
  console.error(`A porta ${PORTA_TUNEL} já está em uso (outro túnel aberto?). Feche-o antes.`)
  process.exit(1)
}

const tunel = spawn(
  'ssh',
  ['-i', CHAVE, '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-N', '-L', `${PORTA_TUNEL}:127.0.0.1:5432`, SERVIDOR],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)
let tunel_saiu = false
tunel.once('exit', () => (tunel_saiu = true))

for (let i = 0; i < 50 && !tunel_saiu && !(await porta_aberta()); i++) await new Promise((r) => setTimeout(r, 200))
if (tunel_saiu || !(await porta_aberta())) {
  console.error('Não foi possível abrir o túnel para a VPS.')
  tunel.kill()
  process.exit(1)
}

const filho = spawn(comando, argumentos, { stdio: 'inherit', shell: process.platform === 'win32' })
filho.once('exit', (codigo) => {
  tunel.kill()
  process.exit(codigo ?? 1)
})
