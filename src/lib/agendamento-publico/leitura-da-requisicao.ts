// Leitura da página pública na requisição atual do Next.js, compartilhada
// pelo layout de `/agendar/[slug]` e pelo endereço curto `/[slug]`.
// `cache` do React vale só para a requisição em andamento: junta as leituras
// dos metadados e da página, e nunca entrega o resultado de uma requisição
// (ou de um estabelecimento) a outra. A leitura em si não usa cache
// (`cache: "no-store"`, ver pagina-no-servidor.ts).
import { cache } from "react";
import { headers } from "next/headers";
import { lerConfiguracaoProxy } from "@/lib/api/proxy-config";
import { CABECALHO_CLASSIFICACAO, classificacaoDoCabecalho } from "./indexacao-da-pagina";
import { lerPaginaNoServidor } from "./pagina-no-servidor";

export const lerPaginaDaRequisicao = cache(async (slug: string) => {
  const proxy = lerConfiguracaoProxy(process.env);
  return lerPaginaNoServidor(slug, proxy.ok ? proxy.configuracao : null, await headers());
});

/** Decisão de indexação que src/proxy.ts deixou nesta requisição, ou `null`
 * (proxy sem configuração, ou estabelecimento inexistente). O proxy apaga o
 * cabeçalho vindo do cliente antes de escrever o seu. */
export const lerClassificacaoDoProxy = cache(async () =>
  classificacaoDoCabecalho((await headers()).get(CABECALHO_CLASSIFICACAO)),
);
