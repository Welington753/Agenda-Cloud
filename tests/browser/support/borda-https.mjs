// Borda HTTPS LOCAL para o teste do proxy na mesma origem
// (playwright.proxy.config.ts). Faz, na máquina de teste, o papel que a
// borda do Render (Cloudflare) faz na hospedagem:
//
// - termina o TLS com um certificado autoassinado, gerado agora numa pasta
//   temporária e apagado ao sair (nunca versionado, nunca reutilizado);
// - SOBRESCREVE `CF-Connecting-IP` com o endereço da conexão e ACRESCENTA
//   esse endereço ao `X-Forwarded-For` que o cliente mandou, o
//   comportamento descrito pelo Render (runbook, seção 5);
// - encaminha em HTTP ao `next start` local.
//
// Só escuta em 127.0.0.1. Nunca usar fora de teste.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";

const PORTA = Number(process.env.BORDA_PORTA ?? 3443);
const DESTINO_PORTA = Number(process.env.BORDA_DESTINO_PORTA ?? 3000);

const pasta = mkdtempSync(path.join(tmpdir(), "agenda-borda-https-"));
const chave = path.join(pasta, "chave.pem");
const certificado = path.join(pasta, "certificado.pem");
execFileSync(
  "openssl",
  [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout", chave, "-out", certificado,
  ],
  { stdio: "ignore" },
);
const tls = { key: readFileSync(chave), cert: readFileSync(certificado) };
rmSync(pasta, { recursive: true, force: true });

function enderecoDoCliente(socket) {
  const endereco = socket.remoteAddress ?? "";
  return endereco.startsWith("::ffff:") ? endereco.slice(7) : endereco;
}

const servidor = https.createServer(tls, (entrada, saida) => {
  const ip = enderecoDoCliente(entrada.socket);
  const headers = { ...entrada.headers };
  headers["cf-connecting-ip"] = ip;
  headers["x-forwarded-for"] = headers["x-forwarded-for"] ? `${headers["x-forwarded-for"]}, ${ip}` : ip;
  headers["x-forwarded-proto"] = "https";

  const destino = http.request(
    { host: "127.0.0.1", port: DESTINO_PORTA, method: entrada.method, path: entrada.url, headers },
    (resposta) => {
      saida.writeHead(resposta.statusCode ?? 502, resposta.headers);
      resposta.pipe(saida);
    },
  );
  destino.on("error", () => {
    if (!saida.headersSent) saida.writeHead(502);
    saida.end();
  });
  entrada.pipe(destino);
});

servidor.listen(PORTA, "127.0.0.1");
for (const sinal of ["SIGINT", "SIGTERM"]) process.on(sinal, () => servidor.close(() => process.exit(0)));
