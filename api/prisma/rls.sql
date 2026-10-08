-- O Supabase expõe o schema public pela API REST dele, acessível com a chave publicável.
-- Com RLS ativo e sem políticas, essa API não lê nem grava nada. A API do Prumo conecta
-- como dono das tabelas e não é afetada. Rode de novo sempre que criar uma tabela.
do $$
declare
  tabela record;
begin
  for tabela in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', tabela.tablename);
  end loop;
end $$;
