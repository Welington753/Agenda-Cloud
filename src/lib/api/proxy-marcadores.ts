// Marcador compartilhado entre o proxy (servidor, lib/api/proxy.ts) e o
// cliente HTTP (navegador, lib/api/http-client.ts). Arquivo à parte para o
// navegador nunca importar o código do proxy, que usa módulos do Node.

/** Marca as respostas em que a API não respondeu. O cliente HTTP trata como
 * falha de rede, nunca como resposta da API. */
export const CABECALHO_ERRO_PROXY = "x-agenda-proxy-error";
export const ERRO_API_INDISPONIVEL = "upstream-unavailable";

/** Origem pública da API, só nas respostas em que a hospedagem respondeu no
 * lugar dela (página HTML 5xx do Render). No plano gratuito, um pedido do
 * próprio serviço web nunca acorda a API hibernada (observado no piloto em
 * 2026-10-22, ver docs/plans/recuperacao-apos-hibernacao-continuidade.md);
 * um pedido do navegador acorda. Ver lib/api/acordar-api.ts. */
export const CABECALHO_ACORDAR_API = "x-agenda-acordar-api";
