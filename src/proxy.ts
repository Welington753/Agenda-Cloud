// Proxy do Next.js (antes "middleware"): roda no servidor antes da resposta.
// Único uso: o cabeçalho `X-Robots-Tag: noindex, nofollow` na página pública
// de um estabelecimento de teste (regras em
// src/lib/agendamento-publico/indexacao-da-pagina.ts). Nada aqui decide
// acesso, sessão ou conteúdo; a página segue igual para todo mundo.
//
// A leitura é a mesma do layout (`lerPaginaNoServidor`: destino fixo do
// proxy da API, prazo de 2,5 s, sem cache, sem cookie do visitante). Sem
// configuração do proxy (desenvolvimento, suítes em chamada direta), nada é
// lido e nenhum cabeçalho é posto.
import { NextResponse, type NextRequest } from "next/server";
import { lerConfiguracaoProxy } from "@/lib/api/proxy-config";
import {
  CABECALHO_ROBOTS,
  robotsDaPaginaPublica,
  slugDoCaminhoAgendar,
} from "@/lib/agendamento-publico/indexacao-da-pagina";
import { lerPaginaNoServidor } from "@/lib/agendamento-publico/pagina-no-servidor";

export async function proxy(request: NextRequest) {
  const resposta = NextResponse.next();
  if (request.method !== "GET" && request.method !== "HEAD") return resposta;
  const slug = slugDoCaminhoAgendar(request.nextUrl.pathname);
  if (slug === null) return resposta;
  const configuracao = lerConfiguracaoProxy(process.env);
  if (!configuracao.ok) return resposta;
  const robots = robotsDaPaginaPublica(await lerPaginaNoServidor(slug, configuracao.configuracao, request.headers));
  if (robots !== null) resposta.headers.set(CABECALHO_ROBOTS, robots);
  return resposta;
}

export const config = {
  matcher: "/agendar/:slug",
};
