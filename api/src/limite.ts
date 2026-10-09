// Limite de tentativas. Quem erra muitas vezes seguidas fica bloqueado por um tempo, para ninguém ficar
// testando chaves de link ou senhas. Os contadores ficam em memória: valem enquanto a API estiver no ar.
import type { FastifyRequest } from 'fastify'
import { AppError } from './lib.js'

const JANELA = 15 * 60 * 1000

// Um contador de falhas por chave (IP, IP + e-mail...). Bloqueia ao chegar a `maximo` falhas dentro da janela.
function criarLimite(maximo: number, mensagem: string) {
  const falhas = new Map<string, { quantidade: number; desde: number }>()
  return {
    conferir(chave: string) {
      const f = falhas.get(chave)
      if (f && Date.now() - f.desde < JANELA && f.quantidade >= maximo) throw new AppError(429, mensagem)
    },
    falhou(chave: string) {
      const atual = falhas.get(chave)
      const vencida = !atual || Date.now() - atual.desde >= JANELA
      falhas.set(chave, vencida ? { quantidade: 1, desde: Date.now() } : { ...atual, quantidade: atual.quantidade + 1 })
      // Limpeza das janelas vencidas, para o mapa não crescer sem limite.
      if (falhas.size > 10_000) for (const [k, v] of falhas) if (Date.now() - v.desde >= JANELA) falhas.delete(k)
    },
    limpar(chave: string) {
      falhas.delete(chave)
    },
  }
}

// Links públicos (entregador e cadastro do cliente): a chave do link é longa demais para ser adivinhada,
// mas 10 chaves erradas do mesmo IP bloqueiam por 15 minutos.
const links = criarLimite(10, 'Muitas tentativas com um link inválido. Aguarde 15 minutos e tente de novo.')
export const conferirTentativas = (req: FastifyRequest) => links.conferir(req.ip)
export const registrarFalha = (req: FastifyRequest) => links.falhou(req.ip)

// Login: 5 senhas erradas para o mesmo e-mail, vindas do mesmo IP, bloqueiam esse e-mail nesse IP; 20 falhas
// do mesmo IP, com quaisquer e-mails, bloqueiam o IP. Não há bloqueio só pelo e-mail, que deixaria qualquer
// um trancar a conta de outra pessoa de propósito. Entrar com a senha certa zera a contagem do e-mail.
const MENSAGEM_LOGIN = 'Muitas tentativas de entrar. Aguarde 15 minutos e tente de novo.'
const loginConta = criarLimite(5, MENSAGEM_LOGIN)
const loginIp = criarLimite(20, MENSAGEM_LOGIN)
const contaNoIp = (req: FastifyRequest, email: string) => `${req.ip}|${email}`

export function conferirLogin(req: FastifyRequest, email: string) {
  loginIp.conferir(req.ip)
  loginConta.conferir(contaNoIp(req, email))
}

export function registrarFalhaDeLogin(req: FastifyRequest, email: string) {
  loginIp.falhou(req.ip)
  loginConta.falhou(contaNoIp(req, email))
}

export const registrarLogin = (req: FastifyRequest, email: string) => loginConta.limpar(contaNoIp(req, email))
