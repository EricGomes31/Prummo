import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, idParam, prisma } from '../lib.js'

const PASTA = path.resolve(process.env.UPLOADS_DIR ?? 'uploads')
const TAMANHO_MAXIMO = 10 * 1024 * 1024

// Só estes tipos são aceitos. O tipo devolvido no download vem daqui, nunca do que o navegador informou.
const TIPOS: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  xml: 'application/xml',
  txt: 'text/plain',
  csv: 'text/csv',
  ofx: 'application/x-ofx',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const extensao = (nome: string) => nome.slice(nome.lastIndexOf('.') + 1).toLowerCase()

// Cada origem sabe conferir se o registro dono do anexo existe.
const ORIGENS: Record<string, (id: number) => Promise<unknown>> = {
  ENTRADA_ESTOQUE: (id) => prisma.entradaEstoque.findUnique({ where: { id }, select: { id: true } }),
  PEDIDO: (id) => prisma.pedido.findUnique({ where: { id }, select: { id: true } }),
  CONTA_PAGAR: (id) => prisma.contaPagar.findUnique({ where: { id }, select: { id: true } }),
  CONTA_RECEBER: (id) => prisma.contaReceber.findUnique({ where: { id }, select: { id: true } }),
  DESPESA: (id) => prisma.despesa.findUnique({ where: { id }, select: { id: true } }),
  ENTREGA: (id) => prisma.entrega.findUnique({ where: { id }, select: { id: true } }),
}

const dono = z.object({
  origem: z.string().refine((o) => o in ORIGENS, 'Origem de documento desconhecida'),
  origemId: z.coerce.number().int().positive(),
})

export const publico = { id: true, origem: true, origemId: true, nome: true, tamanho: true, criadoEm: true } as const

export const arquivoEnviado = z.object({
  nome: z
    .string()
    // Fica só o nome do arquivo, sem caminho nem caracteres de controle.
    .transform((n) => path.basename(n.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .pipe(z.string().min(1, 'Informe o nome do arquivo').max(200)),
  conteudo: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Conteúdo do arquivo inválido'),
})

export const LIMITE_DO_CORPO = Math.ceil(TAMANHO_MAXIMO * 1.4)

// Grava o arquivo em disco e o registro do anexo. `tipos` restringe as extensões aceitas.
export async function gravarDocumento(origem: string, origemId: number, dados: z.infer<typeof arquivoEnviado>, tipos = Object.keys(TIPOS)) {
  if (!tipos.includes(extensao(dados.nome))) {
    throw new AppError(400, `Tipo de arquivo não aceito. Use: ${tipos.join(', ')}.`)
  }
  const bytes = Buffer.from(dados.conteudo, 'base64')
  if (bytes.length === 0) throw new AppError(400, 'O arquivo está vazio.')
  if (bytes.length > TAMANHO_MAXIMO) throw new AppError(400, 'O arquivo passa de 10 MB.')

  const arquivo = randomUUID()
  await mkdir(PASTA, { recursive: true })
  await writeFile(path.join(PASTA, arquivo), bytes)
  return prisma.documento
    .create({ data: { origem, origemId, nome: dados.nome, tamanho: bytes.length, arquivo }, select: publico })
    .catch(async (erro) => {
      await unlink(path.join(PASTA, arquivo)).catch(() => {})
      throw erro
    })
}

export async function rotasDocumentos(app: FastifyInstance) {
  app.get('/documentos/:origem/:origemId', async (req) => {
    const { origem, origemId } = dono.parse(req.params)
    return prisma.documento.findMany({ where: { origem, origemId }, select: publico, orderBy: { id: 'asc' } })
  })

  // O arquivo vem em base64 dentro do JSON; o limite do corpo cobre o tamanho máximo mais a codificação.
  app.post('/documentos/:origem/:origemId', { bodyLimit: LIMITE_DO_CORPO }, async (req, reply) => {
    const { origem, origemId } = dono.parse(req.params)
    const dados = arquivoEnviado.parse(req.body)
    if (!(await ORIGENS[origem](origemId))) throw new AppError(404, 'Registro de origem não encontrado.')
    return reply.status(201).send(await gravarDocumento(origem, origemId, dados))
  })

  app.get('/documentos/arquivo/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const documento = await prisma.documento.findUnique({ where: { id } })
    if (!documento) throw new AppError(404, 'Documento não encontrado.')
    return reply
      .header('Content-Type', TIPOS[extensao(documento.nome)] ?? 'application/octet-stream')
      // Sempre como download, para o navegador nunca abrir o anexo como página do sistema.
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(documento.nome)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(createReadStream(path.join(PASTA, documento.arquivo)))
  })

  app.delete('/documentos/arquivo/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const documento = await prisma.documento.delete({ where: { id } })
    await unlink(path.join(PASTA, documento.arquivo)).catch(() => {})
    return reply.status(204).send()
  })
}
