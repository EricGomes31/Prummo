#!/usr/bin/env bash
# Cópia de segurança do Prumo na VPS: banco (pg_dump) + anexos, num .tar.gz em /var/backups/prumo.
# Instalado em /usr/local/sbin/prumo-copia. Roda todo dia pelo prumo-copia.timer e guarda 14 dias.
#   prumo-copia            faz uma cópia nova
#   prumo-copia --enviar   faz uma cópia nova e a escreve na saída (é o que o GitHub chama, pela chave
#                          restrita em /root/.ssh/authorized_keys, para guardar uma cópia fora do servidor)
# Restaurar: tar -xzf <arquivo> ; sudo -u postgres pg_restore --clean --if-exists -d prumo banco.dump ;
#            copiar uploads/ para /var/lib/prumo/uploads (dono prumo).
set -euo pipefail
PASTA=/var/backups/prumo
NOME=$(date +%Y-%m-%d-%H%M)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$PASTA"; chmod 700 "$PASTA"

sudo -u postgres pg_dump -Fc prumo > "$TMP/banco.dump"
cp -a /var/lib/prumo/uploads "$TMP/uploads"
tar -czf "$PASTA/$NOME.tar.gz" -C "$TMP" banco.dump uploads
chmod 600 "$PASTA/$NOME.tar.gz"
find "$PASTA" -maxdepth 1 -name '*.tar.gz' -mtime +14 -delete

if [ "${1:-}" = "--enviar" ]; then
  cat "$PASTA/$NOME.tar.gz"
else
  echo "Cópia: $PASTA/$NOME.tar.gz ($(du -h "$PASTA/$NOME.tar.gz" | cut -f1))"
fi
