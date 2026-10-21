import { describe, expect, it, vi } from "vitest";
import type { ResultadoAutenticacaoReal, SessaoRealContexto } from "@/lib/api/auth-api";
import { lerSessaoComTentativas } from "./leitura-sessao";

type Resultado = ResultadoAutenticacaoReal<SessaoRealContexto | null>;

const FALHA_COMUNICACAO: Resultado = { ok: false, falha: { tipo: "falha_comunicacao" } };
const NAO_AUTENTICADO: Resultado = { ok: true, dados: null };
const INDISPONIVEL: Resultado = { ok: false, falha: { tipo: "indisponivel" } };

/** Espera controlada pelo teste: registra o pedido e resolve na hora, sem
 * relógio real. */
function esperaImediata() {
  const pedidos: number[] = [];
  const esperar = vi.fn((ms: number) => {
    pedidos.push(ms);
    return Promise.resolve();
  });
  return { esperar, pedidos };
}

function buscarEmSequencia(...resultados: Resultado[]) {
  const fila = [...resultados];
  return vi.fn(() => {
    const proximo = fila.shift();
    if (!proximo) return Promise.reject(new Error("chamada a mais"));
    return Promise.resolve(proximo);
  });
}

describe("lerSessaoComTentativas", () => {
  it("repete só a falha de comunicação e para no primeiro resultado conclusivo", async () => {
    const buscar = buscarEmSequencia(FALHA_COMUNICACAO, FALHA_COMUNICACAO, NAO_AUTENTICADO);
    const { esperar, pedidos } = esperaImediata();

    const resultado = await lerSessaoComTentativas(buscar, new AbortController().signal, {
      esperas: [10, 20, 30],
      esperar,
    });

    expect(resultado).toEqual(NAO_AUTENTICADO);
    expect(buscar).toHaveBeenCalledTimes(3);
    expect(pedidos).toEqual([10, 20]);
  });

  it("devolve a falha depois de esgotar as tentativas", async () => {
    const buscar = buscarEmSequencia(FALHA_COMUNICACAO, FALHA_COMUNICACAO, FALHA_COMUNICACAO);
    const { esperar } = esperaImediata();

    const resultado = await lerSessaoComTentativas(buscar, new AbortController().signal, {
      esperas: [10, 20],
      esperar,
    });

    expect(resultado).toEqual(FALHA_COMUNICACAO);
    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it("não repete resposta inesperada da própria API", async () => {
    const buscar = buscarEmSequencia(INDISPONIVEL);
    const { esperar } = esperaImediata();

    const resultado = await lerSessaoComTentativas(buscar, new AbortController().signal, {
      esperas: [10],
      esperar,
    });

    expect(resultado).toEqual(INDISPONIVEL);
    expect(esperar).not.toHaveBeenCalled();
  });

  it("cancelado durante a espera não faz nova leitura e devolve null", async () => {
    const controle = new AbortController();
    const buscar = buscarEmSequencia(FALHA_COMUNICACAO);
    const esperar = vi.fn(() => {
      controle.abort();
      return Promise.resolve();
    });

    const resultado = await lerSessaoComTentativas(buscar, controle.signal, { esperas: [10], esperar });

    expect(resultado).toBeNull();
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("cancelado com a leitura em voo devolve null, nunca o resultado", async () => {
    const controle = new AbortController();
    const buscar = vi.fn(() => {
      controle.abort();
      return Promise.resolve(NAO_AUTENTICADO);
    });

    const resultado = await lerSessaoComTentativas(buscar, controle.signal, {
      esperas: [],
      esperar: vi.fn(),
    });

    expect(resultado).toBeNull();
  });

  it("repassa o sinal a cada leitura", async () => {
    const controle = new AbortController();
    const buscar = buscarEmSequencia(NAO_AUTENTICADO);

    await lerSessaoComTentativas(buscar, controle.signal, { esperas: [], esperar: vi.fn() });

    expect(buscar).toHaveBeenCalledWith(controle.signal);
  });
});
