// Leitura SEGURA (GET) com recuperação enquanto a hospedagem acorda. Única
// implementação do sistema: a sessão (`real-auth-context.tsx`) e a página
// pública de agendamento usam esta mesma função. Login, cadastro e qualquer
// escrita continuam com uma única tentativa por ação da pessoa.
//
// Motivo: no plano gratuito do Render, o serviço sem tráfego por 15 min
// hiberna e leva perto de um minuto para voltar. Nesse intervalo a borda da
// hospedagem responde no lugar da API (502 em HTML, observado no piloto em
// 2026-10-21) ou a requisição fica pendurada. A própria leitura é o acesso
// que acorda a API; repetir com espera crescente cobre o intervalo.
//
// Limites (nunca uma consulta contínua):
// - uma requisição por vez: a próxima só começa depois da anterior terminar
//   e da espera;
// - cada tentativa tem tempo máximo (`tempoPorTentativaMs`);
// - o PRAZO TOTAL conta o relógio real desde o início, com o tempo das
//   requisições e das esperas, não só a soma das esperas;
// - sem internet, nada é enviado nem agendado: a leitura espera o evento
//   `online` do navegador e recomeça com prazo novo;
// - cancelar (`signal`) encerra na hora e devolve `null`: quem chamou não
//   aplica resultado nenhum.

export interface LimitesRecuperacao {
  /** Espera antes de cada NOVA tentativa; a última se repete até o prazo. */
  esperas: readonly number[];
  /** Tempo máximo de UMA requisição; depois dele ela é cancelada. */
  tempoPorTentativaMs: number;
  /** Prazo total, desde a primeira requisição, contando requisições e esperas. */
  prazoTotalMs: number;
  /** Requisição ainda sem resposta depois disto: a tela já avisa que o
   * servidor está demorando (a borda pode segurar a requisição enquanto o
   * serviço sobe, sem responder erro nenhum). */
  avisoDeDemoraMs: number;
}

/** Calibrados para a partida do Render gratuito (~1 min, ver
 * docs/runbooks/publicacao-piloto-render.md). O proxy do frontend espera a
 * API por até 90 s; aqui cada tentativa desiste antes, e a seguinte chega a
 * um serviço que já está subindo. */
export const LIMITES_PADRAO: LimitesRecuperacao = {
  esperas: [2_000, 4_000, 8_000, 15_000],
  tempoPorTentativaMs: 30_000,
  prazoTotalMs: 100_000,
  avisoDeDemoraMs: 3_000,
};

/** O que a tela deve mostrar enquanto a leitura não termina. */
export type FaseRecuperacao = "acordando" | "sem_internet";

export type DesfechoRecuperacao<R> =
  /** Resposta conclusiva (sucesso ou erro que não se resolve repetindo). */
  | { tipo: "concluida"; resultado: R }
  /** Prazo esgotado sem resposta da API; `resultado` é a última falha. */
  | { tipo: "esgotada"; resultado: R };

export interface ConexaoDoNavegador {
  offline: () => boolean;
  /** Resolve no próximo evento `online` ou no cancelamento. */
  esperarOnline: (signal: AbortSignal) => Promise<void>;
}

export interface OpcoesRecuperacao {
  limites?: LimitesRecuperacao;
  aoMudarFase?: (fase: FaseRecuperacao) => void;
  /** Injetável nos testes; padrão: `navigator.onLine` e eventos `online`. */
  conexao?: ConexaoDoNavegador;
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

export const conexaoDoNavegador: ConexaoDoNavegador = {
  offline: () => typeof navigator !== "undefined" && navigator.onLine === false,
  esperarOnline: (signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const fim = () => {
        window.removeEventListener("online", fim);
        signal.removeEventListener("abort", fim);
        resolve();
      };
      window.addEventListener("online", fim);
      signal.addEventListener("abort", fim);
    }),
};

/** Uma requisição com tempo máximo: o sinal entregue a `ler` é cancelado no
 * fim do tempo ou junto com `externo`. */
async function tentativaComLimite<R>(
  ler: (signal: AbortSignal) => Promise<R>,
  externo: AbortSignal,
  limiteMs: number,
  demora: { ms: number; avisar: () => void },
): Promise<R> {
  const controle = new AbortController();
  const cancelar = () => controle.abort();
  const temporizador = setTimeout(cancelar, limiteMs);
  const aviso = setTimeout(demora.avisar, demora.ms);
  externo.addEventListener("abort", cancelar);
  try {
    return await ler(controle.signal);
  } finally {
    clearTimeout(temporizador);
    clearTimeout(aviso);
    externo.removeEventListener("abort", cancelar);
  }
}

/**
 * `ler` faz UMA leitura e nunca lança (os clientes da API devolvem
 * resultado). `repetivel` diz se o resultado é "a API não respondeu" — só
 * isso é repetido. 401, 403, 429 e erro da própria API são conclusivos.
 */
export async function lerComRecuperacao<R>(
  ler: (signal: AbortSignal) => Promise<R>,
  repetivel: (resultado: R) => boolean,
  signal: AbortSignal,
  { limites = LIMITES_PADRAO, aoMudarFase, conexao = conexaoDoNavegador }: OpcoesRecuperacao = {},
): Promise<DesfechoRecuperacao<R> | null> {
  let inicio = Date.now();
  let tentativa = 0;
  for (;;) {
    if (conexao.offline()) {
      aoMudarFase?.("sem_internet");
      await conexao.esperarOnline(signal);
      if (signal.aborted) return null;
      // Conexão de volta: o tempo offline não conta contra a API.
      inicio = Date.now();
      tentativa = 0;
    }

    const restante = limites.prazoTotalMs - (Date.now() - inicio);
    const resultado = await tentativaComLimite(ler, signal, Math.min(limites.tempoPorTentativaMs, restante), {
      ms: limites.avisoDeDemoraMs,
      avisar: () => aoMudarFase?.("acordando"),
    });
    if (signal.aborted) return null;
    if (!repetivel(resultado)) return { tipo: "concluida", resultado };
    // A falha veio da falta de internet: espera o `online` acima.
    if (conexao.offline()) continue;

    const espera = limites.esperas[Math.min(tentativa, limites.esperas.length - 1)] ?? 0;
    tentativa += 1;
    // Só começa outra tentativa se ainda sobrar prazo depois da espera.
    if (Date.now() - inicio + espera >= limites.prazoTotalMs) return { tipo: "esgotada", resultado };
    aoMudarFase?.("acordando");
    await esperarCancelavel(espera, signal);
    if (signal.aborted) return null;
  }
}
