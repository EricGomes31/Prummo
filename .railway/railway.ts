// Configuração do Railway (Infrastructure as Code). Substitui o railway.json, que deixa de ser lido em 01/12/2026.
// Não é lida na publicação (railway up): mudanças aqui só valem depois de `railway config plan` e `railway config apply`.
// Gerada por `railway config pull` em 09/10/2026, com o que antes vinha do railway.json: Dockerfile,
// verificação de saúde e reinício em caso de falha. As variáveis ficam com o valor que já está no Railway.
import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // Anexos dos registros (UPLOADS_DIR). Excluir ou diminuir o volume apaga os arquivos.
  const prumoVolume = volume("prumo-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "iad", sizeMB: 500 });
  const prumo = service("prumo", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/saude",
    healthcheckTimeout: 60,
    // Reinício em caso de falha é o padrão do Railway (guardado como vazio); declarar o tipo deixaria o plano sempre com diferença.
    deploy: { restartPolicyMaxRetries: 5 },
    replicas: { "iad": 1 },
    volumeMounts: { "/data": prumoVolume },
    env: { DATABASE_URL: preserve(), DIRECT_URL: preserve(), JWT_SECRET: preserve() },
  });

  return project("prumo", {
    resources: [prumo, prumoVolume],
  });
});
