// Limite de tentativas nos links públicos (entregador e cadastro do cliente). A chave do link é longa
// demais para ser adivinhada, mas quem erra muitas vezes seguidas fica bloqueado por um tempo, para
// ninguém ficar testando chaves. Os contadores ficam em memória: valem enquanto a API estiver no ar.
import type { FastifyRequest } from 'fastify'
import { AppError } from './lib.js'

const JANELA = 15 * 60 * 1000
const MAXIMO = 10
const falhas = new Map<string, { quantidade: number; desde: number }>()

const chaveDe = (req: FastifyRequest) => req.ip

export function conferirTentativas(req: FastifyRequest) {
  const f = falhas.get(chaveDe(req))
  if (f && Date.now() - f.desde < JANELA && f.quantidade >= MAXIMO) {
    throw new AppError(429, 'Muitas tentativas com um link inválido. Aguarde 15 minutos e tente de novo.')
  }
}

export function registrarFalha(req: FastifyRequest) {
  const chave = chaveDe(req)
  const atual = falhas.get(chave)
  const vencida = !atual || Date.now() - atual.desde >= JANELA
  falhas.set(chave, vencida ? { quantidade: 1, desde: Date.now() } : { ...atual, quantidade: atual.quantidade + 1 })
  // Limpeza das janelas vencidas, para o mapa não crescer sem limite.
  if (falhas.size > 10_000) for (const [k, v] of falhas) if (Date.now() - v.desde >= JANELA) falhas.delete(k)
}
