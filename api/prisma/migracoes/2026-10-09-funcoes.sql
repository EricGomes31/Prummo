-- Ajuste dos dados que já existiam para as funções acrescentadas em 09/10/2026.
-- Rode uma vez, DEPOIS do "npm run db:push" que cria as colunas novas:
--   npx prisma db execute --file prisma/migracoes/2026-10-09-funcoes.sql --schema prisma/schema.prisma
-- Pode ser rodado de novo sem efeito.

-- O crédito sem devolução de origem nasceu de um depósito a maior na conciliação. A coluna "origem"
-- é nova e começa como DEVOLUCAO em todos.
update "Credito" set origem = 'DEPOSITO' where "devolucaoId" is null and origem = 'DEVOLUCAO';

-- Os pedidos faturados antes da condição de pagamento no pedido ficam com o número de parcelas e o
-- primeiro vencimento das contas a receber que geraram.
update "Pedido" p
set parcelas = c.quantidade, "primeiroVencimento" = c.primeiro
from (
  select "pedidoId", count(*)::int as quantidade, min(vencimento) as primeiro
  from "ContaReceber"
  where "pedidoId" is not null and status <> 'CANCELADA'
  group by "pedidoId"
) c
where c."pedidoId" = p.id and p."primeiroVencimento" is null;
