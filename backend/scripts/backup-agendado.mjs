// Backup agendado do piloto, sem terminal (lote O1). Só para o workflow do
// repositório PRIVADO de operação (modelo em
// docs/runbooks/modelos/backup-piloto.yml) e para o ensaio com dados
// fictícios (BACKUP_MODO=ensaio, tudo em 127.0.0.1). O fluxo e as travas
// estão em backup-agendado-lib.mjs; o roteiro, em
// docs/runbooks/backup-piloto-automatico.md.
//
// Ambiente: BACKUP_MODO, PILOTO_BACKUP_URL, PILOT_ENDPOINT_ID,
// PRODUCTION_ENDPOINT_ID, RESTAURACAO_URL, RESTAURACAO_CA, AGE_RECIPIENT,
// AGE_BIN, PG_BIN, B2_ENDPOINT, B2_BUCKET, B2_KEY_ID, B2_APP_KEY,
// SENTRY_CRON_URL, BACKUP_CODIGO_SHA, GITHUB_TOKEN e, no ensaio,
// BACKUP_ORIGEM_CA. Sai com 0 só quando o backup foi restaurado, conferido,
// enviado, conferido no armazenamento e o check-in `ok` foi aceito.
//
// Última linha do log:
// - `RESULTADO: backup_ok`;
// - `RESULTADO: backup_concluido_monitoramento_falhou`: o backup vale (pasta
//   com `resumo.json`), mas o Sentry não aceitou o `ok`. Sai com 1;
// - `RESULTADO: backup_incerto` (ERR_RESUMO_INCERTO): o `resumo.json` pode
//   ter sido gravado; conferir no B2. Sai com 1;
// - `RESULTADO: backup_falhou`: nenhuma pasta nova com `resumo.json`. Sai
//   com 1.
import { appendFileSync } from "node:fs";
import { Parada } from "./entrada-oculta.mjs";
import { executarBackup, lerConfiguracao, limparDetalhe, segredosDa } from "./backup-agendado-lib.mjs";
import { encerrarTodas } from "./operacao-piloto.mjs";

const log = (linha) => console.log(linha);
let segredos = [];

async function principal() {
  const config = lerConfiguracao(process.env);
  segredos = segredosDa(config);
  const resumo = await executarBackup(config, { log });
  if (process.env.GITHUB_STEP_SUMMARY) {
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        `### Backup ${resumo.tipo} concluído${resumo.monitoramento === "ok" ? "" : " (check-in ok NÃO aceito pelo monitor)"}`,
        "",
        `- Ponto de recuperação: ${resumo.pontoDeRecuperacao}`,
        `- Retenção até: ${resumo.retencaoAte}`,
        `- Dump: ${kb(resumo.dumpClaroBytes)} claro, ${kb(resumo.objetos.dump.bytes)} cifrado`,
        `- Duração: ${(resumo.duracoesMs.total / 1000).toFixed(1)} s`,
        "",
      ].join("\n"),
    );
  }
  if (resumo.monitoramento !== "ok") process.exitCode = 1;
}

principal()
  .catch((erro) => {
    const codigo = erro instanceof Parada ? erro.message : "ERR_INESPERADO";
    log(`ERRO: ${codigo}`);
    if (!(erro instanceof Parada)) log(`DETALHE: ${limparDetalhe(`${erro?.code ?? ""} ${erro?.message ?? erro}`, segredos)}`);
    log(`RESULTADO: ${codigo === "ERR_RESUMO_INCERTO" ? "backup_incerto" : "backup_falhou"}`);
    process.exitCode = 1;
  })
  .finally(() => encerrarTodas());
