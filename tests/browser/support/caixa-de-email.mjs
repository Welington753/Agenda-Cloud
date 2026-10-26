// Caixa de e-mail LOCAL para os testes de navegador: responde como a API do
// Brevo (`POST /v3/smtp/email`), guarda as mensagens em memória e deixa o
// teste lê-las. Nada sai da máquina; só escuta em 127.0.0.1. Nunca usada fora
// dos testes (a API recusa `EMAIL_API_BASE_URL` em production).
//
//   GET  /saude                  pronto (o Playwright espera por ele)
//   GET  /mensagens?para=email   mensagens recebidas para o endereço (assunto,
//                                texto simples e HTML)
//   POST /controle {"falhar":b}  com `true`, recusa os envios (HTTP 500)
import { createServer } from "node:http";

const PORTA = Number(process.env.CAIXA_DE_EMAIL_PORTA ?? 3025);
export const CHAVE_LOCAL = "chave-local-de-teste";

const mensagens = [];
let falhar = false;

function ler(req) {
  return new Promise((resolve) => {
    let corpo = "";
    req.on("data", (parte) => (corpo += parte));
    req.on("end", () => resolve(corpo));
  });
}

function json(res, status, corpo) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(corpo === undefined ? "" : JSON.stringify(corpo));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORTA}`);
  if (req.method === "GET" && url.pathname === "/saude") return json(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/mensagens") {
    const para = (url.searchParams.get("para") ?? "").toLowerCase();
    return json(res, 200, mensagens.filter((m) => m.para === para));
  }
  if (req.method === "POST" && url.pathname === "/controle") {
    falhar = JSON.parse((await ler(req)) || "{}").falhar === true;
    return json(res, 200, { falhar });
  }
  if (req.method === "POST" && url.pathname === "/v3/smtp/email") {
    const corpo = await ler(req);
    if (req.headers["api-key"] !== CHAVE_LOCAL) return json(res, 401, { message: "chave inválida" });
    if (falhar) return json(res, 500, { message: "falha simulada" });
    const dados = JSON.parse(corpo);
    mensagens.push({
      para: String(dados.to?.[0]?.email ?? "").toLowerCase(),
      assunto: dados.subject,
      texto: dados.textContent,
      html: dados.htmlContent,
      recebidaEm: new Date().toISOString(),
    });
    return json(res, 201, { messageId: `local-${mensagens.length}` });
  }
  return json(res, 404, { message: "não encontrado" });
}).listen(PORTA, "127.0.0.1");
