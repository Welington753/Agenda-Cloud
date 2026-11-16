// Relé HTTP LOCAL entre o Next.js e a API, só para a suíte `proxy`
// (playwright.proxy.config.ts). No modo normal, repassa tudo à API sem mudar
// nada. O teste troca o modo para simular a API do piloto lenta, fora ou
// hibernada:
//
// - `normal`: repassa (padrão);
// - `lenta`: segura o pedido por `ESPERA_LENTA_MS` antes de repassar, mais
//   que o prazo da leitura do servidor do web (2,5 s);
// - `fora`: responde 502 em HTML, como a borda da hospedagem com a API
//   caída ou acordando;
// - `hibernada-texto` e `hibernada-html`: a API do plano gratuito dormindo,
//   como observado no piloto em 2026-11-16. Todo pedido recebe na hora um
//   429 da hospedagem (texto puro `Too Many Requests` ou a página de desafio
//   da Cloudflare, sem `Retry-After` nem `RateLimit-*`) e a API não sobe.
//   Só um `GET /` a acorda: é o pedido de partida que o navegador faz direto
//   na origem da API (src/lib/api/acordar-api.ts), e o proxy do web nunca
//   pede esse caminho. O pedido de partida fica pendurado por
//   `ESPERA_PARTIDA_MS` (a subida), o modo volta a `normal` e só então ele é
//   repassado. No piloto quem decide é a origem do pedido (de dentro ou de
//   fora do Render); aqui, o caminho.
//
// O modo muda por `POST http://127.0.0.1:<RELE_CONTROLE>/modo/<modo>`, numa
// porta separada que o proxy do web nunca alcança; a troca zera os
// contadores. `GET /estado` na mesma porta devolve o modo e os contadores.
// Só escuta em 127.0.0.1. Nunca usar fora de teste.
import http from "node:http";

const PORTA = Number(process.env.RELE_PORTA ?? 3002);
const CONTROLE = Number(process.env.RELE_CONTROLE ?? 3446);
const DESTINO_PORTA = Number(process.env.RELE_DESTINO_PORTA ?? 3001);
const ESPERA_LENTA_MS = 4_000;
/** Maior que a primeira espera entre leituras da tela (2 s): pelo menos uma
 * nova leitura ainda encontra a API dormindo depois do pedido de partida. */
const ESPERA_PARTIDA_MS = 3_000;

// Trecho da página de desafio recebida no piloto (2026-11-16), sem os
// valores de sessão do desafio.
const PAGINA_DE_DESAFIO =
  '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>' +
  '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
  '<meta name="robots" content="noindex,nofollow"></head><body>' +
  '<noscript><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></noscript>' +
  "<script>(function(){window._cf_chl_opt = {cType: 'managed',cZone: 'api.exemplo.test'};" +
  "var a = document.createElement('script');" +
  "a.src = '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=0000000000000000';" +
  "document.getElementsByTagName('head')[0].appendChild(a);}());</script></body></html>";

const RESPOSTAS_DA_HOSPEDAGEM = {
  "hibernada-texto": { tipo: "text/plain; charset=utf-8", corpo: "Too Many Requests\n" },
  "hibernada-html": { tipo: "text/html; charset=UTF-8", corpo: PAGINA_DE_DESAFIO },
};
const MODOS = new Set(["normal", "lenta", "fora", ...Object.keys(RESPOSTAS_DA_HOSPEDAGEM)]);

let modo = "normal";
let partidas = 0;
let respostasDaHospedagem = 0;

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
    const daHospedagem = RESPOSTAS_DA_HOSPEDAGEM[modo];
    if (daHospedagem) {
      if (entrada.method === "GET" && entrada.url === "/") {
        partidas += 1;
        const subida = setTimeout(() => {
          modo = "normal";
          repassar(entrada, saida);
        }, ESPERA_PARTIDA_MS);
        saida.on("close", () => clearTimeout(subida));
        return;
      }
      entrada.resume();
      respostasDaHospedagem += 1;
      saida.writeHead(429, { "content-type": daHospedagem.tipo }).end(daHospedagem.corpo);
      return;
    }
    repassar(entrada, saida);
  })
  .listen(PORTA, "127.0.0.1");

http
  .createServer((entrada, saida) => {
    if (entrada.method === "GET" && entrada.url === "/estado") {
      saida
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ modo, partidas, respostasDaHospedagem }));
      return;
    }
    const m = /^\/modo\/([a-z-]+)$/.exec(entrada.url ?? "");
    if (entrada.method !== "POST" || !m || !MODOS.has(m[1])) {
      saida.writeHead(404).end();
      return;
    }
    modo = m[1];
    partidas = 0;
    respostasDaHospedagem = 0;
    saida.writeHead(200, { "content-type": "text/plain" }).end(modo);
  })
  .listen(CONTROLE, "127.0.0.1");
