#!/usr/bin/env bash
# Teste de restauração: restaura a cópia mais recente da VPS num banco temporário (prumo_restauracao),
# compara as contagens com o banco oficial e apaga o temporário. Não mexe no banco oficial.
# Uso, da raiz do projeto: ssh -i ~/.ssh/prumo_vps root@179.236.68.14 'bash -s' < .claude/skills/seguranca-prumo/scripts/testar-restauracao.sh
set -e
F=$(ls -1t /var/backups/prumo/*.tar.gz | head -1); echo "cópia: $F"
T=$(mktemp -d); trap 'rm -rf "$T"; sudo -u postgres dropdb --if-exists prumo_restauracao' EXIT
tar -xzf "$F" -C "$T"; chmod -R o+rX "$T"
sudo -u postgres createdb -T template0 -E UTF8 --locale=en_US.UTF-8 prumo_restauracao
sudo -u postgres pg_restore --no-owner --role=postgres -d prumo_restauracao "$T/banco.dump" 2>&1 | tail -3
cat > "$T/q.sql" <<'SQL'
select string_agg(t || '=' || n, ' ' order by t) from (
  select 'Pessoa' t, count(*) n from "Pessoa" union all select 'Produto', count(*) from "Produto"
  union all select 'Pedido', count(*) from "Pedido" union all select 'ContaReceber', count(*) from "ContaReceber"
  union all select 'Usuario', count(*) from "Usuario" union all select 'MovimentoEstoque', count(*) from "MovimentoEstoque"
  union all select 'Empresa', count(*) from "Empresa") x;
select 'gatilhos por empresa: ' || count(*) from pg_trigger where tgname = 'prumo_mesma_empresa';
SQL
chmod o+r "$T/q.sql"
echo "== banco oficial";   sudo -u postgres psql -d prumo -At -f "$T/q.sql"
echo "== cópia restaurada"; sudo -u postgres psql -d prumo_restauracao -At -f "$T/q.sql"
echo "anexos na cópia: $(ls "$T/uploads" | wc -l) | anexos no servidor: $(ls /var/lib/prumo/uploads | wc -l)"
