#!/usr/bin/env bash
# Coleta, só lendo, o estado de segurança da VPS do Prumo e do site no ar. Não altera nada e não mostra
# segredos (senhas, chaves, JWT_SECRET, URLs de banco). Rodar da raiz do projeto, no Git Bash:
#   bash .claude/skills/seguranca-prumo/scripts/auditar-servidor.sh
set -uo pipefail
SERVIDOR=${SERVIDOR:-root@179.236.68.14}
CHAVE=${CHAVE:-$HOME/.ssh/prumo_vps}
SITE=${SITE:-https://prummo.tech}

echo "######## Site ($SITE)"
echo "== Cabeçalhos de segurança"
curl -sI "$SITE/" | grep -iE '^(strict-transport-security|content-security-policy|x-content-type-options|x-frame-options|referrer-policy|permissions-policy|server|x-powered-by):' || echo "(nenhum dos cabeçalhos de segurança)"
echo "== HTTP vai para HTTPS? e www?"
curl -s -o /dev/null -w "http://  -> %{http_code} %{redirect_url}" "http://${SITE#https://}/"; echo
curl -s -o /dev/null -w "www      -> %{http_code} %{redirect_url}" "https://www.${SITE#https://}/"; echo
echo "== Certificado"
echo | openssl s_client -connect "${SITE#https://}:443" -servername "${SITE#https://}" 2>/dev/null | openssl x509 -noout -issuer -enddate
echo "== API: erro não vaza detalhes; rota protegida pede login"
curl -s -o /dev/null -w "GET /api/pessoas sem login -> %{http_code}\n" "$SITE/api/pessoas"
curl -s -o /dev/null -w "GET /api/sistema/empresas sem login -> %{http_code}\n" "$SITE/api/sistema/empresas"

echo
echo "######## Servidor ($SERVIDOR)"
ssh -i "$CHAVE" -o BatchMode=yes -o ConnectTimeout=15 "$SERVIDOR" 'bash -s' <<'REMOTO'
set -uo pipefail
secao() { echo; echo "== $1"; }
secao "Sistema"; . /etc/os-release; echo "$PRETTY_NAME | kernel $(uname -r) | ligado há $(uptime -p)"
[ -f /var/run/reboot-required ] && echo "PRECISA REINICIAR: $(cat /var/run/reboot-required.pkgs 2>/dev/null | tr '\n' ' ')"
secao "Atualizações pendentes (segurança)"
apt-get -s upgrade 2>/dev/null | grep -i '^Inst' | grep -ci security | sed 's/^/pacotes de segurança pendentes: /'
cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null
secao "SSH (configuração efetiva)"
sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|maxauthtries|x11forwarding|allowusers|allowgroups) '
secao "Chaves autorizadas do root (impressão digital, comentário e se é restrita)"
grep -vE '^\s*(#|$)' /root/.ssh/authorized_keys | while read -r linha; do
  case "$linha" in
    command=*) restrita="[restrita: $(echo "$linha" | grep -o 'command="[^"]*"')]"; chave=$(echo "$linha" | grep -oE '(ssh|ecdsa)-[a-z0-9-]+ [A-Za-z0-9+/=]+.*') ;;
    *) restrita="[acesso total]"; chave=$linha ;;
  esac
  echo "- $(echo "$chave" | ssh-keygen -lf - 2>/dev/null | cut -d' ' -f2-) $restrita"
done
echo "(usuários com shell e chaves: $(grep -lE . /home/*/.ssh/authorized_keys 2>/dev/null | tr '\n' ' '))"
secao "Firewall"; ufw status verbose 2>/dev/null | sed -n '1,30p'
secao "Portas escutando"; ss -tlnpH | awk '{print $4, $6}'
secao "fail2ban"; fail2ban-client status sshd 2>/dev/null | grep -E 'Currently|Total' | sed 's/^[ |`-]*//'
secao "Últimas entradas aceitas por SSH (7 dias)"
journalctl -u ssh --since "-7 days" --no-pager 2>/dev/null | grep -i 'Accepted' | awk '{print $1, $2, $3, $9, $11, $16}' | tail -15
secao "Serviço do Prumo"
systemctl is-active prumo caddy postgresql | paste -sd' ' | sed 's/^/prumo caddy postgresql: /'
systemctl show prumo -p User -p NoNewPrivileges -p ProtectSystem -p ReadWritePaths | tr '\n' ' '; echo
secao "Arquivos sensíveis (dono, grupo, permissão)"
stat -c '%U:%G %a %n' /etc/prumo/prumo.env /var/backups/prumo /var/lib/prumo /var/lib/prumo/uploads /root/.ssh/authorized_keys 2>&1
echo "JWT_SECRET: $(grep -c '^JWT_SECRET=' /etc/prumo/prumo.env) linha(s), tamanho $(grep '^JWT_SECRET=' /etc/prumo/prumo.env | cut -d= -f2- | tr -d '\r\n' | wc -c)"
secao "Cópias de segurança"
systemctl is-active prumo-copia.timer | sed 's/^/timer: /'
ls -1t /var/backups/prumo/*.tar.gz 2>/dev/null | head -3 | while read -r f; do echo "$(stat -c '%y' "$f" | cut -c1-16)  $(du -h "$f" | cut -f1)  $(basename "$f")"; done
echo "total de cópias guardadas: $(ls /var/backups/prumo/*.tar.gz 2>/dev/null | wc -l)"
secao "Caddy"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1
grep -nE 'header|tls|reverse_proxy|redir' /etc/caddy/Caddyfile
secao "PostgreSQL"
sudo -u postgres psql -Atqc "show listen_addresses" | sed 's/^/listen_addresses: /'
grep -vE '^\s*(#|$)' /etc/postgresql/*/main/pg_hba.conf | awk '{print $1, $2, $3, $4, $5}'
sudo -u postgres psql -Atqc "select rolname || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls || ' createrole=' || rolcreaterole || ' createdb=' || rolcreatedb from pg_roles where rolcanlogin"
sudo -u postgres psql -d prumo -Atqc "select 'prumo pode desligar travas (session_replication_role): ' || has_parameter_privilege('prumo','session_replication_role','SET')"
sudo -u postgres psql -d prumo -Atqc "select 'tabelas com empresaId sem a trava por empresa: ' || coalesce(string_agg(c.table_name, ', '), 'nenhuma') from information_schema.columns c where c.table_schema='public' and c.column_name='empresaId' and not exists (select 1 from pg_trigger t where t.tgrelid = format('%I', c.table_name)::regclass and t.tgname = 'prumo_mesma_empresa') and c.table_name in (select table_name from information_schema.table_constraints where constraint_type='FOREIGN KEY' and table_schema='public')"
sudo -u postgres psql -d prumo -Atqc "select 'tabelas sem RLS: ' || coalesce(string_agg(relname, ', '), 'nenhuma') from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity"
sudo -u postgres psql -d prumo -Atqc "select 'senhas que não são bcrypt: ' || count(*) from \"Usuario\" where \"senhaHash\" not like '\$2%'"
sudo -u postgres psql -d prumo -Atqc "select 'usuários ativos por empresa: ' || string_agg(e.nome || '=' || (select count(*) from \"Usuario\" u where u.\"empresaId\" = e.id and u.ativo), ', ') from \"Empresa\" e"
REMOTO
