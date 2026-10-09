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
- [ ] Migrar o `railway.json` para o formato novo do Railway. O atual deixa de ser aceito em 01/12/2026.
- [x] Colocar o projeto no Git. Feito em 08/10/2026: repositório privado `github.com/labsinfinitys-svg/Prumo`, branch `main`.
- [ ] Ligar o Railway ao repositório do GitHub, para publicar a cada envio. Hoje a publicação continua manual, por `railway up`.
- [ ] Definir o backup da pasta de anexos (volume `/data` no Railway) junto com o do banco.

## Antes de desligar o SG Nexus

- [ ] Rodar de novo os importadores (`api/scripts/importar-*.mjs`, com `--empresa=1`) para trazer o que for lançado no SG Nexus até a virada. Eles não duplicam o que já existe. Os pedidos importados mantêm o número do SG Nexus: se antes disso forem lançados pedidos no Prumo, eles ocupam os próximos números e a importação de um pedido do SG Nexus com o mesmo número para com aviso.
- [ ] Conferir se os horários importados estão certos. O SG Nexus não informa o fuso; foram tratados como horário de Brasília.
- [ ] Confirmar com quem usa o SG Nexus as regras que foram definidas sem conseguir ver o servidor dele: bonificação e perda só baixam o estoque e ficam fora do faturamento; o crédito da devolução rateia os descontos do pedido e não inclui o frete; o crédito só baixa contas da própria pessoa elegível.

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
- [ ] Paginação nas demais listas. Hoje só Pessoas, Produtos, Pedidos e Devoluções usam `usePaginacao`.
- [ ] Busca do topo achar também registros (pessoas, produtos, pedidos). Hoje ela encontra telas.
- [ ] Comparação com o período anterior nos indicadores ("+12,5% vs. mês anterior"). A API ainda não calcula o período anterior.
- [ ] Filtros rápidos de período nos dashboards (hoje, 7, 30 e 90 dias). Hoje a escolha é por mês.
- [ ] Seleção múltipla e menu de ações "..." nas tabelas. Não há ações em lote no sistema ainda.
- [ ] Visualização dos produtos em cartões, como alternativa à tabela.
- [ ] Modo escuro.
- [ ] Esconder, em cada tela, os botões das operações que o perfil do usuário não permite. Hoje eles aparecem e a API recusa com uma mensagem.
- [ ] Criar as permissões dos cartões e operadoras, quando o módulo entrar.
- [ ] Máscara de CPF/CNPJ, telefone e CEP na exibição. Os dados importados estão só com dígitos.
- [ ] Testes automatizados do frontend. Hoje só a API é testada.
