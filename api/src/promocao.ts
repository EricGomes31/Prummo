import { AppError } from './lib.js'

export const MODALIDADES = ['PERCENTUAL', 'PRECO', 'LEVE_PAGUE', 'COMBO', 'BRINDE'] as const

// Item como lançado: quantidade e preço na unidade do lançamento, cujo fator é `fator` (1 = unidade base).
export type ItemPedido = { produtoId: number; quantidade: number; precoUnitario: number; fator?: number }

// Folga para comparar quantidades fracionadas (1/3 + 1/3 + 1/3 deve valer 1).
const FOLGA = 1e-9

// As campanhas contam na unidade base. Junta os itens por produto e converte: `quantidade` passa a ser
// em unidades base (pode ser fracionada) e `precoUnitario`, o preço médio por unidade base.
function porProdutoNaBase(itens: ItemPedido[]) {
  const mapa = new Map<number, { quantidade: number; valor: number; precoUnitario: number }>()
  for (const i of itens) {
    const atual = mapa.get(i.produtoId) ?? { quantidade: 0, valor: 0, precoUnitario: 0 }
    atual.quantidade += i.quantidade / (i.fator ?? 1)
    atual.valor += i.quantidade * i.precoUnitario
    atual.precoUnitario = atual.quantidade > 0 ? atual.valor / atual.quantidade : 0
    mapa.set(i.produtoId, atual)
  }
  return mapa
}

export type Campanha = {
  nome: string
  modalidade: string
  inicio: Date
  fim: Date
  ativo: boolean
  percentual: number | null
  preco: number | null
  leve: number | null
  pague: number | null
  itens: { produtoId: number; quantidade: number; papel: string; produto: { nome: string } }[]
}

// A campanha vale do começo do dia de início ao fim do dia de término.
export function estaVigente(c: Pick<Campanha, 'inicio' | 'fim' | 'ativo'>, agora = new Date()) {
  const inicio = new Date(c.inicio)
  inicio.setHours(0, 0, 0, 0)
  const fim = new Date(c.fim)
  fim.setHours(24, 0, 0, 0)
  return c.ativo && agora >= inicio && agora < fim
}

// Calcula o desconto em centavos que a campanha dá a estes itens.
// Lança erro 400 quando o pedido não cumpre as condições, para o usuário saber o que falta.
export function calcularDescontoPromocao(c: Campanha, itens: ItemPedido[]) {
  const noPedido = porProdutoNaBase(itens)
  const compra = c.itens.filter((i) => i.papel === 'COMPRA')
  const naoAtende = (motivo: string) => new AppError(400, `Campanha "${c.nome}": ${motivo}`)
  let desconto = 0

  // Conjuntos completos: quantas vezes o pedido contém todos os produtos comprados nas quantidades da campanha.
  const conjuntos = () =>
    Math.min(...compra.map((i) => Math.floor((noPedido.get(i.produtoId)?.quantidade ?? 0) / i.quantidade + FOLGA)))

  switch (c.modalidade) {
    case 'PERCENTUAL':
    case 'PRECO': {
      for (const regra of compra) {
        const item = noPedido.get(regra.produtoId)
        if (!item || item.quantidade + FOLGA < regra.quantidade) continue
        desconto +=
          c.modalidade === 'PERCENTUAL'
            ? Math.round((item.valor * c.percentual!) / 10000)
            : Math.max(0, item.valor - item.quantidade * c.preco!)
      }
      if (desconto === 0) throw naoAtende('nenhum produto do pedido atinge a quantidade mínima ou tem desconto a receber.')
      break
    }
    case 'LEVE_PAGUE': {
      for (const regra of compra) {
        const item = noPedido.get(regra.produtoId)
        if (!item) continue
        desconto += Math.floor(item.quantidade / c.leve! + FOLGA) * (c.leve! - c.pague!) * item.precoUnitario
      }
      if (desconto === 0) throw naoAtende(`é preciso levar ao menos ${c.leve} unidades de um produto participante.`)
      break
    }
    case 'COMBO': {
      const n = conjuntos()
      if (n === 0) throw naoAtende('o pedido não tem um conjunto completo dos produtos do combo.')
      const precoNormal = compra.reduce((s, i) => s + i.quantidade * noPedido.get(i.produtoId)!.precoUnitario, 0)
      desconto = n * Math.max(0, precoNormal - c.preco!)
      if (desconto === 0) throw naoAtende('o preço do combo não é menor que o preço normal dos itens.')
      break
    }
    case 'BRINDE': {
      const n = conjuntos()
      if (n === 0) throw naoAtende('o pedido não tem a quantidade comprada exigida para o brinde.')
      for (const brinde of c.itens.filter((i) => i.papel === 'BRINDE')) {
        const item = noPedido.get(brinde.produtoId)
        if (!item) throw naoAtende(`inclua o brinde "${brinde.produto.nome}" no pedido.`)
        desconto += Math.min(n * brinde.quantidade, item.quantidade) * item.precoUnitario
      }
      break
    }
    default:
      throw naoAtende('modalidade desconhecida.')
  }
  return Math.round(desconto)
}
