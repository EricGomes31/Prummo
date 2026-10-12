# Especificações técnicas do Prumo

Ficha técnica do sistema: com o que foi feito, onde roda e como os dados são guardados. Atualizada em 11/10/2026. Como rodar e publicar está no `README.md`; o histórico, no `ANDAMENTO.md`; o que falta, no `PENDENCIAS.md`.

## Resumo

| Item | Especificação |
|---|---|
| O que é | ERP web de vendas, estoque, financeiro e logística, feito para substituir o SG Nexus |
| Endereço | https://prummo.tech (o `www` e o endereço antigo do Railway levam para ele) |
| Servidor | VPS Hostinger KVM 1, São Paulo, IP 179.236.68.14, Ubuntu 24.04 |
| Banco de dados | PostgreSQL 16, na própria VPS, sem acesso pela internet |
| Linguagem | TypeScript no site e na API (Node.js 24) |
| Código | GitHub, repositório privado `labsinfinitys-svg/Prumo`, branch `main` |

## Stack

### Frontend (`web/`)

| Tecnologia | Versão | Para quê |
|---|---|---|
| React | 19.3 | Telas |
| React Router | 7.18 | Navegação entre as telas |
| Vite | 8.3 | Servidor de desenvolvimento e montagem do site |
| TypeScript | 7.0 | Tipagem |
| Inter (Fontsource) | 5.3 | Fonte, servida pelo próprio site |

O visual é CSS próprio (`web/src/styles.css`), sem biblioteca de componentes. Os gráficos (`graficos.tsx`) e os ícones (`icones.tsx`) também são próprios. As tabelas viram cartões no celular. São 19 telas em `web/src/pages`, inclusive a tela de rota do entregador e o link público de atualização de cadastro.

### API (`api/`)

| Tecnologia | Versão | Para quê |
|---|---|---|
| Node.js | 24 | Execução |
| Fastify | 5.12 | Servidor HTTP e rotas |
| @fastify/jwt | 10.2 | Login por token (JWT) |
| @fastify/cors e @fastify/static | 11.3 e 10.1 | CORS e entrega do site pela própria API |
| Prisma | 6.19 | Acesso ao banco e esquema das tabelas |
| Zod | 4.6 | Validação dos dados recebidos |
| bcryptjs | 3.0 | Senhas guardadas com hash |
| tsx | 4.23 | Roda o TypeScript direto, sem etapa de compilação |

São 17 grupos de rotas em `api/src/routes`: pessoas, produtos, promoções, pedidos, entradas, devoluções, financeiro, despesas, conciliação, documentos, entregas, logística, relatórios, dashboards, usuários e empresas. Em produção, a API também entrega o site montado (`WEB_DIST`), então tudo funciona como um serviço único.

### Banco de dados

- **PostgreSQL 16**, com 30 tabelas definidas em `api/prisma/schema.prisma`.
- **Várias empresas no mesmo banco:** cada registro pertence a uma empresa, e a API acrescenta a empresa em toda consulta e gravação (`api/src/empresa.ts`). Travas no próprio banco reforçam isso (`api/prisma/empresas.sql`).
- **RLS** (segurança por linha) ligado em todas as tabelas (`api/prisma/rls.sql`).
- **Mudanças de estrutura** viram arquivos SQL em `api/prisma/migracoes` e são aplicadas à mão, sempre com cópia de segurança antes. A publicação se recusa a subir uma versão se o banco não estiver igual ao esquema.

### Testes

- 34 arquivos de teste em `api/tests`: são testes de ponta a ponta da API, rodados por `npm test`.
- Cada suíte usa um PostgreSQL descartável, criado na hora (`embedded-postgres`). Os testes nunca tocam no banco real nem no local.
- O frontend ainda não tem testes automatizados.

## Servidor (VPS)

| Item | Especificação |
|---|---|
| Plano | Hostinger KVM 1, data center em São Paulo |
| Sistema | Ubuntu 24.04, fuso de Brasília, atualizações de segurança automáticas |
| Memória extra | Swap de 2 GB |
| Servidor web | Caddy 2.6: HTTPS automático (Let's Encrypt), compressão e cabeçalhos de segurança, inclusive CSP (`infra/vps/Caddyfile`) |
| Aplicação | Serviço `prumo` do systemd, rodando com o usuário `prumo`, sem privilégios e só com permissão de escrita na pasta de anexos (`infra/vps/prumo.service`) |
| Firewall | Só as portas 22 (SSH), 80 e 443 abertas |
| Acesso | Só por chave SSH (`~/.ssh/prumo_vps`, nesta máquina); senha recusada; fail2ban contra tentativas repetidas |
| Domínio | `prummo.tech`, registrado na Hostinger, válido até 09/10/2027 |

Pastas no servidor:

| Pasta | Conteúdo |
|---|---|
| `/opt/prumo/versoes` | As 5 últimas versões publicadas |
| `/opt/prumo/atual` | Atalho para a versão no ar |
| `/etc/prumo/prumo.env` | Configuração e segredos (banco, chave do login); só existe no servidor |
| `/var/lib/prumo/uploads` | Anexos (documentos enviados) |
| `/var/backups/prumo` | Cópias de segurança diárias |

## Publicação

- Comando: `bash scripts/publicar-vps.sh`, na raiz do projeto, no Git Bash.
- O script envia o **último commit** (não o que está só no disco), monta o site e a API no servidor, confere o banco e troca a versão.
- Se a versão nova não responder em 30 segundos, ele volta sozinho para a anterior (`infra/vps/instalar-versao.sh`).
- Enviar o código ao GitHub não publica nada.

## Cópias de segurança

| Onde | Quando | Guarda | O que leva |
|---|---|---|---|
| Na própria VPS (`prumo-copia`) | Todo dia, 02:30 | 14 dias | Banco (pg_dump) e anexos |
| GitHub Actions (`.github/workflows/copia-diaria.yml`) | Todo dia, 03:00 | 30 dias | A mesma cópia, buscada na VPS por uma chave que só consegue fazer isso |
| Nesta máquina (`backups/`, fora do Git) | Quando se roda a cópia | Até ser apagada | Todas as tabelas em JSON |

O modo de restaurar está no cabeçalho de `infra/vps/copia.sh`.

## Ambientes

| Ambiente | Banco | Como acessar |
|---|---|---|
| Produção | PostgreSQL da VPS | O site, em https://prummo.tech. Daqui, só pelo túnel SSH: `npm run vps -- <comando>`, com o `api/.env.producao` |
| Desenvolvimento | PostgreSQL local, porta 5433 (`npm run banco`) | API na porta 3333 e site na 5173, com o `api/.env` |
| Testes | PostgreSQL descartável, um por suíte | `npm test`, dentro de `api/` |

O `npm run banco:copiar` traz uma cópia do banco real para o local. O script que carrega essa cópia se recusa a gravar em qualquer banco que não seja o local, inclusive no túnel.

## Segurança

- Login com senha guardada em hash (bcrypt) e token JWT.
- Limite de tentativas: 5 senhas erradas por e-mail e IP, ou 20 por IP, bloqueiam por 15 minutos (`api/src/limite.ts`).
- Os links públicos (atualização de cadastro, rota do entregador) também têm limite de tentativas.
- Perfis de acesso com permissões por função (`api/src/permissoes.ts`).
- O banco não fica exposto na internet.
- O HTTPS é obrigatório (HSTS), com política de conteúdo (CSP) que só permite o próprio site e o ViaCEP.
- Segredos ficam fora do Git: `api/.env`, `api/.env.producao` e `/etc/prumo/prumo.env` no servidor.

## Serviços externos

| Serviço | Uso |
|---|---|
| ViaCEP | Preenche rua, bairro e cidade a partir do CEP |
| GitHub | Código e cópia diária fora do servidor |
| Hostinger | VPS e domínio |
| Railway e Supabase | Hospedagem antiga, parada desde 09/10/2026. Fica como garantia até 16/10/2026 e depois será apagada. O `Dockerfile` e a pasta `.railway/` são dessa época |
