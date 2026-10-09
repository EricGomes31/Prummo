#!/usr/bin/env bash
# Roda NA VPS, como root, chamado pelo scripts/publicar-vps.sh: monta a versão enviada, confere o banco,
# troca a versão no ar e volta para a anterior se a nova não responder.
# Uso: bash instalar-versao.sh /opt/prumo/versoes/<versao>
set -euo pipefail
VERSAO=$1
ANTERIOR=$(readlink -f /opt/prumo/atual || true)
set -a; . /etc/prumo/prumo.env; set +a

echo "== Montando o site"
cd "$VERSAO/web"
npm ci --no-audit --no-fund --loglevel=error
npm run build >/dev/null

echo "== Instalando a API"
cd "$VERSAO/api"
npm ci --no-audit --no-fund --loglevel=error
npx prisma generate >/dev/null

# Mudanças de estrutura do banco nunca são aplicadas aqui: rodam antes, de propósito, com cópia de segurança.
echo "== Conferindo o banco"
if ! npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma --exit-code >/tmp/prumo-diff.txt 2>&1; then
  cat /tmp/prumo-diff.txt
  echo "O banco não está igual ao esquema desta versão. Aplique a migração antes de publicar. Nada foi trocado."
  exit 1
fi

echo "== Trocando a versão no ar"
ln -sfn "$VERSAO" /opt/prumo/atual
systemctl restart prumo
for i in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:${PORT}/api/saude" >/dev/null; then
    echo "No ar: $(basename "$VERSAO")"
    # Guarda só as 5 versões mais recentes.
    ls -1dt /opt/prumo/versoes/*/ | tail -n +6 | xargs -r rm -rf
    exit 0
  fi
  sleep 1
done

echo "A versão nova não respondeu; voltando para a anterior."
journalctl -u prumo -n 30 --no-pager
if [ -n "$ANTERIOR" ] && [ "$ANTERIOR" != "$VERSAO" ]; then
  ln -sfn "$ANTERIOR" /opt/prumo/atual
  systemctl restart prumo
fi
exit 1
