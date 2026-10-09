import type { FastifyRequest } from 'fastify'
import { AppError } from './lib.js'

// Catálogo de permissões, agrupado como aparece na tela de perfis de acesso.
export const GRUPOS_PERMISSOES = [
  {
    grupo: 'Pessoas',
    permissoes: [
      ['PESSOAS_VISUALIZAR', 'Ver o cadastro de pessoas'],
      ['PESSOAS_CADASTRAR', 'Cadastrar pessoas'],
      ['PESSOAS_ALTERAR', 'Alterar e excluir pessoas'],
    ],
  },
  {
    grupo: 'Produtos e estoque',
    permissoes: [
      ['PRODUTOS_VISUALIZAR', 'Ver produtos e saldos'],
      ['PRODUTOS_CADASTRAR', 'Cadastrar produtos'],
      ['PRODUTOS_ALTERAR', 'Alterar produtos'],
      ['ESTOQUE_VISUALIZAR', 'Ver movimentações e entradas de estoque'],
      ['ESTOQUE_ENTRADA', 'Lançar entradas de estoque'],
      ['ESTOQUE_INVENTARIO', 'Ajustar o saldo por inventário'],
    ],
  },
  {
    grupo: 'Pedidos e vendas',
    permissoes: [
      ['PEDIDOS_VISUALIZAR', 'Ver pedidos'],
      ['PEDIDOS_CADASTRAR', 'Criar e alterar pedidos em aberto'],
      ['PEDIDOS_FATURAR', 'Faturar pedidos'],
      ['PEDIDOS_ALTERAR_FATURADO', 'Alterar pedidos já faturados'],
      ['PEDIDOS_CANCELAR', 'Cancelar pedidos'],
    ],
  },
  {
    grupo: 'Devoluções e créditos',
    permissoes: [
      ['DEVOLUCOES_VISUALIZAR', 'Ver devoluções e créditos de clientes'],
      ['DEVOLUCOES_REGISTRAR', 'Registrar devoluções de vendas'],
      ['CREDITOS_UTILIZAR', 'Usar créditos para baixar contas a receber'],
    ],
  },
  {
    grupo: 'Logística e entregas',
    permissoes: [
      ['LOGISTICA_VISUALIZAR', 'Ver entregas'],
      ['LOGISTICA_GERENCIAR', 'Programar e registrar entregas'],
    ],
  },
  {
    grupo: 'Promoções',
    permissoes: [
      ['PROMOCOES_VISUALIZAR', 'Ver campanhas'],
      ['PROMOCOES_GERENCIAR', 'Criar e alterar campanhas'],
    ],
  },
  {
    grupo: 'Financeiro',
    permissoes: [
      ['CONTAS_RECEBER_VISUALIZAR', 'Ver contas a receber'],
      ['CONTAS_RECEBER_BAIXAR', 'Lançar, receber, estornar e cancelar contas a receber'],
      ['CONTAS_PAGAR_VISUALIZAR', 'Ver contas a pagar'],
      ['CONTAS_PAGAR_BAIXAR', 'Lançar, pagar, estornar e cancelar contas a pagar'],
      ['DESPESAS_VISUALIZAR', 'Ver despesas'],
      ['DESPESAS_LANCAR', 'Lançar, corrigir e cancelar despesas'],
      ['CAIXA_VISUALIZAR', 'Ver caixa, bancos e extrato'],
      ['CAIXA_MOVIMENTAR', 'Cadastrar e alterar contas financeiras'],
      ['OFX_IMPORTAR', 'Importar extrato bancário (OFX)'],
      ['CONCILIACAO_VISUALIZAR', 'Ver a conciliação bancária'],
      ['CONCILIACAO_CONFIRMAR', 'Conciliar, ignorar e reabrir linhas do extrato'],
    ],
  },
  {
    grupo: 'Gestão',
    permissoes: [
      ['RELATORIOS_VISUALIZAR', 'Ver e exportar relatórios'],
      ['USUARIOS_GERENCIAR', 'Gerenciar usuários e perfis de acesso'],
    ],
  },
] as const

export const DASHBOARDS = [
  ['COMERCIAL', 'Comercial'],
  ['FINANCEIRO', 'Financeiro'],
] as const

export const PERMISSOES = GRUPOS_PERMISSOES.flatMap((g) => g.permissoes.map(([codigo]) => codigo))
export type Permissao = (typeof PERMISSOES)[number]
const CODIGOS_DASHBOARDS = DASHBOARDS.map(([codigo]) => codigo) as string[]

// Perfis de fábrica: não ficam no banco e não podem ser alterados. O administrador pode tudo; o
// operador faz o trabalho do dia a dia, sem gerenciar usuários nem campanhas.
const SO_ADMIN: string[] = ['USUARIOS_GERENCIAR', 'PROMOCOES_GERENCIAR']
export const PERFIS_PADRAO = {
  ADMIN: { nome: 'Administrador', descricao: 'Acesso completo ao sistema.', permissoes: [...PERMISSOES] as string[], dashboards: CODIGOS_DASHBOARDS },
  OPERADOR: {
    nome: 'Operador',
    descricao: 'Operação do dia a dia, sem gerenciar usuários nem campanhas.',
    permissoes: PERMISSOES.filter((p) => !SO_ADMIN.includes(p)) as string[],
    dashboards: CODIGOS_DASHBOARDS,
  },
} as const

type Acessos = { permissoes: string[]; dashboards: string[]; perfilNome: string }

// O perfil personalizado, quando existe e está ativo, define os acessos; sem ele vale o perfil de fábrica.
export function acessosDe(usuario: {
  perfil: string
  perfilAcesso: { nome: string; permissoes: string[]; dashboards: string[]; ativo: boolean } | null
}): Acessos {
  if (usuario.perfilAcesso) {
    const p = usuario.perfilAcesso
    return p.ativo ? { permissoes: p.permissoes, dashboards: p.dashboards, perfilNome: p.nome } : { permissoes: [], dashboards: [], perfilNome: p.nome }
  }
  const padrao = PERFIS_PADRAO[usuario.perfil === 'ADMIN' ? 'ADMIN' : 'OPERADOR']
  return { permissoes: padrao.permissoes, dashboards: padrao.dashboards, perfilNome: padrao.nome }
}

// Quem pode chamar cada rota: basta ter uma das permissões listadas. As listas de pessoas, produtos,
// campanhas e contas financeiras também servem de consulta para quem lança pedidos, entradas e baixas.
const LANCA_COM_PESSOA: Permissao[] = ['PEDIDOS_CADASTRAR', 'ESTOQUE_ENTRADA', 'CONTAS_RECEBER_BAIXAR', 'CONTAS_PAGAR_BAIXAR', 'LOGISTICA_GERENCIAR', 'DESPESAS_LANCAR', 'CONCILIACAO_CONFIRMAR']
const REGRAS: Record<string, Permissao[]> = {
  'GET /pessoas': ['PESSOAS_VISUALIZAR', ...LANCA_COM_PESSOA],
  'POST /pessoas': ['PESSOAS_CADASTRAR'],
  'PUT /pessoas/:id': ['PESSOAS_ALTERAR'],
  'DELETE /pessoas/:id': ['PESSOAS_ALTERAR'],

  'GET /produtos': ['PRODUTOS_VISUALIZAR', 'PEDIDOS_CADASTRAR', 'ESTOQUE_ENTRADA', 'PROMOCOES_GERENCIAR'],
  'POST /produtos': ['PRODUTOS_CADASTRAR'],
  'PUT /produtos/:id': ['PRODUTOS_ALTERAR'],
  'GET /produtos/:id/movimentos': ['ESTOQUE_VISUALIZAR', 'ESTOQUE_INVENTARIO'],
  'POST /produtos/:id/ajuste': ['ESTOQUE_INVENTARIO'],

  'GET /entradas': ['ESTOQUE_VISUALIZAR', 'ESTOQUE_ENTRADA'],
  'GET /entradas/:id': ['ESTOQUE_VISUALIZAR', 'ESTOQUE_ENTRADA'],
  'POST /entradas': ['ESTOQUE_ENTRADA'],

  'GET /pedidos': ['PEDIDOS_VISUALIZAR', 'PEDIDOS_CADASTRAR', 'DEVOLUCOES_REGISTRAR'],
  'GET /pedidos/:id': ['PEDIDOS_VISUALIZAR', 'PEDIDOS_CADASTRAR'],
  'POST /pedidos': ['PEDIDOS_CADASTRAR'],
  'PUT /pedidos/:id': ['PEDIDOS_CADASTRAR'],
  'POST /pedidos/:id/faturar': ['PEDIDOS_FATURAR'],
  'PUT /pedidos/:id/faturado': ['PEDIDOS_ALTERAR_FATURADO'],
  'POST /pedidos/:id/cancelar': ['PEDIDOS_CANCELAR'],

  'GET /entregas': ['LOGISTICA_VISUALIZAR', 'LOGISTICA_GERENCIAR'],
  'GET /entregas/pedidos-disponiveis': ['LOGISTICA_GERENCIAR'],
  'GET /entregas/entregadores': ['LOGISTICA_VISUALIZAR', 'LOGISTICA_GERENCIAR'],
  'POST /entregas': ['LOGISTICA_GERENCIAR'],
  'PUT /entregas/:id': ['LOGISTICA_GERENCIAR'],
  'POST /entregas/:id/sair': ['LOGISTICA_GERENCIAR'],
  'POST /entregas/:id/concluir': ['LOGISTICA_GERENCIAR'],
  'POST /entregas/:id/falhar': ['LOGISTICA_GERENCIAR'],
  'POST /entregas/:id/reprogramar': ['LOGISTICA_GERENCIAR'],
  'POST /entregas/:id/cancelar': ['LOGISTICA_GERENCIAR'],
  'PUT /entregas/:id/rota': ['LOGISTICA_GERENCIAR'],
  'GET /entregas/:id/historico': ['LOGISTICA_VISUALIZAR', 'LOGISTICA_GERENCIAR'],
  'GET /motoristas': ['LOGISTICA_VISUALIZAR', 'LOGISTICA_GERENCIAR'],
  'POST /motoristas': ['LOGISTICA_GERENCIAR'],
  'PUT /motoristas/:id': ['LOGISTICA_GERENCIAR'],
  'GET /veiculos': ['LOGISTICA_VISUALIZAR', 'LOGISTICA_GERENCIAR'],
  'POST /veiculos': ['LOGISTICA_GERENCIAR'],
  'PUT /veiculos/:id': ['LOGISTICA_GERENCIAR'],
  'GET /rotas': ['LOGISTICA_VISUALIZAR', 'LOGISTICA_GERENCIAR'],
  'POST /rotas': ['LOGISTICA_GERENCIAR'],
  'PUT /rotas/:id': ['LOGISTICA_GERENCIAR'],
  'PUT /rotas/:id/sequencia': ['LOGISTICA_GERENCIAR'],
  'POST /rotas/:id/organizar': ['LOGISTICA_GERENCIAR'],
  'POST /rotas/:id/link': ['LOGISTICA_GERENCIAR'],
  'DELETE /rotas/:id/link': ['LOGISTICA_GERENCIAR'],

  'GET /promocoes': ['PROMOCOES_VISUALIZAR', 'PROMOCOES_GERENCIAR', 'PEDIDOS_CADASTRAR'],
  'POST /promocoes/:id/simular': ['PROMOCOES_VISUALIZAR', 'PROMOCOES_GERENCIAR', 'PEDIDOS_CADASTRAR'],
  'POST /promocoes': ['PROMOCOES_GERENCIAR'],
  'PUT /promocoes/:id': ['PROMOCOES_GERENCIAR'],

  'GET /devolucoes': ['DEVOLUCOES_VISUALIZAR', 'DEVOLUCOES_REGISTRAR'],
  'GET /devolucoes/pedido/:id/saldos': ['DEVOLUCOES_REGISTRAR'],
  'POST /devolucoes': ['DEVOLUCOES_REGISTRAR'],
  'GET /creditos': ['DEVOLUCOES_VISUALIZAR', 'DEVOLUCOES_REGISTRAR', 'CREDITOS_UTILIZAR'],
  'POST /creditos/:id/utilizar': ['CREDITOS_UTILIZAR'],

  'GET /contas-receber': ['CONTAS_RECEBER_VISUALIZAR', 'CONTAS_RECEBER_BAIXAR', 'CREDITOS_UTILIZAR', 'CONCILIACAO_CONFIRMAR'],
  'GET /contas-receber/:id/baixas': ['CONTAS_RECEBER_VISUALIZAR', 'CONTAS_RECEBER_BAIXAR'],
  'POST /contas-receber': ['CONTAS_RECEBER_BAIXAR'],
  'POST /contas-receber/:id/baixar': ['CONTAS_RECEBER_BAIXAR'],
  'POST /contas-receber/:id/estornar': ['CONTAS_RECEBER_BAIXAR'],
  'POST /contas-receber/:id/cancelar': ['CONTAS_RECEBER_BAIXAR'],
  'GET /contas-pagar': ['CONTAS_PAGAR_VISUALIZAR', 'CONTAS_PAGAR_BAIXAR', 'CONCILIACAO_CONFIRMAR'],
  'GET /contas-pagar/:id/baixas': ['CONTAS_PAGAR_VISUALIZAR', 'CONTAS_PAGAR_BAIXAR'],
  'POST /contas-pagar': ['CONTAS_PAGAR_BAIXAR'],
  'POST /contas-pagar/:id/baixar': ['CONTAS_PAGAR_BAIXAR'],
  'POST /contas-pagar/:id/estornar': ['CONTAS_PAGAR_BAIXAR'],
  'POST /contas-pagar/:id/cancelar': ['CONTAS_PAGAR_BAIXAR'],
  'GET /despesas': ['DESPESAS_VISUALIZAR', 'DESPESAS_LANCAR'],
  'GET /despesas/elementos': ['DESPESAS_VISUALIZAR', 'DESPESAS_LANCAR'],
  'POST /despesas': ['DESPESAS_LANCAR'],
  'PUT /despesas/:id': ['DESPESAS_LANCAR'],
  'POST /despesas/:id/cancelar': ['DESPESAS_LANCAR'],
  'GET /contas-financeiras': ['CAIXA_VISUALIZAR', 'CAIXA_MOVIMENTAR', 'CONTAS_RECEBER_BAIXAR', 'CONTAS_PAGAR_BAIXAR', 'OFX_IMPORTAR', 'CONCILIACAO_VISUALIZAR', 'CONCILIACAO_CONFIRMAR', 'DESPESAS_LANCAR'],
  'POST /ofx/ler': ['OFX_IMPORTAR'],
  'POST /ofx/importar': ['OFX_IMPORTAR'],
  'GET /conciliacao/pendentes': ['CONCILIACAO_VISUALIZAR', 'CONCILIACAO_CONFIRMAR'],
  'GET /conciliacao/concluidas': ['CONCILIACAO_VISUALIZAR', 'CONCILIACAO_CONFIRMAR'],
  'POST /conciliacao/:id/baixar': ['CONCILIACAO_CONFIRMAR'],
  'POST /conciliacao/:id/vincular': ['CONCILIACAO_CONFIRMAR'],
  'POST /conciliacao/:id/avulso': ['CONCILIACAO_CONFIRMAR'],
  'POST /conciliacao/:id/credito': ['CONCILIACAO_CONFIRMAR'],
  'POST /conciliacao/:id/ignorar': ['CONCILIACAO_CONFIRMAR'],
  'POST /conciliacao/:id/reabrir': ['CONCILIACAO_CONFIRMAR'],
  'POST /conciliacao/automatica': ['CONCILIACAO_CONFIRMAR'],
  'POST /contas-financeiras': ['CAIXA_MOVIMENTAR'],
  'PUT /contas-financeiras/:id': ['CAIXA_MOVIMENTAR'],
  'GET /movimentos-financeiros': ['CAIXA_VISUALIZAR', 'CAIXA_MOVIMENTAR'],

  'GET /relatorios/vendas': ['RELATORIOS_VISUALIZAR'],
  'GET /relatorios/financeiro': ['RELATORIOS_VISUALIZAR'],
  'GET /relatorios/despesas': ['RELATORIOS_VISUALIZAR'],

  'GET /usuarios': ['USUARIOS_GERENCIAR'],
  'POST /usuarios': ['USUARIOS_GERENCIAR'],
  'PUT /usuarios/:id': ['USUARIOS_GERENCIAR'],
  'GET /perfis': ['USUARIOS_GERENCIAR'],
  'POST /perfis': ['USUARIOS_GERENCIAR'],
  'PUT /perfis/:id': ['USUARIOS_GERENCIAR'],
}
// Cada dashboard é liberado pelo perfil, não por permissão.
const REGRAS_DASHBOARDS: Record<string, string> = {
  'GET /dashboards/comercial': 'COMERCIAL',
  'GET /dashboards/financeiro': 'FINANCEIRO',
}

// Confere a permissão da rota chamada. Rotas fora das tabelas (início, anexos, a própria sessão)
// valem para qualquer usuário autenticado. `prefixo` é o das rotas da API ("/api" em produção).
export function autorizar(prefixo: string) {
  return async (req: FastifyRequest) => {
    const caminho = (req.routeOptions.url ?? '').slice(prefixo.length)
    const chave = `${req.method} ${caminho}`
    const exigidas = REGRAS[chave]
    if (exigidas && !exigidas.some((p) => req.usuario.permissoes.includes(p))) {
      throw new AppError(403, 'Seu perfil de acesso não permite esta operação.')
    }
    const dashboard = REGRAS_DASHBOARDS[chave]
    if (dashboard && !req.usuario.dashboards.includes(dashboard)) {
      throw new AppError(403, 'Seu perfil de acesso não inclui este dashboard.')
    }
  }
}

export const exigir = (permissao: Permissao) => async (req: FastifyRequest) => {
  if (!req.usuario.permissoes.includes(permissao)) throw new AppError(403, 'Seu perfil de acesso não permite esta operação.')
}
