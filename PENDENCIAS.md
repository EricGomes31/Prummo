# Pendências do Prumo

Lista do que ficou para depois, levantada durante a migração do SG Nexus e a publicação. Atualizada em 08/10/2026. O que já foi feito e como retomar o trabalho estão em `ANDAMENTO.md`.

## Urgente (segurança e acesso)

- [ ] Trocar a senha do administrador (`admin@prumo.local`). Ela ainda é a inicial do `api/.env`, e o sistema está aberto na internet com dados de 202 pessoas reais.
- [ ] Redefinir a senha do banco no Supabase e atualizar `DATABASE_URL` e `DIRECT_URL` no `api/.env` e nas variáveis do Railway. A senha atual foi digitada em uma conversa.
- [x] Remover a chave SSH `prumo-deploy`. Feito em 08/10/2026: excluída no cPanel da HostGator e apagada deste computador.
- [ ] Criar os usuários de Douglas e Lethícia, que existem no SG Nexus, cada um com o perfil de acesso adequado.

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

- [ ] Rodar de novo os importadores (`api/scripts/importar-*.mjs`) para trazer o que for lançado no SG Nexus até a virada. Eles não duplicam o que já existe.
- [ ] Conferir se os horários importados estão certos. O SG Nexus não informa o fuso; foram tratados como horário de Brasília.
- [ ] Confirmar com quem usa o SG Nexus as regras que foram definidas sem conseguir ver o servidor dele: bonificação e perda só baixam o estoque e ficam fora do faturamento; o crédito da devolução rateia os descontos do pedido e não inclui o frete; o crédito só baixa contas da própria pessoa elegível.

## Funções do SG Nexus que ainda faltam

### Pedidos e vendas

- [ ] Condição de pagamento já no pedido: link de cartão, maquininha e a prazo com parcelas escolhidas. Hoje a forma de pagamento é definida ao faturar.
- [ ] Anexos da venda. A API já aceita; falta o botão na tela.
- [ ] Edição de pedido já faturado.
- [ ] Campanha bloquear o desconto manual só nos produtos participantes. Hoje o pedido com campanha não aceita nenhum desconto manual.

### Financeiro

- [ ] Despesas: pagar já no lançamento, escolhendo a conta financeira. Hoje a despesa à vista gera a conta e o pagamento é registrado depois, em "A pagar".
- [ ] Despesas: cadastrar o fornecedor sem sair do lançamento e exportar a lista para Excel.
- [ ] Despesas nos dashboards e relatórios, por elemento e por competência.
- [ ] Cartões e operadoras: liquidações, taxas e prazo de recebimento.
- [ ] Conciliação: desfazer uma linha conciliada. Hoje só a linha ignorada reabre; a baixa se desfaz pelo estorno da conta, e a linha do extrato continua marcada como conciliada.
- [ ] Conciliação: uma linha do extrato pagar vários títulos de uma vez (por exemplo, um depósito para duas vendas).
- [ ] Conciliação: transferência entre contas próprias. Hoje as duas pontas são ignoradas ou lançadas como avulsas.
- [ ] Conciliação: testar com extratos reais dos bancos usados. O leitor de OFX foi testado só com arquivos de exemplo.
- [ ] Relatório de cobrança, com exportação e impressão em PDF.
- [ ] Filtros das contas a receber por cliente, paciente, médico, vendedor e período.
- [ ] Lançamento avulso direto no extrato, sem passar pela conciliação, e transferências entre contas.
- [ ] Caixa e bancos: lista de bancos para escolher a instituição, CPF ou CNPJ do titular obrigatório, saldo inicial negativo e hora na data da baixa.

### Devoluções e créditos

- [ ] Usar o crédito já na venda, ao faturar. Hoje ele só baixa contas a receber já lançadas.
- [ ] Estornar o uso de um crédito e estornar uma devolução.
- [ ] Crédito avulso, lançado à mão. Hoje o crédito nasce de uma devolução ou de um depósito a maior na conciliação.
- [ ] Decidir se a devolução deve reduzir o faturamento nos dashboards e relatórios. Hoje a venda continua contando pelo valor cheio.

### Logística

- [ ] Documentos da entrega (comprovante, foto). O histórico das situações já existe.
- [ ] Buscar as coordenadas a partir do endereço. Hoje latitude e longitude são digitadas.
- [ ] Limitar tentativas no link do entregador e avisar quando o link for aberto.
- [ ] Rota considerar vias, trânsito e horário de recebimento. "Organizar paradas" usa só a distância em linha reta.

### Outros

- [ ] Link público para o cliente atualizar os próprios dados.
- [ ] Filtro "todos os meses" e "todos os anos" nos dashboards.

## Acabamento

- [ ] Esconder, em cada tela, os botões das operações que o perfil do usuário não permite. Hoje eles aparecem e a API recusa com uma mensagem.
- [ ] Criar as permissões dos cartões e operadoras, quando o módulo entrar.
- [ ] Máscara de CPF/CNPJ, telefone e CEP na exibição. Os dados importados estão só com dígitos.
- [ ] Testes automatizados do frontend. Hoje só a API é testada.
