# Andamento do Prumo

Registro do que foi feito até 08/10/2026 e de como retomar. O que falta está em `PENDENCIAS.md`; as regras de negócio e o modo de rodar estão no `README.md`.

## Situação

O Prumo está publicado e funcionando, com os dados do SG Nexus importados. Dos módulos do SG Nexus levantados na comparação, só falta um: **cartões e operadoras**. O sistema ainda não substitui o SG Nexus no dia a dia porque faltam cadastros (usuários, fornecedores, contas bancárias) e alguns itens de segurança, listados no fim deste arquivo.

## Onde está cada coisa

| O quê | Onde |
|---|---|
| Sistema publicado | https://prumo-production-1731.up.railway.app |
| Hospedagem | Railway, projeto e serviço `prumo`, conta `labsinfinitys@gmail.com`, região US East. Volume `/data` para os anexos |
| Banco de dados | Supabase, projeto `nufzrlourvsxujwxwufn`, região São Paulo. É o mesmo banco para o ambiente local e para o publicado |
| Login do administrador | `admin@prumo.local`; a senha é `SEED_ADMIN_PASSWORD` no `api/.env` (ainda é a inicial) |
| Sistema de origem | https://infinitylabs.sgnexus.com.br (SG Nexus), API em `sg-nexus-infinitylabs-api.onrender.com` |
| Domínio da empresa | `labsinfinity.com.br`, DNS na Cloudflare. O site atual fica na HostGator, que não roda Node |

## O que foi feito

### Infraestrutura

- Banco trocado de SQLite para PostgreSQL no Supabase, com RLS em todas as tabelas (`api/prisma/rls.sql`, encadeado no `npm run db:push`).
- A API passou a entregar também o frontend em produção (`WEB_DIST`), em um serviço único, com `Dockerfile` e `railway.json`.
- Publicação no Railway, com as variáveis de ambiente e o volume dos anexos.
- Instalados na máquina: Ghidra 12.1.4, JDK 21 e a CLI do Railway. As skills `reverse-engineer-anything` e as duas do Supabase estão em `.claude/skills`.

### Dados importados do SG Nexus

| Dado | Quantidade | Importador |
|---|---|---|
| Pessoas (todas clientes) | 202 | `api/scripts/importar-pessoas.mjs` |
| Produtos, com unidades e saldo de estoque | 20 | `api/scripts/importar-produtos.mjs` |
| Pedidos faturados, com os mesmos números (#2 a #5) | 4 | `api/scripts/importar-vendas.mjs` |
| Contas a receber, em aberto (R$ 4.249,95) | 4 | `api/scripts/importar-vendas.mjs` |
| Entregas pendentes | 2 | `api/scripts/importar-vendas.mjs` |
| Motoristas e veículo | 2 e 1 | `api/scripts/importar-logistica.mjs` |

Os importadores podem ser rodados de novo sem duplicar. Os arquivos JSON baixados ficaram em uma pasta temporária e não existem mais; para baixar de novo, use `api/scripts/sgnexus/baixar.mjs`, que explica no cabeçalho como abrir o Chrome e fazer o login.

### Módulos acrescentados ao Prumo

Nesta ordem, cada um com testes, conferência de tela e publicação:

1. **Campos do pedido:** vendedor, médico e paciente (pessoas do cadastro), natureza (venda, bonificação, perda) e desconto por item.
2. **Recebimento parcial e caixa e bancos:** baixas parciais, estorno, histórico, contas financeiras com saldo e extrato.
3. **Perfis de acesso:** permissões por função, perfis personalizados e dashboards liberados um a um. Hoje são 33 permissões.
4. **Devoluções e créditos:** devolução de itens com retorno ao estoque, crédito pelo valor líquido e uso do crédito em contas a receber.
5. **Logística:** rotas com sequência de paradas, motoristas, veículos, link público do entregador e histórico da entrega.
6. **Despesas:** lançamento à vista ou a prazo, que gera as contas a pagar, com anexos.
7. **Conciliação bancária:** importação de extrato OFX, sugestões por pontuação, cinco formas de resolver cada linha e conciliação automática.

### Testes

A API tem 17 suítes com 469 verificações (`cd api`, depois `npm test`). Elas sobem um PostgreSQL descartável e nunca usam o banco do `.env`. O frontend não tem testes automatizados; cada tela nova foi conferida no navegador, sem gravar nos dados reais.

## Como retomar

```powershell
# API (porta 3333) e frontend (porta 5173), em dois terminais
cd api; npm run dev
cd web; npm run dev

# Depois de mudar o api/prisma/schema.prisma (atenção: altera o banco real)
cd api; npx prisma db push --skip-generate; npx prisma generate; npm run db:rls

# Conferir antes de publicar
cd api; npm run typecheck; npm test
cd web; npm run build

# Publicar (na raiz do projeto)
railway up --service prumo --ci
```

Cuidados ao retomar:

- **O banco é um só.** Toda mudança de estrutura e todo cadastro feito localmente caem nos dados reais e aparecem no site publicado.
- **Pare a API antes do `prisma generate`.** No Windows, a API em execução segura o arquivo do Prisma e o comando falha com `EPERM`.
- **Ainda não há histórico de versões.** O Git está instalado e a pasta é um repositório ligado a `github.com/labsinfinitys-svg/Prumo` (privado), mas sem nenhum commit. Até o primeiro commit, um erro em um arquivo não tem como ser desfeito por comando.
- **Sessão do Railway.** Se a CLI pedir login de novo, rode `railway login` e confirme no navegador.

## Próximos passos, na ordem sugerida

1. **Segurança, antes de qualquer uso real:** trocar a senha do administrador e redefinir a senha do banco no Supabase.
2. **Cadastros que destravam o uso:** usuários de Douglas e Lethícia, fornecedores e prestadores, contas bancárias com o número da conta, e as classificações de vendedor, médico e paciente nas pessoas.
3. **Cartões e operadoras:** o último módulo do SG Nexus que falta (liquidações, taxas e prazo de recebimento).
4. **Testar a conciliação com um extrato OFX real** dos bancos usados.
5. **Decidir a hospedagem definitiva** (VPS em São Paulo ou banco em East US) e apontar o subdomínio.
6. **Separar o banco de desenvolvimento** e fazer o primeiro commit no Git.
7. Os acabamentos e as funções menores do `PENDENCIAS.md`.
