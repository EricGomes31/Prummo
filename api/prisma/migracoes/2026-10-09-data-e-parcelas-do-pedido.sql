-- Pedido ganha a data da venda e as parcelas escolhidas à mão (09/10/2026). Rode uma vez, antes de publicar
-- a API nova (a publicada hoje ignora as colunas novas e continua funcionando):
--   npx prisma db execute --file prisma/migracoes/2026-10-09-data-e-parcelas-do-pedido.sql --schema prisma/schema.prisma
-- Pode ser rodada de novo sem efeito: a data dos pedidos existentes só é preenchida quando a coluna é criada.
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'Pedido' and column_name = 'data') then
    alter table "Pedido" add column "data" timestamp(3) not null default current_timestamp;
    -- Até aqui o pedido não tinha data da venda: vale a data em que foi lançado (no importado do SG Nexus, a de lá).
    update "Pedido" set "data" = "criadoEm";
  end if;
end $$;

alter table "Pedido" add column if not exists "vencimentos" jsonb;

commit;
