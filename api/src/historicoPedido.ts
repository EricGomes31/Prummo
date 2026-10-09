// Histórico do pedido: o que aconteceu com ele (lançado, alterado, faturado, cancelado), com o que mudou
// descrito em português, o motivo e quem fez. As mudanças saem da comparação de dois retratos do pedido.
import { quantidadeTexto, type Transacao } from './lib.js'

export type TipoHistorico = 'CRIADO' | 'ALTERADO' | 'FATURADO' | 'ALTERADO_FATURADO' | 'CANCELADO'

export const reais = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')

const FORMAS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  LINK_CARTAO: 'Link de pagamento',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
}

type Retrato = {
  campos: Record<string, string>
  itens: Map<string, string>
  total: number
}

// Os campos que valem a pena comparar, já como o usuário os lê.
export async function retratar(tx: Transacao, id: number): Promise<Retrato> {
  const p = await tx.pedido.findUniqueOrThrow({
    where: { id },
    include: {
      cliente: { select: { nome: true } },
      vendedor: { select: { nome: true } },
      medico: { select: { nome: true } },
      paciente: { select: { nome: true } },
      promocao: { select: { nome: true } },
      itens: { include: { produto: { select: { nome: true } } }, orderBy: { id: 'asc' } },
    },
  })
  const vencimentos = Array.isArray(p.vencimentos) ? (p.vencimentos as { vencimento: string; valor: number }[]) : null
  const pagamento = p.formaPagamento
    ? `${FORMAS[p.formaPagamento] ?? p.formaPagamento}, ${
        vencimentos?.length
          ? vencimentos.map((v) => `${v.vencimento.split('-').reverse().join('/')} ${reais(v.valor)}`).join('; ')
          : `${p.parcelas}x a partir de ${dataBr(p.primeiroVencimento)}`
      }`
    : 'a definir'
  const endereco = p.enderecoEntrega as { logradouro?: string; numero?: string | null; cidade?: string } | null
  return {
    campos: {
      Cliente: p.cliente.nome,
      Vendedor: p.vendedor?.nome ?? '—',
      Médico: p.medico?.nome ?? '—',
      Paciente: p.paciente?.nome ?? '—',
      'Data da venda': dataBr(p.data),
      'Motivo da perda': p.motivoPerda ?? '—',
      Campanha: p.promocao?.nome ?? '—',
      'Desconto no total': reais(p.desconto),
      Frete: reais(p.frete),
      Pagamento: p.natureza === 'VENDA' ? pagamento : '—',
      'Endereço de entrega': endereco?.logradouro ? [endereco.logradouro, endereco.numero, endereco.cidade].filter(Boolean).join(', ') : 'o do cliente',
      Observação: p.observacao ?? '—',
    },
    itens: new Map(
      p.itens.map((i) => [
        `${i.produtoId}:${i.unidade ?? ''}`,
        `${quantidadeTexto(i.quantidade)} ${i.unidade ?? ''} de ${i.produto.nome}${i.precoUnitario ? ` a ${reais(i.precoUnitario)}` : ''}${i.desconto ? ` (desconto de ${reais(i.desconto)})` : ''}`.replace(/\s+/g, ' '),
      ]),
    ),
    total: p.total,
  }
}

// O que mudou de um retrato para o outro, uma frase por mudança.
export function mudancas(antes: Retrato, depois: Retrato): string[] {
  const lista: string[] = []
  for (const [campo, valor] of Object.entries(depois.campos)) {
    if (antes.campos[campo] !== valor) lista.push(`${campo}: ${antes.campos[campo]} → ${valor}`)
  }
  for (const [chave, texto] of depois.itens) {
    const anterior = antes.itens.get(chave)
    if (!anterior) lista.push(`Item incluído: ${texto}`)
    else if (anterior !== texto) lista.push(`Item alterado: ${anterior} → ${texto}`)
  }
  for (const [chave, texto] of antes.itens) if (!depois.itens.has(chave)) lista.push(`Item retirado: ${texto}`)
  if (antes.total !== depois.total) lista.push(`Total: ${reais(antes.total)} → ${reais(depois.total)}`)
  return lista
}

export function registrar(
  tx: Transacao,
  dados: { pedidoId: number; tipo: TipoHistorico; descricao: string; usuarioId: number; motivo?: string | null; totalAnterior?: number; totalNovo?: number },
) {
  return tx.pedidoHistorico.create({ data: { ...dados, motivo: dados.motivo ?? null } })
}
