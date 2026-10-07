// Marcador compartilhado entre o proxy (servidor, lib/api/proxy.ts) e o
// cliente HTTP (navegador, lib/api/http-client.ts). Arquivo à parte para o
// navegador nunca importar o código do proxy, que usa módulos do Node.

/** Marca as respostas em que a API não respondeu. O cliente HTTP trata como
 * falha de rede, nunca como resposta da API. */
export const CABECALHO_ERRO_PROXY = "x-agenda-proxy-error";
export const ERRO_API_INDISPONIVEL = "upstream-unavailable";
