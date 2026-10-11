#!/usr/bin/env bash
# Faz o api/.env.producao apontar para o banco real na VPS, pelo túnel do api/scripts/com-tunel.mjs (127.0.0.1:15433).
# Copia DATABASE_URL e DIRECT_URL do /etc/prumo/prumo.env do servidor sem mostrá-las na tela. O arquivo antigo
# (Supabase) fica em api/.env.supabase até o projeto ser apagado. Rodar uma vez, na raiz do projeto, no Git Bash:
#   bash scripts/env-producao-vps.sh
set -euo pipefail
SERVIDOR=${SERVIDOR:-root@179.236.68.14}
CHAVE=${CHAVE:-$HOME/.ssh/prumo_vps}
DESTINO=api/.env.producao

if [ -f "$DESTINO" ] && ! grep -q '127.0.0.1:15433' "$DESTINO" && [ ! -f api/.env.supabase ]; then
  cp "$DESTINO" api/.env.supabase
  echo "O .env.producao antigo (Supabase) foi guardado em api/.env.supabase."
fi

NOVO=$(ssh -i "$CHAVE" -o BatchMode=yes "$SERVIDOR" "grep -E '^(DATABASE_URL|DIRECT_URL)=' /etc/prumo/prumo.env" \
  | sed -E 's#@[^/@]*/#@127.0.0.1:15433/#')
if [ "$(printf '%s\n' "$NOVO" | grep -c '@127.0.0.1:15433/')" -lt 1 ]; then
  echo "Não achei DATABASE_URL no /etc/prumo/prumo.env da VPS. Nada foi alterado."
  exit 1
fi
# Sem DIRECT_URL no servidor, a conexão direta é a mesma.
if ! printf '%s\n' "$NOVO" | grep -q '^DIRECT_URL='; then
  NOVO="$NOVO"$'\n'"$(printf '%s\n' "$NOVO" | sed -n 's/^DATABASE_URL=/DIRECT_URL=/p')"
fi
{
  echo "# Banco real na VPS, pelo túnel SSH: rode os comandos com 'npm run vps -- <comando>' (api/scripts/com-tunel.mjs)."
  printf '%s\n' "$NOVO"
} > "$DESTINO"
chmod 600 "$DESTINO"
echo "Pronto: $DESTINO aponta para o banco da VPS. Para conferir: cd api; npm run vps -- node --env-file=.env.producao scripts/copiar-banco.mjs"
