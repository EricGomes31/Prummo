#!/usr/bin/env bash
# Publica na VPS o último commit (HEAD), não o que está só no disco. Rodar na raiz do projeto, no Git Bash:
#   bash scripts/publicar-vps.sh
# Envia o código, monta o site e a API no servidor (infra/vps/instalar-versao.sh) e troca a versão no ar.
set -euo pipefail
SERVIDOR=${SERVIDOR:-root@179.236.68.14}
CHAVE=${CHAVE:-$HOME/.ssh/prumo_vps}
VERSAO=$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)
DESTINO=/opt/prumo/versoes/$VERSAO
ssh_vps() { ssh -i "$CHAVE" -o BatchMode=yes "$SERVIDOR" "$@"; }

if [ -n "$(git status --porcelain)" ]; then
  echo "Aviso: há alterações não commitadas; só o commit $(git rev-parse --short HEAD) vai para o servidor."
fi
echo "== Enviando $VERSAO"
ssh_vps "mkdir -p $DESTINO"
git archive --format=tar HEAD | ssh_vps "tar -x -C $DESTINO"
ssh_vps "bash $DESTINO/infra/vps/instalar-versao.sh $DESTINO"
