import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { definirEmpresa, semEmpresa } from '../empresa.js'
import { AppError, dataIso, idParam, prisma, texto } from '../lib.js'
import { conferirTentativas, registrarFalha } from '../limite.js'
import { arquivoEnviado, gravarDocumento, LIMITE_DO_CORPO } from './documentos.js'
import { mudarEntrega } from './entregas.js'

const corpoMotorista = z.object({
  nome: z.string().trim().min(2, 'Informe o nome').max(120),
  telefone: texto.opcional,
  cnh: texto.opcional,
  validadeCnh: dataIso.nullish().or(z.literal('').transform(() => null)),
  ativo: z.boolean().default(true),
})

const corpoVeiculo = z.object({
  placa: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{5,8}$/, 'Informe a placa'),
  descricao: texto.opcional,
  capacidadeKg: z.number().positive('Informe a capacidade em kg').max(100_000),
  ativo: z.boolean().default(true),
})

const corpoRota = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da rota').max(120),
  data: dataIso,
  motoristaId: z.number().int().positive('Selecione o motorista'),
  veiculoId: z.number().int().positive('Selecione o veículo'),
  pontoSaida: z.string().trim().min(2, 'Informe o endereço de saída').max(200),
  latitudeSaida: z.number().min(-90).max(90).nullish(),
  longitudeSaida: z.number().min(-180).max(180).nullish(),
})

const comDetalhes = {
  motorista: { select: { id: true, nome: true } },
  veiculo: { select: { id: true, placa: true, descricao: true, capacidadeKg: true } },
  entregas: {
    where: { status: { not: 'CANCELADA' } },
    orderBy: [{ sequencia: 'asc' }, { id: 'asc' }],
    select: {
      id: true, pedidoId: true, sequencia: true, status: true, destinatario: true, logradouro: true, numero: true, bairro: true,
      cidade: true, uf: true, pesoKg: true, latitude: true, longitude: true, inicioRecebimento: true, fimRecebimento: true,
    },
  },
} satisfies Prisma.RotaInclude

// A chave do link nunca volta da API: a rota só diz se há link e até quando vale.
const paraResposta = <R extends { linkHash: string | null; linkExpiraEm: Date | null; entregas: { pesoKg: number | null }[] }>({ linkHash, ...rota }: R) => ({
  ...rota,
  linkAtivo: !!linkHash && !!rota.linkExpiraEm && rota.linkExpiraEm > new Date(),
  cargaKg: rota.entregas.reduce((s, e) => s + (e.pesoKg ?? 0), 0),
})

const hashDaChave = (chave: string) => createHash('sha256').update(chave).digest('hex')

// Distância em linha reta entre dois pontos, em km (fórmula de haversine).
function distanciaKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLon = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

async function conferirMotoristaEVeiculo(dados: z.infer<typeof corpoRota>) {
  const [motorista, veiculo] = await Promise.all([
    prisma.motorista.findUnique({ where: { id: dados.motoristaId } }),
    prisma.veiculo.findUnique({ where: { id: dados.veiculoId } }),
  ])
  if (!motorista?.ativo) throw new AppError(400, 'Selecione um motorista ativo.')
  if (!veiculo?.ativo) throw new AppError(400, 'Selecione um veículo ativo.')
}

export async function rotasLogistica(app: FastifyInstance) {
  app.get('/motoristas', async () => prisma.motorista.findMany({ orderBy: { nome: 'asc' } }))
  app.post('/motoristas', async (req, reply) => reply.status(201).send(await prisma.motorista.create({ data: corpoMotorista.parse(req.body) })))
  app.put('/motoristas/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.motorista.update({ where: { id }, data: corpoMotorista.parse(req.body) })
  })

  app.get('/veiculos', async () => prisma.veiculo.findMany({ orderBy: { placa: 'asc' } }))
  app.post('/veiculos', async (req, reply) => reply.status(201).send(await prisma.veiculo.create({ data: corpoVeiculo.parse(req.body) })))
  app.put('/veiculos/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.veiculo.update({ where: { id }, data: corpoVeiculo.parse(req.body) })
  })

  app.get('/rotas', async () =>
    (await prisma.rota.findMany({ include: comDetalhes, orderBy: [{ data: 'desc' }, { id: 'desc' }], take: 200 })).map(paraResposta),
  )

  app.post('/rotas', async (req, reply) => {
    const dados = corpoRota.parse(req.body)
    await conferirMotoristaEVeiculo(dados)
    return reply.status(201).send(paraResposta(await prisma.rota.create({ data: dados, include: comDetalhes })))
  })

  app.put('/rotas/:id', async (req) => {
    const { id } = idParam.parse(req.params)
    const dados = corpoRota.parse(req.body)
    await conferirMotoristaEVeiculo(dados)
    return paraResposta(await prisma.rota.update({ where: { id }, data: dados, include: comDetalhes }))
  })

  // Grava a ordem das paradas. A lista precisa ter exatamente as entregas da rota.
  app.put('/rotas/:id/sequencia', async (req) => {
    const { id } = idParam.parse(req.params)
    const { entregaIds } = z.object({ entregaIds: z.array(z.number().int().positive()) }).parse(req.body)
    return prisma.$transaction(async (tx) => {
      const rota = await tx.rota.findUnique({ where: { id }, include: comDetalhes })
      if (!rota) throw new AppError(404, 'Rota não encontrada.')
      const daRota = rota.entregas.map((e) => e.id).sort((a, b) => a - b)
      if ([...new Set(entregaIds)].sort((a, b) => a - b).join() !== daRota.join()) {
        throw new AppError(400, 'A sequência precisa conter todas as entregas da rota, uma vez cada.')
      }
      for (const [i, entregaId] of entregaIds.entries()) await tx.entrega.update({ where: { id: entregaId }, data: { sequencia: i + 1 } })
      return paraResposta(await tx.rota.findUniqueOrThrow({ where: { id }, include: comDetalhes }))
    })
  })

  // Ordena as paradas pela mais próxima em linha reta, a partir da saída. Não considera vias nem trânsito.
  // Entregas sem coordenadas ficam no fim, na ordem em que estavam.
  app.post('/rotas/:id/organizar', async (req) => {
    const { id } = idParam.parse(req.params)
    return prisma.$transaction(async (tx) => {
      const rota = await tx.rota.findUnique({ where: { id }, include: comDetalhes })
      if (!rota) throw new AppError(404, 'Rota não encontrada.')
      const comPonto = rota.entregas.filter((e): e is typeof e & { latitude: number; longitude: number } => e.latitude !== null && e.longitude !== null)
      const semPonto = rota.entregas.filter((e) => e.latitude === null || e.longitude === null)
      if (comPonto.length < 2) throw new AppError(400, 'Informe latitude e longitude em pelo menos duas entregas para organizar a rota.')

      const restantes = [...comPonto]
      const ordem: typeof comPonto = []
      let atual =
        rota.latitudeSaida !== null && rota.longitudeSaida !== null
          ? { latitude: rota.latitudeSaida, longitude: rota.longitudeSaida }
          : restantes[0]
      while (restantes.length > 0) {
        restantes.sort((a, b) => distanciaKm(atual, a) - distanciaKm(atual, b))
        atual = restantes.shift()!
        ordem.push(atual as (typeof comPonto)[number])
      }
      for (const [i, e] of [...ordem, ...semPonto].entries()) await tx.entrega.update({ where: { id: e.id }, data: { sequencia: i + 1 } })
      return paraResposta(await tx.rota.findUniqueOrThrow({ where: { id }, include: comDetalhes }))
    })
  })

  // Gera o link do entregador. A chave só aparece nesta resposta; gerar de novo invalida a anterior.
  app.post('/rotas/:id/link', async (req) => {
    const { id } = idParam.parse(req.params)
    const { horas } = z.object({ horas: z.number().int().min(1, 'A validade vai de 1 a 168 horas').max(168, 'A validade vai de 1 a 168 horas').default(24) }).parse(req.body ?? {})
    const chave = randomBytes(24).toString('base64url')
    const expiraEm = new Date(Date.now() + horas * 60 * 60 * 1000)
    // Um link novo começa sem acessos.
    await prisma.rota.update({
      where: { id },
      data: { linkHash: hashDaChave(chave), linkExpiraEm: expiraEm, linkAbertoEm: null, linkUltimoAcesso: null, linkAcessos: 0 },
    })
    return { chave, expiraEm }
  })

  app.delete('/rotas/:id/link', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    await prisma.rota.update({ where: { id }, data: { linkHash: null, linkExpiraEm: null } })
    return reply.status(204).send()
  })
}

// Rotas públicas do entregador: valem só com a chave do link, enviada no cabeçalho X-Rota-Token.
export async function rotasEntregador(app: FastifyInstance) {
  // Confere a chave do link. Quem erra muitas vezes fica bloqueado por um tempo (ver limite.ts).
  // Cada acesso válido fica registrado na rota, para a empresa saber que o entregador abriu o link.
  async function rotaDoLink(req: FastifyRequest) {
    conferirTentativas(req)
    const { id } = idParam.parse(req.params)
    const chave = String(req.headers['x-rota-token'] ?? '')
    // O entregador não tem usuário: a empresa vem da própria rota, depois de conferida a chave.
    const rota = await semEmpresa(async () => await prisma.rota.findUnique({ where: { id } }))
    const recebido = Buffer.from(hashDaChave(chave))
    const esperado = Buffer.from(rota?.linkHash ?? hashDaChave(''))
    const confere = !!rota?.linkHash && !!chave && timingSafeEqual(recebido, esperado)
    if (!rota || !confere || !rota.linkExpiraEm || rota.linkExpiraEm <= new Date()) {
      registrarFalha(req)
      throw new AppError(401, 'Link indisponível ou expirado.')
    }
    definirEmpresa(rota.empresaId)
    const agora = new Date()
    await prisma.rota.update({
      where: { id },
      data: { linkAbertoEm: rota.linkAbertoEm ?? agora, linkUltimoAcesso: agora, linkAcessos: { increment: 1 } },
    })
    return rota
  }

  // O entregador vê só o que precisa para entregar: destino, contato, itens e o valor do pedido.
  async function paraOEntregador(rota: { id: number; nome: string; data: Date; pontoSaida: string; linkExpiraEm: Date | null }) {
    const entregas = await prisma.entrega.findMany({
      where: { rotaId: rota.id, status: { not: 'CANCELADA' } },
      orderBy: [{ sequencia: 'asc' }, { id: 'asc' }],
      include: {
        pedido: {
          select: {
            total: true,
            formaPagamento: true,
            observacao: true,
            itens: { select: { quantidade: true, unidade: true, produto: { select: { nome: true, unidade: true } } } },
          },
        },
      },
    })
    const documentos = await prisma.documento.findMany({
      where: { origem: 'ENTREGA', origemId: { in: entregas.map((e) => e.id) } },
      select: { id: true, origemId: true, nome: true, criadoEm: true },
      orderBy: { id: 'asc' },
    })
    return {
      id: rota.id,
      nome: rota.nome,
      data: rota.data,
      pontoSaida: rota.pontoSaida,
      expiraEm: rota.linkExpiraEm,
      entregas: entregas.map((e) => ({
        id: e.id,
        pedidoId: e.pedidoId,
        status: e.status,
        destinatario: e.destinatario,
        telefone: e.telefone,
        endereco: [[e.logradouro, e.numero].filter(Boolean).join(', '), e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join('/'), e.cep]
          .filter(Boolean)
          .join(' · '),
        inicioRecebimento: e.inicioRecebimento,
        fimRecebimento: e.fimRecebimento,
        observacaoEntrega: e.observacao,
        observacaoVenda: e.pedido.observacao,
        recebedor: e.recebedor,
        motivoFalha: e.motivoFalha,
        valorPedido: e.pedido.total,
        pagamento: e.pedido.formaPagamento,
        itens: e.pedido.itens.map((i) => ({ quantidade: i.quantidade, unidade: i.unidade ?? i.produto.unidade, produto: i.produto.nome })),
        // O entregador vê só o nome dos comprovantes que já enviou, não o conteúdo.
        documentos: documentos.filter((d) => d.origemId === e.id).map((d) => ({ id: d.id, nome: d.nome, criadoEm: d.criadoEm })),
      })),
    }
  }

  app.get('/entregador/rotas/:id', async (req) => paraOEntregador(await rotaDoLink(req)))

  // O entregador anexa a foto da entrega ou do comprovante assinado. Só imagem ou PDF.
  app.post('/entregador/rotas/:id/entregas/:entregaId/documentos', { bodyLimit: LIMITE_DO_CORPO }, async (req, reply) => {
    const rota = await rotaDoLink(req)
    const { entregaId } = z.object({ entregaId: z.coerce.number().int().positive() }).parse(req.params)
    const entrega = await prisma.entrega.findFirst({ where: { id: entregaId, rotaId: rota.id, status: { not: 'CANCELADA' } } })
    if (!entrega) throw new AppError(404, 'Entrega não encontrada nesta rota.')
    await gravarDocumento('ENTREGA', entregaId, arquivoEnviado.parse(req.body), ['jpg', 'jpeg', 'png', 'webp', 'pdf'])
    await prisma.entregaHistorico.create({
      data: { entregaId, status: entrega.status, origem: 'ENTREGADOR', observacao: 'Comprovante anexado pelo entregador' },
    })
    return reply.status(201).send(await paraOEntregador(rota))
  })

  // O entregador registra a saída, a entrega ou a tentativa sem sucesso de uma parada da própria rota.
  app.post('/entregador/rotas/:id/entregas/:entregaId', async (req) => {
    const rota = await rotaDoLink(req)
    const { entregaId } = z.object({ entregaId: z.coerce.number().int().positive() }).parse(req.params)
    const dados = z
      .object({ status: z.enum(['EM_ROTA', 'ENTREGUE', 'FALHOU']), recebedor: texto.opcional, observacao: texto.opcional })
      .parse(req.body)
    const entrega = await prisma.entrega.findFirst({ where: { id: entregaId, rotaId: rota.id } })
    if (!entrega) throw new AppError(404, 'Entrega não encontrada nesta rota.')
    const historico = { origem: 'ENTREGADOR' as const, observacao: dados.observacao }

    if (dados.status === 'EM_ROTA') {
      await mudarEntrega(entregaId, ['PENDENTE'], { status: 'EM_ROTA', saiuEm: new Date() }, historico)
    } else if (dados.status === 'ENTREGUE') {
      if (!dados.recebedor) throw new AppError(400, 'Informe quem recebeu.')
      await mudarEntrega(
        entregaId,
        ['EM_ROTA'],
        { status: 'ENTREGUE', concluidaEm: new Date(), recebedor: dados.recebedor },
        { ...historico, observacao: [`Recebido por ${dados.recebedor}`, dados.observacao].filter(Boolean).join(' · ') },
      )
    } else {
      if (!dados.observacao) throw new AppError(400, 'Informe o motivo.')
      await mudarEntrega(entregaId, ['EM_ROTA'], { status: 'FALHOU', concluidaEm: new Date(), motivoFalha: dados.observacao }, historico)
    }
    return paraOEntregador(rota)
  })
}
