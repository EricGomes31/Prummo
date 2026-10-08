-- Passagem de uma empresa só para várias (08/10/2026). Rodada uma vez no banco que já tinha dados,
-- ANTES do "npm run db:push": cria a empresa que fica com tudo o que já existe e acrescenta a coluna
-- "empresaId" preenchida com ela. O db:push depois troca o valor padrão, cria índices, chaves únicas
-- por empresa e a ligação do usuário com a empresa; o db:rls liga as travas (empresas.sql).
-- Em um banco novo não é preciso: o db:push e o seed criam tudo.
begin;

create table "Empresa" (
  "id" serial not null,
  "nome" text not null,
  "documento" text,
  "ativa" boolean not null default true,
  "criadoEm" timestamp(3) not null default current_timestamp,
  constraint "Empresa_pkey" primary key ("id")
);
insert into "Empresa" ("nome") values ('Infinity Labs');

do $$
declare
  tabela record;
begin
  for tabela in select tablename from pg_tables where schemaname = 'public' and tablename not in ('Empresa', '_prisma_migrations') loop
    execute format('alter table public.%I add column "empresaId" integer not null default 1', tabela.tablename);
  end loop;
end $$;

alter table "Usuario" add column "sistema" boolean not null default false;
update "Usuario" set "sistema" = true where "email" = 'admin@prumo.local';

commit;
