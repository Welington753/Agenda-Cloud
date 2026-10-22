import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIMITES_PADRAO,
  lerComRecuperacao,
  type ConexaoDoNavegador,
  type FaseRecuperacao,
  type LimitesRecuperacao,
} from "./leitura-com-recuperacao";

type Resultado = "ok" | "sem_resposta" | "erro_api";
const repetivel = (r: Resultado) => r === "sem_resposta";

const LIMITES: LimitesRecuperacao = {
  esperas: [1_000, 2_000],
  tempoPorTentativaMs: 5_000,
  prazoTotalMs: 20_000,
  avisoDeDemoraMs: 3_000,
};

/** Conexão controlada pelo teste: `offline` muda na hora e `voltar()`
 * dispara o "evento online". */
function conexaoFalsa(offlineInicial = false) {
  let offline = offlineInicial;
  const ouvintes = new Set<() => void>();
  const conexao: ConexaoDoNavegador = {
    offline: () => offline,
    esperarOnline: (signal) =>
      new Promise((resolve) => {
        const fim = () => {
          ouvintes.delete(fim);
          resolve();
        };
        ouvintes.add(fim);
        signal.addEventListener("abort", fim);
      }),
  };
  return {
    conexao,
    cair: () => {
      offline = true;
    },
    voltar: () => {
      offline = false;
      for (const f of [...ouvintes]) f();
    },
    esperando: () => ouvintes.size,
  };
}

/** Leitura que responde depois de `duracaoMs` (relógio falso) e registra o
 * instante de cada início, a sobreposição e o sinal recebido. */
function leituraFalsa(respostas: { resultado: Resultado; duracaoMs: number }[]) {
  const fila = [...respostas];
  const registro = { inicios: [] as number[], emVoo: 0, maxEmVoo: 0, sinais: [] as AbortSignal[] };
  const ler = vi.fn((signal: AbortSignal) => {
    const proxima = fila.shift();
    if (!proxima) throw new Error("leitura a mais");
    registro.inicios.push(Date.now());
    registro.sinais.push(signal);
    registro.emVoo += 1;
    registro.maxEmVoo = Math.max(registro.maxEmVoo, registro.emVoo);
    return new Promise<Resultado>((resolve) => {
      const fim = (r: Resultado) => {
        registro.emVoo -= 1;
        resolve(r);
      };
      const t = setTimeout(() => fim(proxima.resultado), proxima.duracaoMs);
      // Cancelada: como o fetch real, vira "sem resposta" na hora.
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        fim("sem_resposta");
      });
    });
  });
  return { ler, registro };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("lerComRecuperacao", () => {
  it("repete só 'sem resposta', com espera crescente, e para na primeira resposta conclusiva", async () => {
    const { ler, registro } = leituraFalsa([
      { resultado: "sem_resposta", duracaoMs: 100 },
      { resultado: "sem_resposta", duracaoMs: 100 },
      { resultado: "ok", duracaoMs: 100 },
    ]);
    const fases: FaseRecuperacao[] = [];
    const promessa = lerComRecuperacao(ler, repetivel, new AbortController().signal, {
      limites: LIMITES,
      aoMudarFase: (f) => fases.push(f),
      conexao: conexaoFalsa().conexao,
    });
    await vi.runAllTimersAsync();

    expect(await promessa).toEqual({ tipo: "concluida", resultado: "ok" });
    // 0 → (100 + 1000) → (1100 + 100 + 2000)
    expect(registro.inicios).toEqual([0, 1_100, 3_200]);
    expect(registro.maxEmVoo).toBe(1);
    expect(fases).toEqual(["acordando", "acordando"]);
  });

  it.each(["erro_api", "ok"] as const)("resposta conclusiva (%s) nunca é repetida", async (resultado) => {
    const { ler } = leituraFalsa([{ resultado, duracaoMs: 10 }]);
    const promessa = lerComRecuperacao(ler, repetivel, new AbortController().signal, {
      limites: LIMITES,
      conexao: conexaoFalsa().conexao,
    });
    await vi.runAllTimersAsync();
    expect(await promessa).toEqual({ tipo: "concluida", resultado });
    expect(ler).toHaveBeenCalledTimes(1);
  });

  it("prazo total conta o tempo das requisições, não só as esperas", async () => {
    // Cada tentativa pendura até o limite de 5 s. Só as esperas somariam
    // 1 + 2 + 2 + ... s; com as requisições, o prazo de 20 s acaba antes.
    const { ler, registro } = leituraFalsa(
      Array.from({ length: 10 }, () => ({ resultado: "ok" as const, duracaoMs: 60_000 })),
    );
    const promessa = lerComRecuperacao(ler, repetivel, new AbortController().signal, {
      limites: LIMITES,
      conexao: conexaoFalsa().conexao,
    });
    await vi.runAllTimersAsync();

    expect(await promessa).toEqual({ tipo: "esgotada", resultado: "sem_resposta" });
    // 0 →5s timeout +1s→ 6 →11 +2s→ 13 →18; 18 + 2 ≥ 20: para.
    expect(registro.inicios).toEqual([0, 6_000, 13_000]);
    expect(Date.now()).toBeLessThanOrEqual(LIMITES.prazoTotalMs);
    expect(registro.maxEmVoo).toBe(1);
  });

  it("a última tentativa nunca passa do prazo total", async () => {
    const limites = { ...LIMITES, esperas: [1_000], tempoPorTentativaMs: 15_000, prazoTotalMs: 20_000 };
    const { ler, registro } = leituraFalsa([
      { resultado: "sem_resposta", duracaoMs: 10_000 },
      { resultado: "ok", duracaoMs: 60_000 },
    ]);
    const promessa = lerComRecuperacao(ler, repetivel, new AbortController().signal, {
      limites,
      conexao: conexaoFalsa().conexao,
    });
    await vi.runAllTimersAsync();

    expect(await promessa).toEqual({ tipo: "esgotada", resultado: "sem_resposta" });
    // Segunda começa em 11 s e é cortada em 20 s (restante), não em 26 s.
    expect(registro.inicios).toEqual([0, 11_000]);
    expect(Date.now()).toBe(20_000);
  });

  it("avisa 'acordando' quando a primeira requisição demora, antes de qualquer falha", async () => {
    const { ler } = leituraFalsa([{ resultado: "ok", duracaoMs: 4_000 }]);
    const fases: FaseRecuperacao[] = [];
    const promessa = lerComRecuperacao(ler, repetivel, new AbortController().signal, {
      limites: LIMITES,
      aoMudarFase: (f) => fases.push(f),
      conexao: conexaoFalsa().conexao,
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fases).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fases).toEqual(["acordando"]);
    await vi.runAllTimersAsync();
    expect(await promessa).toEqual({ tipo: "concluida", resultado: "ok" });
  });

  it("resposta rápida não mostra aviso nenhum", async () => {
    const { ler } = leituraFalsa([{ resultado: "ok", duracaoMs: 200 }]);
    const aoMudarFase = vi.fn();
    const promessa = lerComRecuperacao(ler, repetivel, new AbortController().signal, {
      limites: LIMITES,
      aoMudarFase,
      conexao: conexaoFalsa().conexao,
    });
    await vi.runAllTimersAsync();
    await promessa;
    expect(aoMudarFase).not.toHaveBeenCalled();
  });

  it("cancelada durante a espera: devolve null e não faz nova leitura", async () => {
    const controle = new AbortController();
    const { ler } = leituraFalsa([{ resultado: "sem_resposta", duracaoMs: 10 }]);
    const promessa = lerComRecuperacao(ler, repetivel, controle.signal, {
      limites: LIMITES,
      conexao: conexaoFalsa().conexao,
    });
    await vi.advanceTimersByTimeAsync(500);
    controle.abort();
    await vi.runAllTimersAsync();
    expect(await promessa).toBeNull();
    expect(ler).toHaveBeenCalledTimes(1);
  });

  it("cancelada com a leitura em voo: cancela a requisição e devolve null, nunca o resultado", async () => {
    const controle = new AbortController();
    const { ler, registro } = leituraFalsa([{ resultado: "ok", duracaoMs: 4_000 }]);
    const promessa = lerComRecuperacao(ler, repetivel, controle.signal, {
      limites: LIMITES,
      conexao: conexaoFalsa().conexao,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    controle.abort();
    expect(registro.sinais[0]?.aborted).toBe(true);
    await vi.runAllTimersAsync();
    expect(await promessa).toBeNull();
  });

  it("sem internet: não envia nada, não agenda nada e recomeça com prazo novo quando a conexão volta", async () => {
    const rede = conexaoFalsa(true);
    const { ler, registro } = leituraFalsa([{ resultado: "ok", duracaoMs: 100 }]);
    const fases: FaseRecuperacao[] = [];
    const promessa = lerComRecuperacao(ler, repetivel, new AbortController().signal, {
      limites: LIMITES,
      aoMudarFase: (f) => fases.push(f),
      conexao: rede.conexao,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fases).toEqual(["sem_internet"]);
    expect(rede.esperando()).toBe(1);
    // Muito além do prazo total: nenhuma leitura e nenhum temporizador.
    await vi.advanceTimersByTimeAsync(10 * LIMITES.prazoTotalMs);
    expect(ler).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    rede.voltar();
    await vi.runAllTimersAsync();
    expect(await promessa).toEqual({ tipo: "concluida", resultado: "ok" });
    expect(registro.inicios).toEqual([10 * LIMITES.prazoTotalMs]);
  });

  it("internet cai no meio: a falha não consome o prazo e a leitura espera a volta", async () => {
    const rede = conexaoFalsa();
    const { ler, registro } = leituraFalsa([
      { resultado: "sem_resposta", duracaoMs: 100 },
      { resultado: "ok", duracaoMs: 100 },
    ]);
    const leitura = ler.getMockImplementation()!;
    ler.mockImplementationOnce((signal) => {
      rede.cair();
      return leitura(signal);
    });
    const promessa = lerComRecuperacao(ler, repetivel, new AbortController().signal, {
      limites: LIMITES,
      conexao: rede.conexao,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ler).toHaveBeenCalledTimes(1);
    expect(rede.esperando()).toBe(1);
    rede.voltar();
    await vi.runAllTimersAsync();
    expect(await promessa).toEqual({ tipo: "concluida", resultado: "ok" });
    expect(registro.inicios).toEqual([0, 60_000]);
  });

  it("cancelada esperando a internet: devolve null", async () => {
    const rede = conexaoFalsa(true);
    const controle = new AbortController();
    const { ler } = leituraFalsa([]);
    const promessa = lerComRecuperacao(ler, repetivel, controle.signal, { limites: LIMITES, conexao: rede.conexao });
    await vi.advanceTimersByTimeAsync(0);
    controle.abort();
    expect(await promessa).toBeNull();
    expect(ler).not.toHaveBeenCalled();
  });

  it("limites padrão: tentativa e prazo finitos, prazo maior que a partida do Render (~1 min)", () => {
    expect(LIMITES_PADRAO.tempoPorTentativaMs).toBeLessThan(LIMITES_PADRAO.prazoTotalMs);
    expect(LIMITES_PADRAO.prazoTotalMs).toBeGreaterThan(60_000);
    expect(LIMITES_PADRAO.prazoTotalMs).toBeLessThanOrEqual(120_000);
  });
});
