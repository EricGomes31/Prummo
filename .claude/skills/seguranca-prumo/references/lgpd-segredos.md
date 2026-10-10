# LGPD e segredos

## Dados pessoais no Prumo
- Pessoas: nome, CPF/CNPJ, telefones, e-mail, endereço; pacientes e médicos ligados a vendas — dado de
  saúde é **dado sensível** na LGPD (art. 11), exige cuidado maior.
- Perguntas que o relatório deve responder:
  - Quem vê esses dados? (perfis com `PESSOAS_VISUALIZAR`; usuários ativos por empresa)
  - Usuários de quem saiu da empresa estão desativados?
  - Os dados saem do sistema por onde? Exportações em Excel/relatórios, cópias de segurança (GitHub, 30
    dias), pasta `levantamento-sgnexus/` e `backups/` no computador de trabalho (fora do Git — confira o
    `.gitignore` e se não há cópia em nuvem pública).
  - Existe como atender um pedido do titular (ver, corrigir, apagar os dados de uma pessoa)?
  - Por quanto tempo as cópias guardam dados (14 dias no servidor, 30 no GitHub)?
- Recomendações típicas (sem juridiquês): registro de quem acessou/alterou cadastros, política simples de
  privacidade para as empresas clientes, contrato com elas dizendo quem é controlador e operador.
  Não é parecer jurídico — diga isso quando tocar em obrigação legal.

## Segredos
- Inventário (sem mostrar valores): `JWT_SECRET` e senha do banco (`/etc/prumo/prumo.env`), chave SSH
  `~/.ssh/prumo_vps`, segredo `VPS_CHAVE_COPIA` no GitHub, `api/.env` (local) e `api/.env.producao`
  (Supabase antigo), contas Hostinger, GitHub, Railway, Supabase, SG Nexus.
- Nenhum segredo no Git: `git log -p` / `git grep` por padrões (`postgresql://`, `JWT_SECRET=`,
  `BEGIN OPENSSH`, `password`). Segredo que já foi para o GitHub precisa ser **trocado**, não só apagado do
  histórico.
- Segredos que já apareceram em conversa ou em arquivo compartilhado = trocar (veja o `PENDENCIAS.md`:
  houve senha do SG Nexus e do Supabase digitadas em conversa).
- Força: `JWT_SECRET` ≥ 32 bytes aleatórios; senha do banco aleatória; contas dos painéis com
  verificação em duas etapas (Hostinger, GitHub, Railway, Supabase) — pergunte ao usuário, não dá para
  conferir daqui.
- Serviços antigos (Railway, Supabase) ainda com dados reais: cópia guardada? Data para apagar?
