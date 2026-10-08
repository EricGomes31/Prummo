-- Segunda trava da separação por empresa (a primeira é o filtro da API, em src/empresa.ts).
-- Em toda tabela com chave estrangeira para outra tabela que também tem "empresaId", um gatilho
-- recusa gravar o registro se o registro apontado for de outra empresa. Assim, mesmo que a API
-- receba o id de um cliente, produto ou conta de outra empresa, o banco não aceita a ligação.
-- Montado a partir das chaves estrangeiras existentes: rode de novo sempre que o esquema mudar
-- (o "npm run db:push" já faz isso).

create or replace function prumo_mesma_empresa() returns trigger language plpgsql as $$
declare
  i int := 0;
  valor int;
  dono int;
begin
  -- Os argumentos vêm em pares: coluna da chave estrangeira e tabela apontada.
  while i < tg_nargs loop
    execute format('select ($1).%I', tg_argv[i]) into valor using new;
    if valor is not null then
      execute format('select "empresaId" from %I where id = $1', tg_argv[i + 1]) into dono using valor;
      if dono is distinct from new."empresaId" then
        raise exception 'PRUMO_OUTRA_EMPRESA: %.% aponta para um registro de % de outra empresa', tg_table_name, tg_argv[i], tg_argv[i + 1];
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end $$;

do $$
declare
  t record;
begin
  for t in
    select origem.relname as tabela,
           string_agg(quote_literal(coluna.attname) || ', ' || quote_literal(destino.relname), ', ' order by coluna.attname) as pares
    from pg_constraint c
    join pg_class origem on origem.oid = c.conrelid
    join pg_class destino on destino.oid = c.confrelid
    join pg_namespace n on n.oid = origem.relnamespace and n.nspname = 'public'
    join pg_attribute coluna on coluna.attrelid = c.conrelid and coluna.attnum = c.conkey[1]
    where c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and exists (select 1 from pg_attribute x where x.attrelid = c.conrelid and x.attname = 'empresaId' and not x.attisdropped)
      and exists (select 1 from pg_attribute x where x.attrelid = c.confrelid and x.attname = 'empresaId' and not x.attisdropped)
    group by origem.relname
  loop
    execute format('drop trigger if exists prumo_mesma_empresa on %I', t.tabela);
    execute format('create trigger prumo_mesma_empresa before insert or update on %I for each row execute function prumo_mesma_empresa(%s)', t.tabela, t.pares);
  end loop;
end $$;
