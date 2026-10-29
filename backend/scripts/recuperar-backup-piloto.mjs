// Recuperação de um backup agendado do piloto com a chave age OFFLINE (lote
// O1). Não depende do GitHub nem do Neon: os arquivos vêm do B2 (baixados
// pela interface da Backblaze) e o destino é qualquer PostgreSQL com TLS
// verificado, com o schema `public` vazio. Também é o teste mensal de
// restauração, com um PostgreSQL descartável local como destino. O roteiro,
// com os comandos manuais equivalentes, está em
// docs/runbooks/backup-piloto-automatico.md.
//
// Ambiente: RECUPERACAO_DUMP e RECUPERACAO_MANIFESTO (os `.age` baixados),
// RECUPERACAO_IDENTIDADE (arquivo da chave privada, nunca impresso),
// RECUPERACAO_URL (banco de destino), RECUPERACAO_CA (opcional; obrigatório
// em 127.0.0.1), RECUPERACAO_PASTA (pasta de trabalho fora do repositório),
// AGE_BIN e PG_BIN.
//
// 1. decifra o manifesto e o dump numa pasta temporária;
// 2. sha256 do dump igual ao do manifesto;
// 3. pg_restore numa transação no destino vazio;
// 4. contagem e md5 de cada tabela iguais aos do manifesto.
// O dump e o manifesto decifrados são apagados no fim, com sucesso ou falha.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import path from "node:path";
import { Parada } from "./entrada-oculta.mjs";
import { destinoDaRecuperacao, executar, limparDetalhe, restaurarEConferir } from "./backup-agendado-lib.mjs";
import { encerrarTodas, parar, pastaForaDoRepositorio, sha256DoArquivo } from "./operacao-piloto.mjs";

const log = (linha) => console.log(linha);
const env = process.env;
let segredos = [];

async function decifrar(age, identidade, entrada, saida) {
  const { codigo, stderr } = await executar(age, ["-d", "-i", identidade, "-o", saida, entrada]).catch(() => ({ codigo: -1, stderr: "age não iniciou" }));
  if (codigo !== 0) {
    log(`DETALHE: age saiu com ${codigo}: ${limparDetalhe(stderr, segredos)}`);
    parar("ERR_DECIFRAR");
  }
}

async function principal() {
  const exigir = (nome) => {
    if (!env[nome]?.trim()) parar(`ERR_VARIAVEL_AUSENTE_${nome}`);
    return env[nome].trim();
  };
  const [dumpCifrado, manifestoCifrado, identidade] = ["RECUPERACAO_DUMP", "RECUPERACAO_MANIFESTO", "RECUPERACAO_IDENTIDADE"].map(exigir);
  for (const arquivo of [dumpCifrado, manifestoCifrado, identidade]) if (!existsSync(arquivo)) parar("ERR_ARQUIVO_AUSENTE");
  const pasta = exigir("RECUPERACAO_PASTA");
  if (!existsSync(pasta) || !pastaForaDoRepositorio(pasta)) parar("ERR_PASTA_DE_RECUPERACAO_INVALIDA");
  const age = exigir("AGE_BIN");
  const pgRestore = path.join(exigir("PG_BIN"), process.platform === "win32" ? "pg_restore.exe" : "pg_restore");
  const destino = destinoDaRecuperacao(exigir("RECUPERACAO_URL"), env.RECUPERACAO_CA);
  segredos = [destino.password, env.RECUPERACAO_URL, identidade];

  const temp = mkdtempSync(path.join(pasta, "agenda-cloud-recuperacao-"));
  try {
    if (!destino.caArquivo) {
      destino.caArquivo = path.join(temp, "raizes-tls-node.pem");
      writeFileSync(destino.caArquivo, rootCertificates.join("\n"));
    }
    const manifestoClaro = path.join(temp, "manifesto.json");
    await decifrar(age, identidade, manifestoCifrado, manifestoClaro);
    const manifesto = JSON.parse(readFileSync(manifestoClaro, "utf8"));
    if (manifesto.formato !== "agenda-cloud-backup/1") parar("ERR_MANIFESTO_FORMATO_INESPERADO");
    log(`PONTO_DE_RECUPERACAO: ${manifesto.pontoDeRecuperacao}  SERVIDOR_ORIGEM: ${manifesto.servidor}  COMMIT: ${manifesto.commit}`);

    const dump = path.join(temp, manifesto.dump.arquivo);
    await decifrar(age, identidade, dumpCifrado, dump);
    if (sha256DoArquivo(dump) !== manifesto.dump.sha256) parar("ERR_SHA256_DIFERENTE_DO_MANIFESTO");
    log("SHA256_CONFERE: true");

    const { tabelas } = await restaurarEConferir({
      dump,
      servidor: destino,
      nomeDoBanco: destino.database,
      esperado: manifesto,
      pgRestore,
      criarBanco: false,
      log,
      segredos,
    });
    log(`RESULTADO: recuperacao_conferida (${tabelas} tabelas, ${manifesto.migrations.length} migrations no histórico)`);
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    log(`DECIFRADOS_APAGADOS: ${!existsSync(temp)}`);
  }
}

principal()
  .catch((erro) => {
    const codigo = erro instanceof Parada ? erro.message : "ERR_INESPERADO";
    log(`ERRO: ${codigo}`);
    if (!(erro instanceof Parada)) log(`DETALHE: ${limparDetalhe(`${erro?.code ?? ""} ${erro?.message ?? erro}`, segredos)}`);
    process.exitCode = 1;
  })
  .finally(() => encerrarTodas());
