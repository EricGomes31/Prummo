# Prumo

ERP web com vendas, estoque e financeiro. O nome e a identidade visual são provisórios e ficam em `web/index.html`, `web/src/Layout.tsx` (componente `Marca`) e nas variáveis de cor no topo de `web/src/styles.css`.

## Estrutura

- `api/` — API REST em Node, Fastify e Prisma. Banco PostgreSQL no Supabase.
- `web/` — Frontend em React, Vite e TypeScript.

## Como rodar

Requer Node 22 ou mais novo.

```powershell
# 1. API (porta 3333)
cd api
npm install
npm run setup   # cria o .env e para: preencha DATABASE_URL e DIRECT_URL com as URLs do Supabase
npm run setup   # cria as tabelas e o usuário administrador
npm run dev

# 2. Frontend (porta 5173), em outro terminal
cd web
npm install
npm run dev
```

### Banco de desenvolvimento

No dia a dia a API local usa um PostgreSQL nesta máquina, não o banco real: o `api/.env` aponta para ele (`127.0.0.1:5433`) e os endereços do banco real ficam só no `api/.env.producao` (fora do Git).

```powershell
cd api
npm run banco          # sobe o banco local e atualiza as tabelas; deixe o terminal aberto
npm run banco:copiar   # em outro terminal: copia o banco real (só leitura) e carrega no local
```

O `banco:copiar` grava a cópia em `backups/` e apaga o que houver no banco local antes de carregar. O script de carga se recusa a escrever em qualquer banco que não seja desta máquina. Scripts que devem mexer no banco real (cópia de segurança, migrações, importadores) recebem `--env-file=.env.producao` de propósito.

Abra http://localhost:5173 e entre com `admin@prumo.local`. A senha inicial foi gerada pelo setup e está em `api/.env`, na variável `SEED_ADMIN_PASSWORD`. Troque-a em "Alterar senha" no primeiro acesso.

## Testes

```powershell
cd api
npm test                 # todas as suítes
npm test -- unidades     # só as suítes com "unidades" no nome
npm test -- --detalhe    # mostra cada verificação, não só as falhas
```

São testes de ponta a ponta da API, em `api/tests`. O executor (`tests/rodar.mjs`) sobe um PostgreSQL local e descartável (pacote `embedded-postgres`, sem Docker), cria as tabelas, e dá a cada suíte um banco novo e uma API própria. **Os testes nunca usam o banco do `.env`**: as suítes criam e cancelam registros e se recusam a rodar fora do executor.

O que os testes não cobrem: o frontend e o que é próprio do Supabase (o pool de conexões da porta 6543 e o acesso pela API REST dele, que o RLS bloqueia).

## O que a fase 1 cobre

| Módulo | Funções |
|---|---|
| Início | Indicadores de vendas, contas, saldo projetado e estoque; últimos pedidos; produtos no mínimo |
| Pessoas | Cadastro único com seis classificações (cliente, fornecedor, prestador de serviço, paciente, médico, vendedor), busca, preenchimento de endereço por CEP e exclusão de cadastros sem uso |
| Produtos e estoque | Cadastro com EAN, unidade base e opção de não controlar estoque (serviços); preços, saldo, ajuste de inventário, histórico de movimentações |
| Entradas de estoque | Compra para revenda ou bonificação, com fornecedor, condição de pagamento (gera as parcelas a pagar), frete, outras despesas e CFOP; busca de produto por código, descrição ou EAN |
| Pedidos e vendas | Pedido em aberto, faturamento com parcelas, cancelamento com devolução de estoque; vendedor, médico e paciente do cadastro de pessoas; natureza (venda, bonificação, perda); desconto por item e no total |
| Devoluções e créditos | Devolução de itens de venda faturada, com retorno ao estoque e crédito pelo valor líquido; uso do crédito para baixar contas a receber do cliente, médico, vendedor ou paciente da venda |
| Logística e entregas | Entrega programada a partir de pedido faturado, entregador, saída, confirmação, falha e reprogramação, com histórico; link de mapa e WhatsApp. Rotas com motorista, veículo e sequência de paradas, e link para o entregador registrar as entregas pelo celular |
| Promoções | Campanhas com vigência em cinco modalidades (percentual, preço promocional, leve e pague, combo, brinde), aplicadas no pedido com prévia do desconto |
| Documentos | Anexos por registro (hoje ligados à entrada de estoque): enviar, listar, baixar e remover; até 10 MB, tipos restritos |
| Financeiro | Contas a receber e a pagar: lançar, baixar no todo ou em parte, estornar, cancelar, com histórico das baixas. Caixa e bancos: contas financeiras com saldo e extrato de entradas e saídas. Despesas por fornecedor e elemento, à vista ou a prazo, que geram as contas a pagar, com anexos. Conciliação bancária: importação do extrato em OFX, sugestões por pontuação, baixa de título, vínculo com movimento já lançado, lançamento avulso, depósito a maior e conciliação automática |
| Dashboards | Comercial (faturamento, ticket, custo, margem, vendas por dia, evolução, rankings) e financeiro (recebido, pago, vencidos, formas de pagamento), por mês |
| Relatórios | Vendas e financeiro com filtros por período, situação e busca; resumo, colunas ordenáveis e exportação para Excel (CSV) |
| Usuários e perfis | Usuários com perfil de fábrica (administrador ou operador) ou perfil de acesso personalizado, com permissões por função e dashboards liberados um a um |

## Regras de negócio

- Valores monetários são gravados em centavos (inteiros) para não haver erro de arredondamento.
- Faturar um pedido exige saldo de todos os itens, baixa o estoque e gera as parcelas mensais. A diferença de centavos da divisão vai na primeira parcela.
- Cancelar um pedido faturado devolve o estoque e cancela as parcelas em aberto. Se alguma parcela já foi recebida, é preciso estorná-la antes.
- O pedido guarda quem o lançou (usuário) separado do vendedor. Vendedor, médico e paciente são opcionais e precisam ter a classificação correspondente no cadastro de pessoas.
- Só a venda gera contas a receber e conta como faturamento nos dashboards, no início e nos totais do relatório. Bonificação e perda só baixam o estoque ao serem confirmadas; a perda exige motivo e não tem preço, desconto nem frete.
- O desconto do item é por unidade do lançamento. O total é subtotal − descontos dos itens − desconto no total − campanha + frete. Pedido com campanha não aceita desconto manual, nem no total nem nos itens.
- Cada rota da API exige uma permissão; o catálogo e a regra de cada rota estão em `api/src/permissoes.ts`. O administrador de fábrica tem todas, o operador de fábrica não gerencia usuários nem campanhas, e os perfis personalizados têm o que for marcado. As listas de pessoas, produtos, campanhas e contas financeiras também abrem para quem lança pedidos, entradas e baixas. Mudar um perfil vale na chamada seguinte, sem novo login.
- Ninguém tira de si mesmo o gerenciamento de usuários, nem pelo próprio cadastro nem pelo próprio perfil. O menu só mostra as telas que o perfil alcança; os botões dentro das telas ainda aparecem e a API recusa a operação.
- Toda alteração de saldo gera um registro em `MovimentoEstoque`.
- Toda baixa de conta a receber ou a pagar entra por uma conta financeira e gera um `MovimentoFinanceiro`. A baixa pode ser parcial: a conta fica aberta enquanto houver saldo (`valor - valorPago`) e só passa a paga quando ele zera. Sem conta financeira informada, vale a única ativa; havendo mais de uma, é preciso escolher.
- O estorno desfaz a baixa mais recente sem apagar nada: marca o movimento original e lança o contrário no extrato. Conta com baixa não pode ser cancelada, nem o pedido dela, antes do estorno.
- Lançar uma despesa gera as contas a pagar dela: uma, com vencimento na emissão, se for à vista; uma por parcela, se for a prazo (a soma das parcelas precisa fechar com o total). O pagamento é feito pelas contas a pagar; a despesa mostra o que já foi pago e a data em que ficou quitada. Depois de lançada só se corrigem os dados de cadastro; para mudar valor ou parcelas, cancela-se a despesa (sem pagamentos) e lança-se outra.
- O extrato importado do banco (OFX, antigo ou novo, em Windows-1252 ou UTF-8) fica em `ExtratoBancario` e não mexe no saldo: o saldo muda pelos movimentos. Conciliar é ligar a linha ao que a explica. A mesma transação (mesmo identificador do banco na mesma conta) nunca é importada duas vezes, e a conta de destino precisa ter o número informado no arquivo, quando os dois existem.
- Uma linha pendente se resolve de cinco formas: baixar um título pelo valor, na data e na conta do extrato; vincular a um movimento já lançado de mesma conta, tipo e valor, sem nova baixa; lançar um movimento avulso (tarifa, rendimento); depósito a maior, que quita a conta do cliente e gera crédito do excedente; ou ignorar. Só a linha ignorada pode ser reaberta; a baixa conciliada se desfaz pelo estorno da conta.
- As sugestões somam pontos: valor igual ao saldo do título (60) ou menor (25), vencimento perto da data (até 20) e nome da pessoa na descrição do banco (20); um movimento já lançado de mesmo valor em até 5 dias vale 90 ou mais. A conciliação automática só resolve linhas com uma única sugestão de 90 pontos ou mais e nunca gera crédito sozinha. A lógica está em `api/src/routes/conciliacao.ts`.
- O saldo de uma conta financeira é o saldo inicial mais as entradas menos as saídas. Recebido e pago, nos dashboards e relatórios, contam as baixas não estornadas; a receber e a pagar contam o saldo das contas abertas.
- Um produto pode ter unidades extras de entrada e venda, cada uma com um fator (1 CX = 4 AMP). Estoque, custo e estoque mínimo continuam na unidade base. Para o saldo fracionado ser exato, ele é guardado em "partes": 1 unidade base = `divisor` partes, e o divisor é o mínimo múltiplo comum dos fatores do produto. O divisor só cresce; ao crescer, saldo e movimentações são reescalados.
- Itens de pedido e de entrada guardam quantidade, valor, unidade e fator do lançamento. As campanhas contam as quantidades na unidade base.
- Cada pedido aceita uma campanha, sem acumular com desconto manual. O servidor confere a vigência e as condições e calcula o desconto a cada gravação do pedido; só conjuntos completos recebem o benefício. A lógica está em `api/src/promocao.ts`.
- A devolução vale para vendas faturadas e nunca passa do que foi vendido menos o já devolvido. Ela devolve o estoque e gera um crédito do cliente pelo valor líquido do item: o preço menos o desconto do item, com o desconto no total e o da campanha rateados; o frete não entra. Pedido com devolução não pode ser cancelado.
- O crédito baixa contas a receber em aberto do cliente, do médico, do vendedor ou do paciente da venda de origem, no todo ou em parte. Não é dinheiro: aparece no histórico da conta, mas não entra no extrato das contas financeiras nem no "recebido" dos dashboards, e não é desfeito pelo estorno de recebimento.
- Cada pedido faturado tem no máximo uma entrega não cancelada. O endereço é copiado do cliente quando a entrega é criada.
- A rota junta entregas pendentes de um motorista e um veículo em um dia, em sequência. A carga (soma dos pesos) não passa da capacidade do veículo. "Organizar paradas" ordena pela parada mais próxima em linha reta a partir da saída; entregas sem coordenadas ficam no fim.
- O link do entregador abre a página `/rota/:id` sem login. A chave vai depois do `#`, só aparece quando o link é gerado e o banco guarda apenas o hash dela, com validade de 1 a 168 horas. Gerar outro link invalida o anterior. Pelo link o entregador vê as paradas e registra saída, entrega e tentativa sem sucesso, só das entregas daquela rota.
- Toda mudança de situação da entrega fica em `EntregaHistorico`, com quem fez (usuário ou entregador pelo link).
- A entrega segue pendente → em rota → entregue ou falhou. Uma falha pode ser reprogramada e volta a pendente.
- Pedido já entregue não pode ser cancelado, e pedido com entrega em rota só depois de registrar a conclusão ou a falha. Cancelar o pedido cancela a entrega pendente.

## Fases seguintes

Ainda não implementados: cartões e operadoras, e anexos em pedidos e contas (a API já aceita; falta o botão nas telas). A lista completa do que falta está em `PENDENCIAS.md`.

## Produção

- Banco: aponte `DATABASE_URL` (pool, porta 6543) e `DIRECT_URL` (direta, porta 5432) para o projeto de produção no Supabase.
- API: defina `JWT_SECRET` e `CORS_ORIGIN` (endereço público do frontend) no ambiente.
- Anexos: os arquivos ficam em `api/uploads` (ou na pasta de `UPLOADS_DIR`). Essa pasta precisa de disco persistente e de backup junto com o banco.
- Frontend: `npm run build` gera `web/dist`. Com `WEB_DIST` apontando para essa pasta, a própria API entrega o frontend e passa a atender em `/api/*`, num serviço único; defina também `HOST=0.0.0.0`. Sem `WEB_DIST`, o servidor que publicar os arquivos precisa repassar `/api/*` para a API, como o proxy do Vite faz em desenvolvimento.
