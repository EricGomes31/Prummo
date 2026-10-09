# Pendências do Prumo

Lista do que ficou para depois, levantada durante a migração do SG Nexus e a publicação. Atualizada em 09/10/2026. O que já foi feito e como retomar o trabalho estão em `ANDAMENTO.md`.

## Urgente (segurança e acesso)

- [x] Aplicar no banco real a passagem para várias empresas e as funções novas. Feito e publicado em 09/10/2026, com cópia de segurança antes em `backups/2026-10-09-0202`. Os dados ficaram na empresa "Infinity Labs".
- [ ] Depois de publicar, dar as permissões novas aos perfis personalizados que precisarem: alterar pedido faturado, lançar crédito avulso e lançar no caixa (avulso e transferência). Administrador e operador de fábrica já têm.
- [ ] Informar o CPF ou CNPJ do titular nas contas em banco já cadastradas: agora é obrigatório para salvar uma conta que não seja o caixa.
- [x] Adaptar os importadores (`api/scripts/importar-*.mjs`) para informar a empresa. Feito em 09/10/2026: opção `--empresa=<id>`, com testes.
- [x] Numeração dos pedidos por empresa. Feito e publicado em 09/10/2026, com cópia de segurança antes em `backups/2026-10-09-0333`. Os pedidos #2 a #5 mantiveram os números; o próximo da Infinity Labs é o #6.

- [x] Trocar a senha do administrador (`admin@prumo.local`). Feito em 08/10/2026: senha aleatória de 24 caracteres, guardada em `SEED_ADMIN_PASSWORD` no `api/.env` desta máquina.
- [x] Limite de tentativas no login. Feito em 09/10/2026: 5 senhas erradas por e-mail e IP, ou 20 por IP, bloqueiam por 15 minutos.
- [ ] Redefinir a senha do banco no Supabase e atualizar `DATABASE_URL` e `DIRECT_URL` no `api/.env` e nas variáveis do Railway. A senha atual foi digitada em uma conversa.
- [x] Remover a chave SSH `prumo-deploy`. Feito em 08/10/2026: excluída no cPanel da HostGator e apagada deste computador.

## Cadastros a completar

- [ ] Cadastrar os fornecedores e prestadores de serviço. Sem ao menos um, não dá para lançar despesas nem entradas de estoque com fornecedor.
- [ ] Marcar as classificações de vendedor, médico e paciente nas pessoas. As 202 importadas estão só como cliente, então esses seletores do pedido aparecem vazios.
- [ ] Informar o preço de venda dos 15 produtos que vieram sem preço e o custo dos 11 que vieram sem custo.
- [ ] Completar o cadastro dos 2 motoristas importados (Xandy e Marques), que vieram sem telefone e sem CNH, e a descrição do veículo SYC2I43.
- [ ] Informar latitude e longitude nas entregas e no ponto de saída das rotas, se for usar "Organizar paradas". As entregas importadas vieram sem coordenadas.
- [ ] Cadastrar as contas bancárias reais em Financeiro > Caixa e bancos, com o número da conta, que é como o extrato OFX reconhece o destino. Hoje só existe a conta "Caixa".

## Hospedagem e infraestrutura

- [ ] Decidir a hospedagem definitiva. Hoje está no Railway (Virgínia) com banco no Supabase (São Paulo), e cada tela leva cerca de 380 ms. Opções: VPS Hostinger KVM 1 em São Paulo (a mais rápida) ou recriar o banco do Supabase em East US.
- [ ] Assinar o plano Hobby do Railway (US$ 5/mês) quando os créditos de teste acabarem, se o sistema continuar lá.
- [ ] Apontar um subdomínio de `labsinfinity.com.br` (por exemplo `prumo.labsinfinity.com.br`) para o sistema, na Cloudflare.
- [ ] Separar o banco de desenvolvimento do banco de produção. Hoje são o mesmo, e toda mudança de estrutura e todo teste manual caem nos dados reais.
- [ ] Avaliar o plano pago do Supabase. O gratuito pausa o projeto após cerca de uma semana sem uso e não tem backup automático.
- [x] Migrar o `railway.json` para o formato novo do Railway. Feito e aplicado em 09/10/2026: `.railway/railway.ts`.
- [x] Colocar o projeto no Git. Feito em 08/10/2026: repositório privado `github.com/labsinfinitys-svg/Prumo`, branch `main`.
- [x] Instalar no projeto as skills da pasta `Desktop\Skills`. Feito em 09/10/2026: brainstorming, find-skills, frontend-design e ui-ux-pro-max copiadas para `.claude/skills` (a skill-creator já existia).
- [ ] Ligar o Railway ao repositório do GitHub, para publicar a cada envio. Hoje a publicação continua manual, por `railway up`.
- [ ] Definir o backup da pasta de anexos (volume `/data` no Railway) junto com o do banco.

## Antes de desligar o SG Nexus

- [ ] Rodar de novo os importadores (`api/scripts/importar-*.mjs`, com `--empresa=1`) para trazer o que for lançado no SG Nexus até a virada. Eles não duplicam o que já existe. Os pedidos importados mantêm o número do SG Nexus: se antes disso forem lançados pedidos no Prumo, eles ocupam os próximos números e a importação de um pedido do SG Nexus com o mesmo número para com aviso.
- [x] Comparação completa, tela por tela, entre o SG Nexus e o Prumo. Feita em 09/10/2026: levantamento somente leitura das 12 telas do SG Nexus e inventário do Prumo; os relatórios e 59 prints ficaram em `levantamento-sgnexus/` (fora do Git, porque têm nomes de clientes). O que falta está na seção "O que o SG Nexus tem e o Prumo ainda não".
- [x] Dois erros achados no inventário do Prumo. Corrigidos em 09/10/2026: a busca por número no relatório de vendas comparava com o id interno do pedido, e não com o número mostrado; quem tinha só a permissão de lançar no caixa não via o item Financeiro no menu.
- [ ] Trocar a senha do usuário do SG Nexus (douglalves12@gmail.com): foi digitada em uma conversa.
- [ ] Conferir se os horários importados estão certos. O SG Nexus não informa o fuso; foram tratados como horário de Brasília.
- [ ] Confirmar com quem usa o SG Nexus as regras que foram definidas sem conseguir ver o servidor dele: bonificação e perda só baixam o estoque e ficam fora do faturamento; o crédito da devolução rateia os descontos do pedido e não inclui o frete; o crédito só baixa contas da própria pessoa elegível.

## O que o SG Nexus tem e o Prumo ainda não

Levantado em 09/10/2026 (detalhes em `levantamento-sgnexus/`). Em ordem de prioridade.

Prioridade 1 (uso diário):
- [x] Campos de pessoa com busca no lugar das listas longas. Feito em 09/10/2026: componente `web/src/escolha.tsx` (digita parte do nome, documento, celular ou e-mail, sem diferenciar acentos; setas, Enter e Esc; obrigatório não passa sem escolher). Usado no cliente, vendedor, médico e paciente do pedido; fornecedor da entrada e da despesa; filtros de cliente, fornecedor, vendedor, médico e paciente do financeiro e da cobrança; pessoa do novo lançamento e do crédito avulso; venda da devolução; pedido da nova entrega; cliente do depósito a maior na conciliação.
- [ ] Produto no pedido escolhido digitando código, descrição ou EAN (Enter escolhe; serve para leitor de código de barras), como já é na entrada de estoque.
- [ ] Lista de pedidos com busca (número, cliente, vendedor, médico, paciente) e período. Hoje a lista traz só os 300 mais recentes e não há como achar um pedido antigo fora dos relatórios; vale o mesmo para entradas (200) e contas (500).
- [ ] "Finalizar venda" em um passo: salvar e faturar de uma vez, como no SG Nexus (lá todo pedido já nasce faturado).
- [ ] Parcelas com vencimentos (e valores) escolhidos à mão no pedido a prazo e na entrada a prazo. Hoje o pedido só gera parcelas mensais e a entrada só aceita os prazos fixos.
- [ ] Data da venda no pedido (hoje é sempre a data em que foi lançado).
- [ ] Endereço de entrega alternativo no pedido, que segue para a entrega.
- [ ] Rateio do frete e das outras despesas da entrada no custo dos produtos ("custo com rateio" do SG Nexus). Hoje o frete vai para as contas a pagar, mas não entra no custo.
- [ ] Cartões e operadoras (já listado em "Funções do SG Nexus que ainda faltam"): o SG Nexus mostra R$ 3.094,94 pendentes nas operadoras, então está em uso.

Prioridade 2:
- [ ] Alterar pedido faturado com motivo obrigatório, uma conferência do impacto antes de salvar (total anterior, novo total, diferença) e o histórico de alterações visível no pedido.
- [ ] Janela de baixa (receber/pagar) com os dados da venda (pedido, parcela, vendedor, médico, observações) e os anexos da conta. A API dos anexos já existe.
- [ ] Detalhes da entrada de estoque (itens, custo, parcelas, documentos).
- [ ] Relatório de movimentações do caixa e da conciliação (extrato por conta, conciliadas/pendentes) com Excel; exportar o extrato.
- [ ] Dashboard comercial: clicar no dia para ver as vendas dele e abrir o pedido; rankings com 10 posições.
- [ ] Relatório de cobrança com filtro de emissão, situação (inclusive pagas e canceladas) e visão por produto.
- [ ] Ordenar as listas clicando no título da coluna (no SG Nexus vale para todas as tabelas).

Prioridade 3:
- [ ] Confirmação de senha ao criar usuário e ao alterar a senha.
- [ ] Lista completa de bancos (código COMPE) com busca no cadastro de conta financeira.
- [ ] Filtro de origem no extrato; busca nos créditos de clientes; colunas de origem e documento em contas a pagar; conta de pagamento no relatório de vendas; campo "preço com desconto" no item do pedido.
- [ ] Avaliar a leitura automática de comprovante PIX anexado ao pedido, que o SG Nexus faz.
- [ ] Decidir sobre o link público de atualização cadastral: o SG Nexus tem um link único para todos (a pessoa digita os dados e o sistema acha o cadastro); o Prumo gera um link por pessoa, que é mais seguro.

O Prumo já faz melhor: cancelamento de pedido; histórico de estoque; lista e estorno de entradas e devoluções; edição na logística; transferência e lançamento avulso no caixa; sete formas de resolver uma linha na conciliação (o SG Nexus só baixa ou vincula); paginação; Esc e aviso ao descartar janelas; endereço próprio para cada tela. Erros do SG Nexus que o Prumo não tem: perda aparecendo como venda, entrega duplicada para o mesmo pedido, endereço alternativo apagado ao digitar o produto, botão que não avisa quando falha.

## Funções do SG Nexus que ainda faltam

Feitas em 09/10/2026, com testes e conferência de tela (detalhes no `ANDAMENTO.md`): condição de pagamento no pedido, anexos da venda, alteração de pedido faturado, campanha bloqueando o desconto só nos produtos dela; despesa paga no lançamento, fornecedor cadastrado sem sair, Excel, despesas no dashboard e no relatório; conciliação desfeita, vários títulos numa linha e transferência entre contas; relatório de cobrança; filtros das contas a receber; lançamento avulso e transferência no caixa; lista de bancos, titular obrigatório, saldo inicial negativo e hora na baixa; crédito usado no faturamento, estorno do uso e da devolução, crédito avulso; devoluções abatendo o faturamento (decidido em 09/10/2026); documentos da entrega; limite de tentativas e aviso de abertura no link do entregador; link para o cliente atualizar o cadastro; dashboards por ano e por todo o período.

Ficaram para depois, por decisão de 09/10/2026:

- [ ] Cartões e operadoras: liquidações, taxas e prazo de recebimento.
- [ ] Conciliação: testar com extratos reais dos bancos usados. O leitor de OFX foi testado só com arquivos de exemplo. Precisa dos arquivos OFX dos bancos.
- [ ] Buscar as coordenadas a partir do endereço. Hoje latitude e longitude são digitadas. Falta escolher o serviço (OpenStreetMap, gratuito, ou Google Maps, pago).
- [ ] Rota considerar vias, trânsito e horário de recebimento. "Organizar paradas" usa só a distância em linha reta. Depende do mesmo serviço de mapas.

## Acabamento

- [x] Visual novo e telas responsivas. Feito em 08/10/2026: menu com ícones e grupos, gaveta no celular, tabelas largas em cartões, janelas em tela cheia com botões fixos.
- [x] Reorganizar Devoluções e créditos. Feito em 08/10/2026: indicadores no topo, "Nova devolução" em janela, listas em painéis com título e paginação.
- [ ] Conferir no celular as telas que não passaram por print depois do visual novo: Entradas, Devoluções, Logística, Promoções, Relatórios, Usuários, Despesas, Caixa e bancos e Conciliação.
- [x] Redesenho em preto, branco e cinza. Feito em 08/10/2026: menu escuro recolhível, barra superior com busca de telas e notificações, avisos rápidos, esqueleto de carregamento, paginação e tela de login nova.
- [x] Paginação nas demais listas. Feito em 09/10/2026: Entradas, Entregas, Despesas, Promoções, Usuários, Empresas, Motoristas, Veículos e as duas listas da Conciliação, 25 por página. As rotas da Logística, em painéis, ficam sem paginação.
- [ ] Busca do topo achar também registros (pessoas, produtos, pedidos). Hoje ela encontra telas.
- [ ] Comparação com o período anterior nos indicadores ("+12,5% vs. mês anterior"). A API ainda não calcula o período anterior.
- [ ] Filtros rápidos de período nos dashboards (hoje, 7, 30 e 90 dias). Hoje a escolha é por mês.
- [ ] Seleção múltipla e menu de ações "..." nas tabelas. Não há ações em lote no sistema ainda.
- [ ] Visualização dos produtos em cartões, como alternativa à tabela.
- [ ] Modo escuro.
- [x] Esconder, em cada tela, os botões das operações que o perfil do usuário não permite. Feito em 09/10/2026 em Pessoas, Produtos, Entradas, Pedidos, Entregas, Logística e Contas a receber e a pagar (as demais telas já escondiam). Quem só pode ver uma conta abre o histórico, sem o formulário de baixa; quem não pode editar um pedido em aberto vê os detalhes.
- [ ] Criar as permissões dos cartões e operadoras, quando o módulo entrar.
- [x] Máscara de CPF/CNPJ, telefone e CEP. Feito em 09/10/2026: a API guarda só os dígitos e as telas formatam ao mostrar e ao digitar.
- [x] Rodar no banco real `api/prisma/migracoes/2026-10-09-so-digitos.sql`. Feito em 09/10/2026, com cópia de segurança antes em `backups/2026-10-09-0438`: nenhum CPF/CNPJ, telefone ou CEP ficou com pontuação.
- [ ] Testes automatizados do frontend. Hoje só a API é testada.
- [x] Revisão de acessibilidade e uso no celular com a skill ui-ux-pro-max, sem mudar o visual. Feito em 09/10/2026: contorno de foco visível no menu escuro e no painel do login; mais contraste no cinza dos textos secundários e nos títulos de grupo do menu; botões de ícone com 44 px no celular; link "Pular para o conteúdo"; foco vai para o conteúdo a cada troca de tela; janelas prendem o Tab dentro delas e devolvem o foco ao botão que as abriu; "×" de texto trocado pelo ícone de fechar; botão "Mostrar" na senha do login; ícone da aba do navegador em preto (era roxo).
- [ ] Conferir no navegador, logado, as melhorias acima nas telas internas (janelas, menu recolhido, tabelas em cartões no celular). Só a tela de login foi vista em print.
- [x] Sugestões da revisão. Feito em 09/10/2026: textos pequenos aumentados (selos, títulos de coluna, títulos de grupo do menu e de seção, eixos dos gráficos), nenhum abaixo de 11 px; asterisco vermelho no rótulo dos campos obrigatórios (menos no login), tirado do próprio `required` do campo; fechar uma janela pelo Esc, pelo fundo ou pelo X pergunta antes de descartar o que foi digitado num formulário (Cancelar e Salvar não perguntam).
- [x] Calendário próprio nos campos de data, no visual do sistema (o do navegador não aceita estilo). Feito em 09/10/2026: `web/src/calendario.tsx`, usado nos 25 campos de data, mês e data com hora. Dia escolhido em preto, hoje marcado com um ponto, dias fora do limite apagados, botões "Hoje" e "Limpar", setas do teclado, Esc fecha só o calendário. No celular continua o calendário do aparelho. As setas do Dashboard viraram ícones.
- [x] Controles do navegador no visual do sistema (skill ui-ux-pro-max). Feito em 09/10/2026, só com CSS: selects com seta própria e, no Chrome com mouse, a lista que abre também estilizada (cantos arredondados, sombra, sinal de escolhido à direita); caixas de marcar pretas com visto branco; campos de número sem as setinhas; ícone de relógio no horário; lupa e X de limpar nas buscas; barras de rolagem finas e cinza; seta própria em "Ver em tabela"; sem fundo azul do preenchimento automático. No celular, a lista dos selects continua a do aparelho.
- [x] Corrigir as setas de mês e ano do Dashboard, que sumiram ao virar ícones. Feito em 09/10/2026: os ícones dentro de botões comuns ganharam tamanho, e botão só com ícone fica quadrado.
- [ ] A lista de sugestões do campo "Elemento" da despesa (datalist) continua no visual do navegador; estilizar exigiria trocar por um campo com sugestões próprio.
- [ ] Mostrar o erro embaixo do campo que o causou, e não só no fim do formulário. Depende de a API dizer qual campo está errado; hoje ela devolve uma mensagem só.
