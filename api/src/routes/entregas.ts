import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, dataIso, idParam, prisma, texto, type Transacao } from '../lib.js'

const ATIVAS = ['PENDENTE', 'EM_ROTA', 'FALHOU']
const hora = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido')
  .nullish()
  .or(z.literal('').transform(() => null))

const corpo = z.object({
  entregadorId: z.number().int().positive().nullish(),
  dataPrevista: dataIso,
  destinatario: z.string().trim().min(2, 'Informe o destinatário').max(160),
  telefone: texto.opcional,
  cep: texto.opcional,
  logradouro: z.string().trim().min(2, 'Informe o logradouro').max(200),
  numero: texto.opcional,
  complemento: texto.opcional,
  bairro: texto.opcional,
  cidade: z.string().trim().min(2, 'Informe a cidade').max(120),
  uf: texto.opcional,
  observacao: texto.opcional,
  // Dados para a rota, todos opcionais.
  pesoKg: z.number().min(0).max(100_000).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  inicioRecebimento: hora,
  fimRecebimento: hora,
})

const comDetalhes = {
  pedido: { select: { id: true, numero: true, total: true, cliente: { select: { id: true, nome: true } } } },
  entregador: { select: { id: true, nome: true } },
  rota: { select: { id: true, nome: true } },
} as const

type Cliente = Transacao | typeof prisma
// Toda mudança de situação fica no histórico da entrega.
export const registrarHistorico = (
  db: Cliente,
  entregaId: number,
  status: string,
  extra: { observacao?: string | null; usuarioId?: number | null; origem?: 'SISTEMA' | 'ENTREGADOR' } = {},
) => db.entregaHistorico.create({ data: { entregaId, status, observacao: extra.observacao ?? null, usuarioId: extra.usuarioId ?? null, origem: extra.origem ?? 'SISTEMA' } })

// Troca de situação com a situação de origem conferida na própria gravação.
export async function mudarEntrega(
  id: number,
  de: string[],
  data: Record<string, unknown>,
  historico: { observacao?: string | null; usuarioId?: number | null; origem?: 'SISTEMA' | 'ENTREGADOR' },
) {
  const { count } = await prisma.entrega.updateMany({ where: { id, status: { in: de } }, data })
  if (count === 0) throw new AppError(409, 'A entrega não está na situação esperada para esta operação.')
  await registrarHistorico(prisma, id, String(data.status), historico)
  return prisma.entrega.findUniqueOrThrow({ where: { id }, include: comDetalhes })
}

const dadosDaEntrega = (dados: z.infer<typeof corpo>) => ({
  ...dados,
  entregadorId: dados.entregadorId ?? null,
  pesoKg: dados.pesoKg ?? null,
  latitude: dados.latitude ?? null,
  longitude: dados.longitude ?? null,
  inicioRecebimento: dados.inicioRecebimento ?? null,
  fimRecebimento: dados.fimRecebimento ?? null,
})

export async function rotasEntregas(app: FastifyInstance) {
  app.get('/entregas', async (req) => {
    const q = z
      .object({
        status: z.enum(['ATIVAS', 'PENDENTE', 'EM_ROTA', 'ENTREGUE', 'FALHOU', 'CANCELADA']).optional(),
        entregadorId: z.coerce.number().int().positive().optional(),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(req.query)
    const inicio = q.data ? new Date(`${q.data}T00:00:00`) : null
    const fim = inicio ? new Date(inicio.getTime() + 24 * 60 * 60 * 1000) : null
    return prisma.entrega.findMany({
      where: {
        ...(q.status === 'ATIVAS' ? { status: { in: ATIVAS } } : q.status ? { status: q.status } : {}),
        ...(q.entregadorId ? { entregadorId: q.entregadorId } : {}),
        ...(inicio && fim ? { dataPrevista: { gte: inicio, lt: fim } } : {}),
      },
      include: comDetalhes,
      orderBy: [{ dataPrevista: 'asc' }, { id: 'asc' }],
      take: 500,
    })
  })

  // Pedidos faturados que ainda não têm entrega em andamento nem concluída.
  app.get('/entregas/pedidos-disponiveis', async () =>
    prisma.pedido.findMany({
      where: { status: 'FATURADO', natureza: { not: 'PERDA' }, entregas: { none: { status: { not: 'CANCELADA' } } } },
      select: { id: true, numero: true, total: true, faturadoEm: true, cliente: true },
      orderBy: { id: 'desc' },
    }),
  )

  app.get('/entregas/entregadores', async () =>
    prisma.usuario.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
  )

  app.get('/entregas/:id/historico', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.entregaHistorico.findMany({
      where: { entregaId: id },
      include: { usuario: { select: { id: true, nome: true } } },
      orderBy: { id: 'desc' },
    })
  })

  app.post('/entregas', async (req, reply) => {
    const dados = corpo.extend({ pedidoId: z.number().int().positive('Selecione o pedido') }).parse(req.body)
    const entrega = await prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id: dados.pedidoId },
        include: { entregas: { where: { status: { not: 'CANCELADA' } } } },
      })
      if (!pedido) throw new AppError(404, 'Pedido não encontrado.')
      if (pedido.status !== 'FATURADO') throw new AppError(409, 'Só pedidos faturados podem ser entregues.')
      if (pedido.entregas.length > 0) throw new AppError(409, 'Este pedido já tem uma entrega.')
      const criada = await tx.entrega.create({ data: { ...dadosDaEntrega(dados), pedidoId: dados.pedidoId }, include: comDetalhes })
      await registrarHistorico(tx, criada.id, 'PENDENTE', { observacao: 'Entrega programada', usuarioId: req.usuario.id })
      return criada
    })
    return reply.status(201).send(entrega)
  })

  app.put('/entregas/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = corpo.parse(req.body)
    const { count } = await prisma.entrega.updateMany({ where: { id, status: 'PENDENTE' }, data: dadosDaEntrega(dados) })
    if (count === 0) throw new AppError(409, 'Só entregas pendentes podem ser alteradas.')
    return prisma.entrega.findUniqueOrThrow({ where: { id }, include: comDetalhes })
  })

  // Põe a entrega em uma rota, no fim da sequência, ou tira dela. A carga não pode passar da capacidade do veículo.
  app.put('/entregas/:id/rota', async (req) => {
    const { id } = idParam.parse(req.params)
    const { rotaId } = z.object({ rotaId: z.number().int().positive().nullable() }).parse(req.body)
    return prisma.$transaction(async (tx) => {
      const entrega = await tx.entrega.findUnique({ where: { id } })
      if (!entrega) throw new AppError(404, 'Entrega não encontrada.')
      if (entrega.status !== 'PENDENTE') throw new AppError(409, 'Só entregas pendentes podem mudar de rota.')
      if (!rotaId) {
        await registrarHistorico(tx, id, 'PENDENTE', { observacao: 'Retirada da rota', usuarioId: req.usuario.id })
        return tx.entrega.update({ where: { id }, data: { rotaId: null, sequencia: null }, include: comDetalhes })
      }
      const rota = await tx.rota.findUnique({ where: { id: rotaId }, include: { veiculo: true, entregas: { where: { id: { not: id } } } } })
      if (!rota) throw new AppError(404, 'Rota não encontrada.')
      const carga = rota.entregas.reduce((s, e) => s + (e.pesoKg ?? 0), 0) + (entrega.pesoKg ?? 0)
      if (carga > rota.veiculo.capacidadeKg) {
        throw new AppError(400, `A carga da rota passaria para ${carga} kg, acima da capacidade do veículo (${rota.veiculo.capacidadeKg} kg).`)
      }
      const ultima = Math.max(0, ...rota.entregas.map((e) => e.sequencia ?? 0))
      await registrarHistorico(tx, id, 'PENDENTE', { observacao: `Incluída na rota "${rota.nome}"`, usuarioId: req.usuario.id })
      return tx.entrega.update({ where: { id }, data: { rotaId, sequencia: ultima + 1 }, include: comDetalhes })
    })
  })

  app.post('/entregas/:id/sair', async (req) => {
    const { id } = idParam.parse(req.params)
    const atual = await prisma.entrega.findUnique({ where: { id }, select: { entregadorId: true } })
    if (!atual) throw new AppError(404, 'Entrega não encontrada.')
    // Sem entregador definido, quem registra a saída assume a entrega.
    return mudarEntrega(
      id,
      ['PENDENTE'],
      { status: 'EM_ROTA', saiuEm: new Date(), entregadorId: atual.entregadorId ?? req.usuario.id },
      { usuarioId: req.usuario.id },
    )
  })

  app.post('/entregas/:id/concluir', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = z.object({ recebedor: z.string().trim().min(2, 'Informe quem recebeu').max(160) }).parse(req.body)
    return mudarEntrega(
      id,
      ['EM_ROTA'],
      { status: 'ENTREGUE', concluidaEm: new Date(), recebedor: dados.recebedor },
      { observacao: `Recebido por ${dados.recebedor}`, usuarioId: req.usuario.id },
    )
  })

  app.post('/entregas/:id/falhar', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = z.object({ motivo: z.string().trim().min(2, 'Informe o motivo').max(200) }).parse(req.body)
    return mudarEntrega(
      id,
      ['EM_ROTA'],
      { status: 'FALHOU', concluidaEm: new Date(), motivoFalha: dados.motivo },
      { observacao: dados.motivo, usuarioId: req.usuario.id },
    )
  })

  app.post('/entregas/:id/reprogramar', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = z.object({ dataPrevista: dataIso }).parse(req.body)
    // A entrega reprogramada sai da rota antiga; a nova data pede uma rota nova.
    return mudarEntrega(
      id,
      ['FALHOU'],
      { status: 'PENDENTE', dataPrevista: dados.dataPrevista, saiuEm: null, concluidaEm: null, rotaId: null, sequencia: null },
      { observacao: 'Reprogramada', usuarioId: req.usuario.id },
    )
  })

  app.post('/entregas/:id/cancelar', async (req) => {
    const { id } = idParam.parse(req.params)
    return mudarEntrega(id, ['PENDENTE', 'FALHOU'], { status: 'CANCELADA', rotaId: null, sequencia: null }, { usuarioId: req.usuario.id })
  })
}
