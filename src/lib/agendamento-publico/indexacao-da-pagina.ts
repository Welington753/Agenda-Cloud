// Indexação da página pública (`/agendar/<slug>`) de um estabelecimento de
// teste. UMA decisão por requisição, tomada em src/proxy.ts antes da resposta,
// vale para o cabeçalho `X-Robots-Tag` e para o HTML (o layout lê a decisão
// pelo cabeçalho interno `CABECALHO_CLASSIFICACAO`, sem decidir de novo).
// Assim o cabeçalho e o HTML nunca divergem, mesmo que as duas leituras da
// API (a do proxy e a do layout) tenham resultados diferentes.
//
// Regras da decisão (`decidirIndexacao`):
// - API respondeu a página: a classificação vem dela (`indexable: false` é
//   teste; `true` ou ausente, de uma API anterior ao campo, é indexável);
// - API confirmou que não existe (404): nada a classificar, a página 404 já
//   leva `noindex`;
// - API lenta, fora ou ilegível: 503 com `Retry-After`
//   (`respostaIndisponivel`). Nunca 404.
//
// Nenhuma classificação antiga é reaproveitada. Só a leitura da própria
// requisição vale: uma lembrada poderia estar desatualizada (marca trocada no
// portal logo antes de a API falhar) e diferir entre processos do web. Uma
// dúvida nunca vira "indexável", e um estabelecimento real também não ganha
// `noindex` por uma falha passageira.
import { paginaIndexavel } from "./metadados-publicos";
import type { PaginaNoServidor } from "./pagina-no-servidor";

export const CABECALHO_ROBOTS = "X-Robots-Tag";
export const VALOR_SEM_INDEXACAO = "noindex, nofollow";

/** Cabeçalho INTERNO, da requisição: do proxy para o layout. O proxy o
 * apaga de toda requisição que chega, para nenhum cliente escolher a
 * decisão. */
export const CABECALHO_CLASSIFICACAO = "x-agenda-indexacao";

export type Classificacao = "indexavel" | "teste";

/** `Retry-After` do 503, em segundos. Só uma sugestão de espera: a página
 * volta quando a API voltar a responder, o que pode levar mais. */
export const ESPERA_PARA_NOVA_TENTATIVA_S = 30;

export type DecisaoDeIndexacao =
  | { tipo: "classificada"; classificacao: Classificacao }
  | { tipo: "inexistente" }
  | { tipo: "indisponivel" };

export function classificacaoDaPagina(leitura: Extract<PaginaNoServidor, { tipo: "encontrada" }>): Classificacao {
  return paginaIndexavel(leitura.pagina) ? "indexavel" : "teste";
}

export function decidirIndexacao(leitura: PaginaNoServidor): DecisaoDeIndexacao {
  if (leitura.tipo === "encontrada") return { tipo: "classificada", classificacao: classificacaoDaPagina(leitura) };
  if (leitura.tipo === "inexistente") return { tipo: "inexistente" };
  return { tipo: "indisponivel" };
}

export function robotsDaClassificacao(classificacao: Classificacao): string | null {
  return classificacao === "teste" ? VALOR_SEM_INDEXACAO : null;
}

/** Valor do cabeçalho interno, ou `null` se ausente ou estranho. */
export function classificacaoDoCabecalho(valor: string | null): Classificacao | null {
  return valor === "indexavel" || valor === "teste" ? valor : null;
}

/** Se o HTML pode ser indexado. A decisão do proxy manda; sem ela (proxy sem
 * configuração: desenvolvimento e suítes em chamada direta), só uma página
 * lida da API e não marcada como teste é indexável. Dúvida nunca é. */
export function paginaPodeSerIndexada(classificacaoDoProxy: Classificacao | null, leitura: PaginaNoServidor): boolean {
  if (classificacaoDoProxy !== null) return classificacaoDoProxy === "indexavel";
  return leitura.tipo === "encontrada" && paginaIndexavel(leitura.pagina);
}

/** Slug do caminho `/agendar/<slug>` (um segmento só), ou `null`. */
export function slugDoCaminhoAgendar(caminho: string): string | null {
  const m = /^\/agendar\/([^/]+)\/?$/.exec(caminho);
  return m ? m[1] : null;
}

/** Resposta temporária quando não há classificação confiável: 503, nunca
 * guardada em cache, com nova tentativa automática (sem JavaScript) e um
 * link para tentar na hora. Sem `noindex`: buscadores não indexam um 503 e
 * voltam depois; um `noindex` aqui poderia tirar da busca um
 * estabelecimento real por causa de uma falha passageira. */
export function respostaIndisponivel(caminho: string): { status: 503; headers: Record<string, string>; corpo: string } {
  const destino = caminho.replace(/[^a-zA-Z0-9/_.~%-]/g, "");
  const corpo = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Agenda abrindo · TimVix</title>
</head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;line-height:1.5">
<h1 style="font-size:1.25rem">Estamos abrindo esta agenda</h1>
<p>O serviço está demorando um pouco para responder. A página tenta de novo sozinha em alguns segundos.</p>
<p><a href="${destino}">Tentar de novo agora</a></p>
</body>
</html>
`;
  return {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(ESPERA_PARA_NOVA_TENTATIVA_S),
    },
    corpo,
  };
}
