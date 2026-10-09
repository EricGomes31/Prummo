// Limite de tentativas de login (src/limite.ts): 5 senhas erradas para o mesmo e-mail, do mesmo IP, bloqueiam
// esse e-mail; 20 falhas do mesmo IP bloqueiam o IP. A senha atual errada na troca de senha também conta.
// Todas as chamadas da suíte vêm do mesmo IP, então as contagens se somam na ordem abaixo.
import { chamar, conferir, encerrar, entrarComoAdmin, SENHA_ADMIN, sessao } from './apoio.mjs'

await entrarComoAdmin()
for (const [nome, email] of [['Zé', 'ze@prumo.local'], ['Ana', 'ana@prumo.local']]) {
  await chamar('POST', '/usuarios', { nome, email, senha: 'senha-12345', perfil: 'OPERADOR' })
}
sessao.token = ''
const entrar = (email, senha) => chamar('POST', '/auth/login', { email, senha })
const errar = async (email, vezes) => {
  const status = []
  for (let n = 0; n < vezes; n++) status.push((await entrar(email, 'senha-errada')).status)
  return status
}

// Falhas do IP até aqui: 0.
const quatro = await errar('ze@prumo.local', 4)
conferir('senha errada -> 401', quatro.every((s) => s === 401), quatro.join())
conferir('abaixo do limite, a senha certa entra', (await entrar('ze@prumo.local', 'senha-12345')).status === 200)

// A entrada certa zerou a contagem do e-mail: são precisas 5 novas falhas para bloquear.
const cinco = await errar('ze@prumo.local', 5)
conferir('cinco senhas erradas seguidas -> 401', cinco.every((s) => s === 401), cinco.join())
const bloqueado = await entrar('ze@prumo.local', 'senha-12345')
conferir('bloqueado, nem a senha certa entra -> 429', bloqueado.status === 429 && bloqueado.json.erro.includes('15 minutos'), JSON.stringify(bloqueado.json))
conferir('e-mail com maiúsculas conta como o mesmo', (await entrar('ZE@Prumo.local', 'senha-12345')).status === 429)

// Falhas do IP: 9. Outra conta, do mesmo IP, continua entrando.
const admin = await entrar('admin@prumo.local', SENHA_ADMIN)
conferir('o bloqueio é só da conta: outra entra', admin.status === 200)

// Troca de senha com a senha atual errada: conta como falha de login da própria conta.
sessao.token = admin.json.token
const trocar = (senhaAtual) => chamar('PUT', '/auth/senha', { senhaAtual, novaSenha: 'senha-nova-123' })
const trocas = []
for (let n = 0; n < 5; n++) trocas.push((await trocar('senha-errada')).status)
conferir('senha atual errada -> 400', trocas.every((s) => s === 400), trocas.join())
conferir('depois de cinco, a troca de senha bloqueia -> 429', (await trocar(SENHA_ADMIN)).status === 429)
sessao.token = ''
conferir('e o login da conta também', (await entrar('admin@prumo.local', SENHA_ADMIN)).status === 429)

// Falhas do IP: 14. Mais 6 com e-mails variados chegam a 20 e bloqueiam o IP para qualquer conta.
for (let n = 0; n < 6; n++) await entrar(`tentativa${n}@prumo.local`, 'senha-errada')
conferir('vinte falhas do mesmo IP bloqueiam o IP -> 429', (await entrar('ana@prumo.local', 'senha-12345')).status === 429)

encerrar()
