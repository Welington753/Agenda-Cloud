// O que src/proxy.ts faz em `/agendar/<slug>`, separado para teste.
//
// 1. Apaga o cabeçalho interno `CABECALHO_CLASSIFICACAO` de toda requisição
//    que chega: só este código escreve a decisão que o layout lê.
// 2. Em GET/HEAD com o proxy da API configurado, lê a página na API (mesma
//    leitura do layout: destino fixo, prazo de 2,5 s, sem cache, sem cookie
//    do visitante) e decide pela regra de indexacao-da-pagina.ts:
//    - classificada (pela API ou pela memória): segue para a página com a
//      decisão no cabeçalho interno, e `X-Robots-Tag` se for teste;
//    - inexistente: segue sem decisão (o layout responde 404 com `noindex`);
//    - indisponível: responde 503 aqui mesmo, sem renderizar a página.
// 3. Sem configuração do proxy (desenvolvimento, suítes em chamada direta),
//    nada é lido; o layout decide sozinho e trata a dúvida como não indexável.
import { NextResponse, type NextRequest } from "next/server";
import { lerConfiguracaoProxy } from "@/lib/api/proxy-config";
import {
  CABECALHO_CLASSIFICACAO,
  CABECALHO_ROBOTS,
  MEMORIA_DO_PROCESSO,
  decidirIndexacao,
  respostaIndisponivel,
  robotsDaClassificacao,
  slugDoCaminhoAgendar,
  type MemoriaDeClassificacao,
} from "./indexacao-da-pagina";
import { lerPaginaNoServidor } from "./pagina-no-servidor";

export interface DependenciasDoProxy {
  memoria: MemoriaDeClassificacao;
  agora: () => number;
  ambiente: Record<string, string | undefined>;
  prazoMs?: number;
}

const PADRAO: DependenciasDoProxy = { memoria: MEMORIA_DO_PROCESSO, agora: Date.now, ambiente: process.env };

export async function respostaDoProxyAgendar(
  request: NextRequest,
  dependencias: DependenciasDoProxy = PADRAO,
): Promise<Response> {
  const cabecalhos = new Headers(request.headers);
  cabecalhos.delete(CABECALHO_CLASSIFICACAO);
  const seguir = () => NextResponse.next({ request: { headers: cabecalhos } });

  if (request.method !== "GET" && request.method !== "HEAD") return seguir();
  const slug = slugDoCaminhoAgendar(request.nextUrl.pathname);
  if (slug === null) return seguir();
  const configuracao = lerConfiguracaoProxy(dependencias.ambiente);
  if (!configuracao.ok) return seguir();

  const leitura = await lerPaginaNoServidor(
    slug,
    configuracao.configuracao,
    request.headers,
    undefined,
    dependencias.prazoMs,
  );
  const decisao = decidirIndexacao(leitura, slug, dependencias.memoria, dependencias.agora());

  if (decisao.tipo === "indisponivel") {
    const indisponivel = respostaIndisponivel(request.nextUrl.pathname);
    return new Response(request.method === "HEAD" ? null : indisponivel.corpo, {
      status: indisponivel.status,
      headers: indisponivel.headers,
    });
  }
  if (decisao.tipo === "inexistente") return seguir();

  cabecalhos.set(CABECALHO_CLASSIFICACAO, decisao.classificacao);
  const resposta = seguir();
  const robots = robotsDaClassificacao(decisao.classificacao);
  if (robots !== null) resposta.headers.set(CABECALHO_ROBOTS, robots);
  return resposta;
}
