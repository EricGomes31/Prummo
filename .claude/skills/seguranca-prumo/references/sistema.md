# Sistema (código da API e do site)

Leia o código, não só a descrição. Quando achar um problema, procure o mesmo padrão nas outras rotas.

## Login e sessões (`api/src/routes/usuarios.ts`, `api/src/auth.ts`, `api/src/limite.ts`)
- Senhas com bcrypt (custo ≥ 10). Mínimo de tamanho no cadastro e na troca (hoje 8). Sugestão (Médio):
  recusar senhas muito comuns.
- Limite de tentativas por IP e por conta; conferir que o IP vem do proxy certo (`trustProxy` em
  `server.ts` — na VPS há um salto, o Caddy; confiar em saltos demais deixa o atacante forjar o IP).
- Token JWT: segredo longo (≥ 32), expiração (hoje 12 h), sessão conferida no banco a cada chamada
  (usuário/empresa desativados perdem acesso na hora). Onde o site guarda o token (localStorage é
  vulnerável a XSS — por isso o item de XSS abaixo pesa mais).
- Troca de senha exige a senha atual; redefinição pelo administrador da empresa e pelo administrador do
  sistema (`/sistema/empresas/:id/usuarios/:id/senha`) só para quem tem direito.
- Mensagens de erro de login não revelam se o e-mail existe.

## Permissões (`api/src/permissoes.ts`)
- Toda rota que lê ou grava dados está em `REGRAS` (ou tem `exigir(...)`). Rota nova fora do mapa vale para
  qualquer usuário logado — liste as rotas registradas e compare com o mapa. Rota de gravação sem regra =
  Alto.
- Rotas `/sistema/*` conferem `req.usuario.sistema`.
- Ninguém consegue se dar mais permissão (editar o próprio perfil, trocar o próprio perfil).

## Separação entre empresas (o risco nº 1 de um ERP com várias empresas)
- `src/empresa.ts` põe o `empresaId` em toda consulta; `prisma/empresas.sql` tem gatilhos que recusam ligar
  registros de empresas diferentes. Procure consultas que escapam: `$queryRaw`/`$executeRaw`,
  `semEmpresa(...)` fora de `/sistema`, `findUnique` por id seguido de uso sem conferir a empresa.
- A suíte `api/tests/empresas.teste.mjs` cobre isso; rotas novas que mexem em dados devem ganhar casos ali.
- Links públicos (entregador, atualização de cadastro): token longo e aleatório, com validade, limitado ao
  necessário, com limite de tentativas.

## Ataques web comuns
- **Injeção de SQL**: Prisma parametriza; risco só em `$queryRawUnsafe`/`$executeRawUnsafe` com texto
  montado a partir de entrada do usuário. Cada um precisa justificar.
- **XSS**: React escapa por padrão; procure `dangerouslySetInnerHTML`, montagem de HTML em relatórios
  impressos/exportados, e `href` com valor do usuário (`javascript:`).
- **Validação**: todo corpo e parâmetro passa por `zod` antes de usar.
- **CORS**: em produção o site e a API estão no mesmo endereço; `CORS_ORIGIN` não deve liberar `*`.
- **Tamanho de requisição e de arquivo**: limite de corpo (`bodyLimit`) e de anexo.
- **Erros**: resposta 500 genérica, sem pilha nem SQL (o `setErrorHandler` de `server.ts`).

## Anexos (`api/src/routes/documentos.ts`)
- Tipos permitidos por extensão e conteúdo, tamanho máximo, nome do arquivo gerado pelo sistema (nunca o
  enviado), download sempre como anexo (`Content-Disposition: attachment`) e conferindo a empresa do dono.

## Dependências
- `npm audit --omit=dev` em `api/` e `web/`. Vulnerabilidade alta em pacote usado em produção = Alto;
  só em ferramenta de desenvolvimento = Baixo. O Dockerfile antigo instalava dependências de
  desenvolvimento na imagem (pendência registrada).
