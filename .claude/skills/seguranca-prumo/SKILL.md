---
name: seguranca-prumo
description: Auditoria e correção de segurança do ERP Prumo (prummo.tech) — servidor VPS, código da API e do site, banco PostgreSQL, LGPD e senhas/segredos. Use sempre que o usuário pedir para revisar, configurar, reforçar ou conferir a segurança do Prumo ou do servidor, falar em cyber segurança, invasão, vazamento, ataque, senha exposta, permissões, firewall, HTTPS, backup, LGPD ou dados pessoais de clientes e pacientes — mesmo que não diga "auditoria". Também use antes de abrir o sistema para uma empresa nova ou depois de mudanças grandes no login, nas permissões ou no servidor.
---

# Segurança do Prumo

O Prumo é um ERP com várias empresas no mesmo sistema, guardando CPF, endereço, telefone, dados de pacientes
e médicos, vendas e financeiro. Um vazamento expõe dados pessoais (LGPD) de clientes de várias empresas de
uma vez, e um erro de configuração pode derrubar o sistema que todos usam para vender. Por isso esta skill
trabalha em duas fases bem separadas: **primeiro olhar (só leitura), depois corrigir com aprovação**.

## Mapa do ambiente (confira antes de confiar: pode ter mudado)

- Site e API: https://prummo.tech, numa VPS Hostinger em São Paulo (Ubuntu 24.04, IP 179.236.68.14).
  Acesso: `ssh -i ~/.ssh/prumo_vps root@179.236.68.14` (só por chave).
- No servidor: Caddy (HTTPS, `/etc/caddy/Caddyfile`, cópia em `infra/vps/Caddyfile`) → serviço `prumo`
  (Node, `/etc/systemd/system/prumo.service`, porta 3000 local) → PostgreSQL 16 só em 127.0.0.1.
  Configuração com segredos: `/etc/prumo/prumo.env` (só no servidor). Anexos: `/var/lib/prumo/uploads`.
- Cópias: `prumo-copia` (timer diário 02:30, 14 dias em `/var/backups/prumo`) e o GitHub Actions
  `.github/workflows/copia-diaria.yml` (03:00, 30 dias, chave restrita no `authorized_keys`).
- Código: `api/` (Fastify + Prisma; login em `src/routes/usuarios.ts` e `src/auth.ts`, permissões em
  `src/permissoes.ts`, separação por empresa em `src/empresa.ts`, `prisma/rls.sql`, `prisma/empresas.sql`,
  limite de tentativas em `src/limite.ts`, anexos em `src/routes/documentos.ts`) e `web/` (React + Vite).
- Desenvolvimento local: `api/.env` aponta para um banco local; `api/.env.producao` é o antigo (Supabase).
- Registro de tudo que se faz: `PENDENCIAS.md` (estilo "[x] Feito em DD/MM/AAAA: …").

## Como trabalhar

### 1. Combinar o escopo
Se o pedido não disser, pergunte em uma frase se é a auditoria completa ou uma área (servidor, sistema,
banco, LGPD/senhas). Auditoria completa é o padrão quando o pedido é vago ("vê a segurança do ERP").

### 2. Coletar sem mexer em nada
- Servidor: rode `bash .claude/skills/seguranca-prumo/scripts/auditar-servidor.sh` da raiz do projeto.
  Ele só lê (configuração do SSH, firewall, portas abertas, atualizações pendentes, certificado, cabeçalhos
  do site, cópias, papéis do banco, permissões dos arquivos de segredo) e não imprime segredos.
- Código: leia os arquivos do mapa acima e procure os pontos das listas de verificação.
- Para cada área, siga a lista correspondente — leia só a que for usar:
  - `references/servidor.md` — VPS, SSH, firewall, HTTPS, atualizações, cópias
  - `references/sistema.md` — login, sessões, permissões, separação entre empresas, ataques web, anexos
  - `references/banco.md` — papéis do PostgreSQL, RLS e travas por empresa, cópias e restauração
  - `references/lgpd-segredos.md` — dados pessoais, quem vê o quê, segredos e troca de senhas

Nunca mostre segredos no chat ou em arquivos (senhas, `JWT_SECRET`, URLs de banco com senha, chaves). Para
saber se um segredo é fraco ou repetido, compare sem imprimir (tamanho, se bate com outro, hash).

### 3. Relatório
Entregue em português simples — quem lê é o dono do negócio, não um especialista. Formato:

```
# Segurança do Prumo — <data>

Resumo: <2 a 3 frases: estado geral e o mais urgente>

## Crítico (corrigir hoje)
- <Problema> — <o que pode acontecer, em linguagem de negócio>. Onde: <arquivo:linha ou servidor>.
  Correção: <o que fazer>. <Eu faço / precisa de você>.
## Alto (esta semana)
## Médio (este mês)
## Baixo / boas práticas
## O que está bom
- <controles conferidos e funcionando — isso dá confiança e evita refazer trabalho>
```

Gravidade pelo impacto real neste sistema: **Crítico** = alguém de fora consegue entrar, ver dados de
outra empresa ou derrubar o sistema; **Alto** = depende de um passo a mais (senha fraca, usuário interno
mal-intencionado, segredo exposto em lugar restrito); **Médio** = reduz a defesa em profundidade;
**Baixo** = higiene. Não infle: um item "Crítico" que não é faz o usuário ignorar o próximo que for.
Cada achado precisa de evidência concreta (saída de comando, arquivo e linha). Se não conseguiu conferir
algo, diga "não conferido" em vez de supor.

Se o relatório for longo ou for ser passado adiante, publique como página (Artifact) e dê o link.

### 4. Corrigir, com aprovação
Mostre a lista do que pretende corrigir e espere o "sim" antes de qualquer mudança no servidor, no banco
ou de algo que muda o comportamento para os usuários (ex.: exigir senha mais forte, encerrar sessões).
Mudanças só no código, com teste, seguem o fluxo normal do projeto. Cuidados que evitam estrago:

- **Banco**: cópia antes (`prumo-copia` no servidor), mudança dentro de transação, conferência depois.
- **SSH/firewall**: nunca feche a sessão em uso; teste o acesso numa conexão NOVA antes de considerar
  pronto. Um erro aqui tranca todos fora (o console da Hostinger é o último recurso).
- **Caddy/serviço**: valide antes (`caddy validate`, `sshd -t`), recarregue em vez de reiniciar quando der,
  e confira o site no ar depois (`curl https://prummo.tech/api/saude`).
- **Código**: teste automatizado para cada correção de segurança (a suíte fica em `api/tests`, roda com
  `npm test` em `api/`), `npm run build` no `web/`, depois publique com `bash scripts/publicar-vps.sh`.
- **Segredos novos**: gere no próprio servidor ou entregue pela área de transferência; nunca no chat.

Se uma ação for bloqueada pela proteção do Claude Code, não contorne: prepare um script no scratchpad e
peça ao usuário para rodar com `! bash <caminho>`, explicando o que ele faz.

### 5. Registrar
Anote no `PENDENCIAS.md` o que foi feito ("[x] Feito em …") e o que ficou pendente ("[ ]"), sem segredos,
e faça commit. Achados que dependem do usuário (trocar uma senha num painel, contratar algo) entram como
pendência com o passo a passo.
