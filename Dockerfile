# Imagem de produção: a API entrega também o frontend (ver WEB_DIST em api/src/server.ts).
FROM node:24-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-slim
# O motor do Prisma precisa do OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci
COPY api/prisma ./prisma
RUN npx prisma generate
COPY api/tsconfig.json ./
COPY api/src ./src
COPY --from=web /app/web/dist /app/web/dist

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    WEB_DIST=/app/web/dist \
    UPLOADS_DIR=/data/uploads
# As variáveis DATABASE_URL, DIRECT_URL e JWT_SECRET vêm do ambiente do provedor, não de um .env.
CMD ["node", "--import", "tsx", "src/server.ts"]
