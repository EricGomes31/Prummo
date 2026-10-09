# Andamento do Prumo

Registro do que foi feito até 09/10/2026 e de como retomar. O que falta está em `PENDENCIAS.md`; as regras de negócio e o modo de rodar estão no `README.md`.

## Situação

O Prumo está publicado e funcionando, com os dados do SG Nexus importados. Dos módulos do SG Nexus levantados na comparação, só falta um: **cartões e operadoras**. As funções menores que faltavam foram feitas e publicadas em 09/10/2026, menos as que dependem de serviço de mapas. O sistema ainda não substitui o SG Nexus no dia a dia porque faltam cadastros (usuários, fornecedores, contas bancárias) e alguns itens de segurança, listados no fim deste arquivo.

## Onde está cada coisa

| O quê | Onde |
|---|---|
| Sistema publicado | https://prumo-production-1731.up.railway.app |
| Hospedagem | Railway, projeto e serviço `prumo`, conta `labsinfinitys@gmail.com`, região US East. Volume `/data` para os anexos |
| Banco de dados | Supabase, projeto `nufzrlourvsxujwxwufn`, região São Paulo. É o mesmo banco para o ambiente local e para o publicado |
| Login do administrador | `admin@prumo.local`; a senha é `SEED_ADMIN_PASSWORD` no `api/.env` (trocada em 08/10/2026 por uma aleatória) |
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

Os importadores podem ser rodados de novo sem duplicar. Desde 09/10/2026 eles gravam na empresa informada e rodam pelo tsx: `npx tsx --env-file=.env scripts/importar-<x>.mjs --empresa=<id> ...` (sem `--empresa`, listam as empresas e param). Os arquivos JSON baixados ficaram em uma pasta temporária e não existem mais; para baixar de novo, use `api/scripts/sgnexus/baixar.mjs`, que explica no cabeçalho como abrir o Chrome e fazer o login.

### Módulos acrescentados ao Prumo

Nesta ordem, cada um com testes, conferência de tela e publicação:

1. **Campos do pedido:** vendedor, médico e paciente (pessoas do cadastro), natureza (venda, bonificação, perda) e desconto por item.
2. **Recebimento parcial e caixa e bancos:** baixas parciais, estorno, histórico, contas financeiras com saldo e extrato.
3. **Perfis de acesso:** permissões por função, perfis personalizados e dashboards liberados um a um. Eram 33 permissões; são 36 desde 09/10/2026.
4. **Devoluções e créditos:** devolução de itens com retorno ao estoque, crédito pelo valor líquido e uso do crédito em contas a receber.
5. **Logística:** rotas com sequência de paradas, motoristas, veículos, link público do entregador e histórico da entrega.
6. **Despesas:** lançamento à vista ou a prazo, que gera as contas a pagar, com anexos.
7. **Conciliação bancária:** importação de extrato OFX, sugestões por pontuação, cinco formas de resolver cada linha e conciliação automática.

### Várias empresas

Feito em 08/10/2026. O Prumo deixa de ser de uma empresa só: cada empresa vê apenas os próprios dados, no mesmo banco.

- Tabela `Empresa` e campo `empresaId` em todas as tabelas. SKU, código de barras, placa, nome do perfil e nome da conta financeira são únicos dentro de cada empresa; o e-mail do usuário continua único no sistema todo, porque o login não pergunta a empresa.
- `api/src/empresa.ts`: cada requisição guarda a empresa do usuário, e o cliente do Prisma acrescenta a empresa em toda consulta e gravação, inclusive nas aninhadas. Consulta sem empresa definida é recusada. Para o que precisa ver todas (login, sessão, link do entregador, administração), há `semEmpresa`.
- `api/prisma/empresas.sql`: gatilhos no banco recusam ligar um registro a outro de empresa diferente, e o valor padrão do `empresaId` falha se a empresa não for informada. Roda junto com o `npm run db:rls`.
- Administrador do sistema (`Usuario.sistema`, hoje só o `admin@prumo.local`): tela Sistema → Empresas, onde cria a empresa já com o administrador dela e a conta Caixa, e ativa ou desativa empresas. Empresa inativa não entra, e as sessões abertas caem na próxima chamada.
- A suíte `empresas` (40 verificações) confere o isolamento pela API e direto no banco.
- Para o banco que já tinha dados: `api/prisma/migracoes/2026-10-08-empresas.sql` (roda uma vez, antes do `db:push`) cria a empresa "Infinity Labs" e atribui a ela tudo o que existia. Cópia de segurança antes: `api/scripts/copiar-banco.mjs`, que grava em `backups/` (fora do Git).

### Numeração dos pedidos por empresa

Feito em 09/10/2026, **ainda não aplicado ao banco real nem publicado**. Cada empresa numera os próprios pedidos a partir do 1.

- `Pedido.numero`, único dentro da empresa, é o número que as telas mostram; o `id` continua interno (endereços da API, ligações entre tabelas). O contador fica em `Empresa.ultimoPedido`, incrementado na mesma transação que cria o pedido, o que impede dois pedidos com o mesmo número.
- A descrição das parcelas ("Pedido nº …"), os relatórios, as entregas, o link do entregador, as devoluções e as movimentações de estoque (`origemNumero`) usam o número.
- Banco que já tem pedidos: `api/prisma/migracoes/2026-10-09-numero-pedido.sql`, **antes** do `db:push`. Os pedidos existentes ficam com o número igual ao id (o que já aparecia) e a contagem continua do maior.
- Importadores (`api/scripts/empresa.mjs`): usam o cliente do Prisma da API, com a empresa de `--empresa`. O número do pedido do SG Nexus vira o número no Prumo; se o número já for de outro pedido (outro cliente ou outro total), a importação para com aviso. A suíte `importadores` roda os quatro scripts de verdade numa segunda empresa.

### Funções que faltavam do SG Nexus

Feito, aplicado ao banco real e publicado em 09/10/2026. Estrutura nova no banco: condição de pagamento no `Pedido`, `Devolucao.estornada`, origem e cancelamento no `Credito`, estorno no `CreditoUso`, hora e transferência no `MovimentoFinanceiro`, acessos do link na `Rota` e link de cadastro na `Pessoa`. Os dados antigos são ajustados por `api/prisma/migracoes/2026-10-09-funcoes.sql`. Permissões novas: alterar pedido faturado, lançar crédito avulso e lançar no caixa (36 no total).

- **Pedidos:** forma, parcelas e primeiro vencimento já no pedido (nova forma: cartão por link); faturar usa o que foi escolhido e aceita créditos do cliente, que abatem as parcelas. Pedido faturado pode ser alterado: cadastro muda direto; itens, valores ou pagamento refazem o faturamento (estoque volta com origem `ALTERACAO`, parcelas em aberto são substituídas), desde que nada tenha sido recebido, devolvido ou esteja em rota. Anexos na tela do pedido. A campanha bloqueia o desconto manual só nos produtos dela; o desconto no total continua bloqueado.
- **Despesas:** à vista pode ser paga no lançamento (exige a permissão de pagar contas); fornecedor cadastrado numa janela por cima do lançamento; lista exportada para o Excel; despesas no dashboard financeiro e no relatório novo, por elemento e por competência.
- **Caixa e bancos:** lançamento avulso e transferência entre contas, ambos estornáveis; lista de bancos (`web/src/bancos.ts`); CPF ou CNPJ do titular obrigatório e validado nas contas que não são o caixa; saldo inicial negativo; baixa com data e hora.
- **Conciliação:** "Desfazer" numa linha conciliada estorna o que a conciliação lançou (ou só desliga o vínculo) e cancela o crédito do depósito a maior, se não foi usado; uma linha baixa vários títulos; transferência entre contas como resolução, com a outra ponta sugerida para vínculo quando o extrato da outra conta chega. A baixa conciliada não se estorna mais pela conta, só desfazendo a linha.
- **Contas a receber:** filtros por cliente, vendedor, médico, paciente e vencimento; relatório de cobrança por cliente e por conta, com Excel e impressão em PDF pelo navegador (`web/src/relatorio.tsx`, compartilhado com Relatórios).
- **Devoluções e créditos:** estorno do uso do crédito e da devolução (o estoque volta a sair; exige o crédito intacto); crédito avulso, cancelável enquanto não usado. As devoluções abatem faturamento, custo, margem e rankings no dia em que foram registradas, e o total do Início.
- **Dashboards:** período por mês, por ano ou todo o período. A resposta da API passou a ter `periodo`, `detalhe` e `historico` no lugar de `mes`, `dias` e `meses`.
- **Logística:** documentos da entrega (o entregador envia foto ou PDF pelo link); a rota registra quando o link foi aberto e quantos acessos teve, com aviso nas notificações.
- **Links públicos:** quem erra a chave 10 vezes em 15 minutos fica bloqueado (`api/src/limite.ts`, em memória). Publicada, a API lê o IP pelo proxy da hospedagem. Link para a pessoa atualizar o próprio cadastro (`/cadastro/:id`), gerado em Pessoas, válido uma vez por 7 dias; o hash nunca sai nas respostas (omitido no cliente do Prisma).

### Visual e uso no celular

Feito em 08/10/2026, quase todo em arquivos compartilhados, sem mexer em cada tela. A identidade é preto, branco e cinzas, com cor só para situação e alerta, e fonte Inter (embutida pelo pacote `@fontsource-variable/inter`).

- `web/src/styles.css`: as medidas e cores ficam nas variáveis do topo; os pontos de quebra são 1100, 900, 640 e 340 px.
- `web/src/Layout.tsx` e `web/src/icones.tsx`: menu lateral escuro com ícones e grupos, que recolhe para só os ícones (a escolha fica no navegador) e vira gaveta abaixo de 900 px. A barra superior tem a trilha da tela, a busca de telas (Ctrl K), as notificações (os mesmos alertas do Início) e o menu da conta.
- `web/src/avisos.tsx`: avisos rápidos no canto da tela. Toda gravação que dá certo confirma sozinha, pela função `confirmar` em `web/src/api.ts`.
- `web/src/ui.tsx`: esqueleto de carregamento nas listas e `usePaginacao`, já usada em Pessoas, Produtos e Pedidos (25 por página).
- `web/src/tabelas.ts`: no celular, toda tabela com quatro colunas ou mais vira uma lista de cartões. Vale automaticamente para tabelas novas, desde que tenham `<thead>`.
- Transições: cada tela entra com um leve deslize (bloco `.pagina` no `Layout.tsx`), o conteúdo aparece esmaecendo e uma barra no topo acompanha as chamadas à API (`useCarregando` em `web/src/api.ts`). As animações ficam no começo do `styles.css` e respeitam a preferência do sistema por menos movimento.

Para conferir telas sem tocar nos dados reais, suba uma instância com PostgreSQL descartável, como o executor dos testes faz (`api/tests/rodar.mjs`), e aponte o Vite para ela com a variável `API_URL`.

### Testes

A API tem 24 suítes com 668 verificações (`cd api`, depois `npm test`). Elas sobem um PostgreSQL descartável e nunca usam o banco do `.env`. O frontend não tem testes automatizados; cada tela nova foi conferida no navegador, sem gravar nos dados reais.

O PostgreSQL descartável se recusa a rodar num terminal aberto como administrador ("Execution of PostgreSQL by a user with administrative permissions is not permitted"); nesse caso o `npm test` termina logo depois de "Preparando o banco de teste…". Rode num terminal comum, ou com privilégio reduzido: `runas /trustlevel:0x20000 "cmd /c cd /d <pasta>\api && npm test > saida.txt 2>&1"`.

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
- **O código está no Git desde 08/10/2026.** Repositório privado `github.com/labsinfinitys-svg/Prumo`, branch `main`. Faça um commit ao concluir cada etapa (`git add -A`, `git commit -m "..."`, `git push`). O envio ao GitHub não publica o sistema: a publicação continua por `railway up`.
- **Sessão do Railway.** Se a CLI pedir login de novo, rode `railway login` e confirme no navegador.

## Próximos passos, na ordem sugerida

1. **Segurança, antes de qualquer uso real:** redefinir a senha do banco no Supabase. A senha do administrador já foi trocada.
2. **Cadastros que destravam o uso:** usuários de Douglas e Lethícia, fornecedores e prestadores, contas bancárias com o número da conta, e as classificações de vendedor, médico e paciente nas pessoas.
3. **Cartões e operadoras:** o último módulo do SG Nexus que falta (liquidações, taxas e prazo de recebimento).
4. **Testar a conciliação com um extrato OFX real** dos bancos usados.
5. **Decidir a hospedagem definitiva** (VPS em São Paulo ou banco em East US) e apontar o subdomínio.
6. **Separar o banco de desenvolvimento.**
7. Os acabamentos e as funções menores do `PENDENCIAS.md`.
