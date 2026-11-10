// Relé HTTP LOCAL entre o Next.js e a API, só para a suíte `proxy`
// (playwright.proxy.config.ts). No modo normal, repassa tudo à API sem mudar
// nada. O teste troca o modo para simular a API do piloto lenta ou fora:
//
// - `normal`: repassa (padrão);
// - `lenta`: segura o pedido por `ESPERA_LENTA_MS` antes de repassar, mais
//   que o prazo da leitura do servidor do web (2,5 s);
// - `fora`: responde 502 em HTML, como a borda da hospedagem com a API
//   caída ou acordando.
//
// O modo muda por `POST http://127.0.0.1:<RELE_CONTROLE>/modo/<modo>`, numa
// porta separada que o proxy do web nunca alcança. Só escuta em 127.0.0.1.
// Nunca usar fora de teste.
import http from "node:http";

const PORTA = Number(process.env.RELE_PORTA ?? 3002);
const CONTROLE = Number(process.env.RELE_CONTROLE ?? 3446);
const DESTINO_PORTA = Number(process.env.RELE_DESTINO_PORTA ?? 3001);
const ESPERA_LENTA_MS = 4_000;
const MODOS = new Set(["normal", "lenta", "fora"]);

let modo = "normal";

function repassar(entrada, saida) {
  const destino = http.request(
    {
      host: "127.0.0.1",
      port: DESTINO_PORTA,
      method: entrada.method,
      path: entrada.url,
      headers: { ...entrada.headers, host: `localhost:${DESTINO_PORTA}` },
    },
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
}

http
  .createServer((entrada, saida) => {
    if (modo === "fora") {
      entrada.resume();
      saida.writeHead(502, { "content-type": "text/html" }).end("<h1>502 Bad Gateway</h1>");
      return;
    }
    if (modo === "lenta") {
      const espera = setTimeout(() => repassar(entrada, saida), ESPERA_LENTA_MS);
      saida.on("close", () => clearTimeout(espera));
      return;
    }
    repassar(entrada, saida);
  })
  .listen(PORTA, "127.0.0.1");

http
  .createServer((entrada, saida) => {
    const m = /^\/modo\/([a-z]+)$/.exec(entrada.url ?? "");
    if (entrada.method !== "POST" || !m || !MODOS.has(m[1])) {
      saida.writeHead(404).end();
      return;
    }
    modo = m[1];
    saida.writeHead(200, { "content-type": "text/plain" }).end(modo);
  })
  .listen(CONTROLE, "127.0.0.1");
