// Liberação de EMERGÊNCIA do segundo fator no banco do piloto (D5): só o
// operador autorizado, pelo roteiro docs/runbooks/publicacao-2fa-administrativo.md
// ("Emergência"), depois do backup e de `pilot:check-database`. A URL direta é
// digitada oculta (nunca variável, arquivo ou argumento) e conferida como nas
// outras operações do piloto (endpoint, banco, TLS no socket).
//
//   node scripts/liberar-2fa-emergencia.mjs --email=<e-mail da conta> --motivo="<motivo>"
//
// Ambiente: PILOT_ENDPOINT_ID, PRODUCTION_ENDPOINT_ID e AGENDA_OPS_DIR (fora
// do repositório), como nos lançadores `abrir-*-piloto.ps1`.
//
// Mostra o caminho da liberação UMA vez no terminal. O registro de operações
// guarda só o id da liberação, a conta e o horário, nunca o token.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { MOTIVOS, Parada, conferirConfirmacao, lerConfirmacao, lerOculto } from "./entrada-oculta.mjs";
import { conectar, conferirDestino, encerrarTodas, pastaForaDoRepositorio, registrar } from "./operacao-piloto.mjs";
import { RecusaDaLiberacao, caminhoDaLiberacao, emitirLiberacaoDeEmergencia } from "./liberar-2fa-emergencia-lib.mjs";

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [chave, ...valor] = a.replace(/^--/, "").split("=");
    return [chave, valor.join("=")];
  }),
);
const ENDPOINT_PILOTO = (process.env.PILOT_ENDPOINT_ID ?? "").trim();
const ENDPOINT_PROIBIDO = (process.env.PRODUCTION_ENDPOINT_ID ?? "").trim();
const PASTA = process.env.AGENDA_OPS_DIR ?? path.join(homedir(), "AgendaCloud-operacoes");
const log = (texto) => process.stdout.write(`${texto}\n`);

async function principal() {
  const email = (argumentos.email ?? "").trim();
  const motivo = (argumentos.motivo ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Parada("informe --email=<e-mail da conta>");
  if (!ENDPOINT_PILOTO || !ENDPOINT_PROIBIDO) throw new Parada("PILOT_ENDPOINT_ID e PRODUCTION_ENDPOINT_ID são obrigatórios");
  pastaForaDoRepositorio(PASTA);
  mkdirSync(PASTA, { recursive: true });

  const bruta = await lerOculto("URL direta do banco do piloto (oculta): ");
  const destino = conferirDestino(bruta, { endpointPiloto: ENDPOINT_PILOTO, endpointProibido: ENDPOINT_PROIBIDO });
  const frase = `LIBERAR 2FA ${email}`;
  const resposta = await lerConfirmacao(`Digite exatamente "${frase}" para continuar: `);
  conferirConfirmacao(resposta, frase);

  const cliente = await conectar(destino, { aplicacao: "agenda-liberar-2fa-emergencia", log });
  try {
    const r = await emitirLiberacaoDeEmergencia(cliente, { email, motivo });
    registrar(path.join(PASTA, "operacoes.jsonl"), {
      operacao: "liberar-2fa-emergencia",
      em: new Date().toISOString(),
      conta: r.userId,
      liberacao: r.grantId,
      expiraEm: r.expiraEm.toISOString(),
    });
    log("");
    log("Liberação emitida. Sessões da conta encerradas. Válida por 60 minutos, uma única vez.");
    log("1. Entre no portal com a senha da conta.");
    log("2. Abra o endereço do portal seguido deste caminho (não copie para nenhum outro lugar):");
    log(`   ${caminhoDaLiberacao(r.token)}`);
    log("3. Cadastre o novo aplicativo autenticador e guarde os códigos de recuperação.");
  } finally {
    await encerrarTodas();
  }
}

principal().catch((erro) => {
  if (erro instanceof RecusaDaLiberacao) log(`RECUSADO (${erro.codigo}): ${erro.message}`);
  else if (erro instanceof Parada) log(`PARADO: ${MOTIVOS[erro.message] ?? erro.message}`);
  else log(`ERRO: ${erro?.code ?? "sem código"}`);
  process.exitCode = 1;
});
