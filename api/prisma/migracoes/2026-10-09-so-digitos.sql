-- CPF/CNPJ, telefone e CEP passam a ser guardados só com os dígitos (09/10/2026); as telas formatam ao mostrar.
-- Ajusta o que foi gravado antes com pontuação. Rode uma vez, com ou sem a API nova publicada:
--   npx prisma db execute --file prisma/migracoes/2026-10-09-so-digitos.sql --schema prisma/schema.prisma
-- Pode ser rodada de novo sem efeito. Campo que só tinha pontuação fica vazio.
begin;

update "Pessoa" set
  documento = nullif(regexp_replace(documento, '\D', '', 'g'), ''),
  telefone = nullif(regexp_replace(telefone, '\D', '', 'g'), ''),
  celular = nullif(regexp_replace(celular, '\D', '', 'g'), ''),
  cep = nullif(regexp_replace(cep, '\D', '', 'g'), '')
where documento ~ '\D' or telefone ~ '\D' or celular ~ '\D' or cep ~ '\D';

update "Empresa" set documento = nullif(regexp_replace(documento, '\D', '', 'g'), '') where documento ~ '\D';

update "ContaFinanceira" set "documentoTitular" = nullif(regexp_replace("documentoTitular", '\D', '', 'g'), '') where "documentoTitular" ~ '\D';

update "Motorista" set telefone = nullif(regexp_replace(telefone, '\D', '', 'g'), '') where telefone ~ '\D';

update "Entrega" set
  telefone = nullif(regexp_replace(telefone, '\D', '', 'g'), ''),
  cep = nullif(regexp_replace(cep, '\D', '', 'g'), '')
where telefone ~ '\D' or cep ~ '\D';

commit;
