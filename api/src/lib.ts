import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

export const prisma = new PrismaClient()

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const idParam = z.object({ id: z.coerce.number().int().positive() })

const textoOpcional = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => v || null)

export const texto = { opcional: textoOpcional }

export const centavos = z.number().int().min(0)

// Datas chegam como "AAAA-MM-DD"; fixar ao meio-dia evita que o fuso mude o dia.
export const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .transform((s) => new Date(`${s}T12:00:00`))

export function inicioDeHoje() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function somarMeses(data: Date, meses: number) {
  const d = new Date(data)
  const dia = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + meses)
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(dia, ultimoDia))
  return d
}

const mdc = (a: number, b: number): number => (b === 0 ? a : mdc(b, a % b))
export const mmc = (a: number, b: number) => (a / mdc(a, b)) * b

// Quantidade para mensagens: até três casas, sem zeros à direita.
export const quantidadeTexto = (n: number) => Number(n.toFixed(3)).toLocaleString('pt-BR')
