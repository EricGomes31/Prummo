-- Histórico do pedido (09/10/2026): tabela nova, vazia; nada existente muda. Rode uma vez e depois
-- "npm run db:rls" (liga o RLS na tabela nova e as travas de empresa nas chaves dela):
--   npx prisma db execute --file prisma/migracoes/2026-10-09-historico-pedido.sql --schema prisma/schema.prisma
-- CreateTable
CREATE TABLE "PedidoHistorico" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT (current_setting('prumo.empresa'::text))::integer,
    "pedidoId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "motivo" TEXT,
    "totalAnterior" INTEGER,
    "totalNovo" INTEGER,
    "usuarioId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedidoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PedidoHistorico_pedidoId_idx" ON "PedidoHistorico"("pedidoId");

-- CreateIndex
CREATE INDEX "PedidoHistorico_empresaId_idx" ON "PedidoHistorico"("empresaId");

-- AddForeignKey
ALTER TABLE "PedidoHistorico" ADD CONSTRAINT "PedidoHistorico_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoHistorico" ADD CONSTRAINT "PedidoHistorico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

