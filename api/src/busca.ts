import { Prisma } from '@prisma/client'
import { empresaDaRequisicao } from './empresa.js'
import { prisma } from './lib.js'

// Busca por texto que ignora acentos e maiúsculas e aceita várias palavras em qualquer ordem:
// "jessica", "Jéssica" e "silva jessica" acham "Jéssica da Silva"; "agua" acha "Água". O "contains"
// do Prisma diferencia acento, por isso a comparação é feita em SQL, com a empresa da requisição.
const COM_ACENTO = 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ'
const SEM_ACENTO = 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
export const simples = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Tabelas e colunas fixas, nunca vindas da requisição.
const ALVOS = {
  pessoas: { tabela: Prisma.raw('"Pessoa"'), colunas: Prisma.raw(`coalesce(nome, '') || ' ' || coalesce("nomeFantasia", '')`) },
  produtos: { tabela: Prisma.raw('"Produto"'), colunas: Prisma.raw(`coalesce(nome, '') || ' ' || coalesce(sku, '') || ' ' || coalesce(ean, '')`) },
}

async function idsPorTexto(alvo: keyof typeof ALVOS, busca: string | undefined): Promise<number[]> {
  const palavras = simples(busca ?? '').split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return []
  const { tabela, colunas } = ALVOS[alvo]
  const texto = Prisma.sql`lower(translate(${colunas}, ${COM_ACENTO}, ${SEM_ACENTO}))`
  // % e _ digitados valem como letras, não como curingas do LIKE.
  const condicoes = palavras.map((p) => Prisma.sql`${texto} LIKE ${`%${semCuringas(p)}%`}`)
  const linhas = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM ${tabela} WHERE "empresaId" = ${empresaDaRequisicao()} AND ${Prisma.join(condicoes, ' AND ')}`
  return linhas.map((l) => l.id)
}

export const pessoasPorNome = (busca: string | undefined) => idsPorTexto('pessoas', busca)
export const produtosPorTexto = (busca: string | undefined) => idsPorTexto('produtos', busca)

// Também para o "contains" do Prisma, que não escapa os curingas: % e _ digitados valem como letras.
export const semCuringas = (busca: string) => busca.replace(/[\\%_]/g, '\\$&')
