# Servidor (VPS)

A maior parte já sai do `scripts/auditar-servidor.sh`. Para cada item: o que conferir, o esperado e por quê.

## Acesso (SSH)
- `sshd -T`: `passwordauthentication no`, `kbdinteractiveauthentication no`,
  `permitrootlogin without-password` (ou `prohibit-password`). Senha ligada = alvo de robôs que testam
  senhas o dia todo.
- `/root/.ssh/authorized_keys`: só as chaves conhecidas — a do computador de trabalho (`prumo-vps …`) e a
  do GitHub (`github-actions copia prumo`) com `command="/usr/local/sbin/prumo-copia --enviar",no-pty,
  no-port-forwarding…`. Chave desconhecida = Crítico (alguém pode ter acesso).
- fail2ban ativo na jail `sshd`. `journalctl -u ssh` mostra tentativas; volume alto é normal na internet,
  entradas aceitas de IPs estranhos não.
- Melhorias possíveis (Médio): usuário próprio com sudo em vez de root; porta do SSH limitada a IPs
  conhecidos se o usuário tiver IP fixo.

## Firewall e portas
- `ufw status`: entrada negada por padrão; abertas só 22, 80, 443 (v4 e v6).
- `ss -tlnp`: PostgreSQL (5432) e o Node (3000) só em 127.0.0.1/::1; Caddy em 80/443; admin do Caddy
  (2019) só local. Banco ou Node escutando em 0.0.0.0 = Crítico.

## HTTPS e cabeçalhos
- Certificado válido e com mais de 20 dias (o Caddy renova sozinho; se faltar menos, algo travou).
- `www.prummo.tech` redireciona; HTTP vai para HTTPS.
- Cabeçalhos na resposta do site: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options` (ou `frame-ancestors` no CSP), `Referrer-Policy`, e de preferência
  `Content-Security-Policy`. Ausência é Médio; dá para pôr no Caddyfile num bloco `header { … }`
  (teste o site inteiro depois — CSP mal feito quebra telas).
- O cabeçalho `Server`/versões não precisam aparecer (Baixo).

## Atualizações
- `unattended-upgrades` ligado (`/etc/apt/apt.conf.d/20auto-upgrades` com "1").
- Pacotes de segurança pendentes e `/var/run/reboot-required` (precisa reiniciar: combine horário).
- Node e Caddy: vêm de repositórios próprios (NodeSource, Ubuntu); confira se a versão não está muito
  atrasada.

## Serviço do Prumo
- `prumo.service` roda como usuário `prumo` (não root), com `NoNewPrivileges`, `ProtectSystem=strict`,
  `ReadWritePaths=/var/lib/prumo`. Rodar como root = Alto.
- `/etc/prumo/prumo.env`: dono root, grupo prumo, `640`. Legível por todos = Alto.

## Cópias de segurança
- Timer `prumo-copia.timer` ativo; última cópia em `/var/backups/prumo` com menos de 26 h.
- Cópia fora do servidor: última execução verde do workflow "Cópia diária do banco" no GitHub.
- Restauração já testada? Se nunca foi, recomende (Médio) testar num banco local:
  baixar o `.tar.gz`, `pg_restore` num PostgreSQL de teste, conferir contagens.
- `/var/backups/prumo` com `700`.
