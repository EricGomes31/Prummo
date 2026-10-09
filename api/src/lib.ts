import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { escoparPorEmpresa } from './empresa.js'

// Toda consulta feita por este cliente fica restrita à empresa da requisição (ver empresa.ts).
export const prisma = new PrismaClient().$extends(escoparPorEmpresa)
export type Transacao = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

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

// Data com hora opcional. Só a data ("AAAA-MM-DD") vale como meio-dia, como em `dataIso`; com hora, vem
// do navegador em ISO com o fuso ("2026-10-08T17:30:00.000Z") e é guardada no instante exato.
export const dataHora = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/, 'Data inválida')
  .transform((s) => ({ data: new Date(s.length === 10 ? `${s}T12:00:00` : s), comHora: s.length > 10 }))
  .refine((d) => !Number.isNaN(d.data.getTime()), 'Data inválida')

// CPF ou CNPJ com os dígitos verificadores certos. Pontuação é ignorada.
export function documentoValido(texto: string) {
  const n = texto.replace(/\D/g, '')
  if (!(n.length === 11 || n.length === 14) || /^(\d)\1+$/.test(n)) return false
  const digito = (base: string, pesos: number[]) => {
    const resto = [...base].reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11
    return n.length === 11 ? ((resto * 10) % 11) % 10 : resto < 2 ? 0 : 11 - resto
  }
  if (n.length === 11) {
    const pesos = (inicio: number) => Array.from({ length: inicio - 1 }, (_, i) => inicio - i)
    return digito(n.slice(0, 9), pesos(10)) === Number(n[9]) && digito(n.slice(0, 10), pesos(11)) === Number(n[10])
  }
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  return digito(n.slice(0, 12), p1) === Number(n[12]) && digito(n.slice(0, 13), [6, ...p1]) === Number(n[13])
}

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
