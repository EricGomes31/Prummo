# Banco de dados (PostgreSQL 16 na VPS)

Consultas pelo servidor: `ssh … "sudo -u postgres psql -d prumo -Atc '<sql>'"`. Só leitura na auditoria.

## Papéis e acesso
- `select rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolcanlogin`:
  o papel `prumo` (da aplicação) não deve ser superusuário nem ter `bypassrls`, `createrole`, `createdb`.
- `has_parameter_privilege('prumo','session_replication_role','SET')` deve ser `f` (essa permissão desliga
  gatilhos e travas; só é dada temporariamente durante cargas).
- `pg_hba.conf`: conexões só locais; `listen_addresses` = localhost.
- Senha do papel `prumo`: longa e aleatória, só em `/etc/prumo/prumo.env`.

## Travas por empresa e RLS
- Todas as tabelas com `empresaId` têm o gatilho `prumo_mesma_empresa` (`select tgrelid::regclass from
  pg_trigger where tgname='prumo_mesma_empresa'`) e o valor padrão do `empresaId` vindo de
  `current_setting('prumo.empresa')`. Tabela nova sem gatilho = Alto. Correção: `prisma/empresas.sql`.
- RLS ligado em todas as tabelas de `public` (`prisma/rls.sql`). Sem políticas, ele não bloqueia o dono das
  tabelas (a aplicação) — na VPS sua função é defesa extra caso algum dia o banco seja exposto por outra via.
- Tabelas novas exigem rodar os dois arquivos de novo.

## Dados e integridade
- Senhas só como hash bcrypt (`Usuario.senhaHash` começa com `$2`).
- Nenhum segredo em colunas de texto livre (observações) — procure padrões de senha/token se houver dúvida.

## Cópias e restauração
- Ver `servidor.md` (cópias). Para o banco: o `pg_dump -Fc` restaura com
  `pg_restore --clean --if-exists -d prumo banco.dump`. Restauração testada é o que transforma cópia em
  garantia.
