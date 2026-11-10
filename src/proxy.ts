// Proxy do Next.js (antes "middleware"): roda no servidor antes da resposta.
// Único uso: a decisão de indexação da página pública `/agendar/<slug>`
// (estabelecimento de teste fora da busca), tomada uma vez por requisição e
// usada pelo cabeçalho `X-Robots-Tag` e pelo HTML. Regras em
// src/lib/agendamento-publico/proxy-da-pagina-publica.ts e
// indexacao-da-pagina.ts. Nada aqui decide acesso ou sessão.
import type { NextRequest } from "next/server";
import { respostaDoProxyAgendar } from "@/lib/agendamento-publico/proxy-da-pagina-publica";

export function proxy(request: NextRequest) {
  return respostaDoProxyAgendar(request);
}

export const config = {
  matcher: "/agendar/:slug",
};
