// Leitura de sessão (GET /auth/me) com novas tentativas limitadas. Só para
// esta LEITURA: login, cadastro e qualquer escrita continuam com uma única
// tentativa por ação do usuário.
//
// Motivo: no plano gratuito do Render, a primeira requisição depois de um
// período sem acesso pode receber 502 da borda da hospedagem enquanto o
// serviço acorda (observado no piloto em 2026-10-21). Uma única leitura
// nesse momento mostrava "Não foi possível conectar ao servidor" mesmo com a
// sessão válida. Repetir algumas vezes, com espera crescente, cobre esse
// intervalo; se ainda falhar, a tela de falha aparece com "Tentar novamente".
import type { ResultadoAutenticacaoReal, SessaoRealContexto } from "@/lib/api/auth-api";

type ResultadoSessao = ResultadoAutenticacaoReal<SessaoRealContexto | null>;

/** Esperas antes de cada NOVA tentativa (5 leituras no máximo, ~30 s de
 * espera somada), na ordem de grandeza do tempo de partida do Render. */
export const ESPERAS_ENTRE_TENTATIVAS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000];

export interface OpcoesLeituraSessao {
  esperas?: readonly number[];
  /** Injetável nos testes; resolve ao fim da espera ou ao cancelamento. */
  esperar?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function esperarCancelavel(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const fim = () => {
      clearTimeout(temporizador);
      signal.removeEventListener("abort", fim);
      resolve();
    };
    const temporizador = setTimeout(fim, ms);
    signal.addEventListener("abort", fim);
  });
}

/** Resultado da última leitura feita, ou `null` se `signal` foi cancelado —
 * nesse caso nada deve ser aplicado ao estado. Leituras nunca se sobrepõem:
 * a próxima só começa depois da anterior terminar e da espera. Só
 * `falha_comunicacao` é repetida; 401, sessão válida e resposta inesperada
 * da API são conclusivos. */
export async function lerSessaoComTentativas(
  buscar: (signal: AbortSignal) => Promise<ResultadoSessao>,
  signal: AbortSignal,
  { esperas = ESPERAS_ENTRE_TENTATIVAS_MS, esperar = esperarCancelavel }: OpcoesLeituraSessao = {},
): Promise<ResultadoSessao | null> {
  for (let tentativa = 0; ; tentativa++) {
    const resultado = await buscar(signal);
    if (signal.aborted) return null;
    const repetir = !resultado.ok && resultado.falha.tipo === "falha_comunicacao";
    if (!repetir || tentativa >= esperas.length) return resultado;
    await esperar(esperas[tentativa] as number, signal);
    if (signal.aborted) return null;
  }
}
