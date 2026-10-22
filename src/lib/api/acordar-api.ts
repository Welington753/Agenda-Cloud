// Pedido de partida da API hibernada, feito pelo NAVEGADOR.
//
// No plano gratuito do Render, os pedidos que o proxy (`/agenda_api`, no
// servidor do web) faz à API hibernada recebem uma página 502 da hospedagem
// em menos de 1 s, e a API nunca sobe. Pedidos vindos de fora do Render
// sobem a API em ~15 s e respondem em ~32 s (logs do piloto, 2026-10-22; ver
// docs/plans/recuperacao-apos-hibernacao-continuidade.md). Por isso, quando
// o proxy avisa que a hospedagem respondeu no lugar da API, o navegador faz
// UM pedido direto à raiz pública da API e não usa a resposta.
//
// Regras:
// - só depois de um pedido da pessoa falhar assim, nunca por temporizador;
// - `GET /`, `no-cors`, sem cookie: nada de sessão nem escrita sai por aqui,
//   e a resposta (opaca) é descartada. Os pedidos de verdade continuam pelo
//   proxy;
// - no máximo um a cada `INTERVALO_MINIMO_MS`;
// - independente do cancelamento da leitura que o disparou: a partida só
//   começa se o pedido chegar a ser atendido.

/** Maior que a subida observada (~32 s): um pedido em andamento já basta. */
export const INTERVALO_MINIMO_MS = 60_000;

let ultimoPedido: number | null = null;

/** Origem aceita para o pedido, ou `null`. HTTPS; HTTP só em endereço local. */
export function origemParaAcordar(valor: string | null): string | null {
  if (!valor) return null;
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}

/** Pede a partida da API, se a origem for válida e o último pedido tiver
 * sido há mais de `INTERVALO_MINIMO_MS`. Nunca lança nem espera. */
export function pedirPartidaDaApi(valor: string | null, agora = Date.now()): boolean {
  const origem = origemParaAcordar(valor);
  if (origem === null) return false;
  if (ultimoPedido !== null && agora - ultimoPedido < INTERVALO_MINIMO_MS) return false;
  ultimoPedido = agora;
  fetch(`${origem}/`, { mode: "no-cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }).catch(
    () => undefined,
  );
  return true;
}

/** Só para testes. */
export function reiniciarPedidosDePartida(): void {
  ultimoPedido = null;
}
