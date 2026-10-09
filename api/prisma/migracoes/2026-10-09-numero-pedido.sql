-- Numeração dos pedidos por empresa (09/10/2026). Rodada uma vez no banco que já tinha pedidos,
-- ANTES do "npm run db:push", que não consegue criar a coluna obrigatória "numero" com linhas existentes:
--   npx prisma db execute --file prisma/migracoes/2026-10-09-numero-pedido.sql --schema prisma/schema.prisma
-- Os pedidos que já existem ficam com o número igual ao id, que era o número mostrado até aqui, e cada
-- empresa continua a contagem a partir do maior número dela. Pode ser rodada de novo sem efeito.
begin;

alter table "Empresa" add column if not exists "ultimoPedido" integer not null default 0;
alter table "Pedido" add column if not exists "numero" integer;
update "Pedido" set "numero" = "id" where "numero" is null;
alter table "Pedido" alter column "numero" set not null;

update "Empresa" e
set "ultimoPedido" = greatest(e."ultimoPedido", coalesce((select max(p."numero") from "Pedido" p where p."empresaId" = e."id"), 0));

commit;
