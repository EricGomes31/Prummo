// Separação dos dados por empresa.
//
// Cada requisição roda num contexto (AsyncLocalStorage) que guarda a empresa do usuário. O cliente do
// Prisma exportado por lib.ts passa por `escoparPorEmpresa`, que acrescenta a empresa em toda consulta
// (where) e em toda gravação (data, inclusive aninhada). Uma consulta sem empresa definida é recusada,
// em vez de ler os dados de todas. O banco completa a proteção: prisma/empresas.sql recusa ligar um
// registro a outro de empresa diferente, mesmo que a API receba o id de um registro alheio.
import { AsyncLocalStorage } from 'node:async_hooks'
import { Prisma } from '@prisma/client'

type Contexto = { empresaId: number | null; livre?: boolean }
const contexto = new AsyncLocalStorage<Contexto>()

// Abre o contexto de uma requisição, ainda sem empresa: ela é definida depois de saber quem chamou.
export const abrirContexto = (continuar: () => void) => contexto.run({ empresaId: null }, continuar)

export function definirEmpresa(empresaId: number) {
  const atual = contexto.getStore()
  if (!atual || atual.livre) throw new Error('Não há contexto de requisição para definir a empresa.')
  atual.empresaId = empresaId
}

// Para scripts, seed e testes: roda as consultas dentro de uma empresa.
export const comEmpresa = <T>(empresaId: number, fazer: () => Promise<T>) => contexto.run({ empresaId }, fazer)

// Sem filtro de empresa. Só para o que precisa enxergar todas: login, sessão, link do entregador e a
// administração das empresas. Gravações aqui precisam informar a empresa por conta própria.
export const semEmpresa = <T>(fazer: () => Promise<T>) => contexto.run({ empresaId: null, livre: true }, fazer)

// A própria tabela de empresas não pertence a nenhuma.
const SEM_DONO = new Set(['Empresa'])

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)
const lista = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v])

function marcar(registro: unknown, empresaId: number) {
  if (!ehObjeto(registro)) return
  registro.empresaId = empresaId
  marcarAninhadas(registro, empresaId)
}

// Percorre os campos de relação de uma gravação e marca a empresa em cada registro criado junto.
function marcarAninhadas(dados: unknown, empresaId: number) {
  if (!ehObjeto(dados)) return
  for (const operacoes of Object.values(dados)) {
    if (!ehObjeto(operacoes)) continue
    for (const r of lista(operacoes.create)) marcar(r, empresaId)
    if (ehObjeto(operacoes.createMany)) for (const r of lista(operacoes.createMany.data)) marcar(r, empresaId)
    for (const c of lista(operacoes.connectOrCreate)) if (ehObjeto(c)) marcar(c.create, empresaId)
    for (const u of lista(operacoes.upsert)) {
      if (!ehObjeto(u)) continue
      marcar(u.create, empresaId)
      marcarAninhadas(u.update, empresaId)
    }
    for (const u of lista(operacoes.update)) if (ehObjeto(u)) marcarAninhadas(ehObjeto(u.data) ? u.data : u, empresaId)
  }
}

const LEITURAS_E_FILTROS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany', 'upsert',
])

export const escoparPorEmpresa = Prisma.defineExtension({
  name: 'empresa',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (SEM_DONO.has(model)) return query(args)
        const atual = contexto.getStore()
        if (atual?.livre) return query(args)
        const empresaId = atual?.empresaId
        if (!empresaId) throw new Error(`Consulta a ${model}.${operation} sem empresa definida.`)

        const a = (args ?? {}) as Record<string, unknown>
        if (LEITURAS_E_FILTROS.has(operation)) a.where = { ...(a.where as object), empresaId }
        if (operation === 'create') marcar(a.data, empresaId)
        if (operation === 'createMany' || operation === 'createManyAndReturn') for (const r of lista(a.data)) marcar(r, empresaId)
        if (operation === 'upsert') {
          marcar(a.create, empresaId)
          marcarAninhadas(a.update, empresaId)
        }
        if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') {
          // Um registro nunca muda de empresa.
          if (ehObjeto(a.data)) delete a.data.empresaId
          marcarAninhadas(a.data, empresaId)
        }
        return query(a as typeof args)
      },
    },
  },
})
