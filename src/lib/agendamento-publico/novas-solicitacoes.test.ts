import { describe, expect, it } from "vitest";
import type { ListaDeSolicitacoes, SolicitacaoPendente } from "@/lib/api/booking-requests-api";
import {
  compararLeitura,
  descricaoDoAviso,
  falhaDefinitiva,
  podeConsultar,
  type MemoriaDeAvisos,
} from "./novas-solicitacoes";

function solicitacao(id: string, hora: string, origin: "PUBLIC" | "INTERNAL" = "PUBLIC"): SolicitacaoPendente {
  return {
    id,
    startAt: `2027-03-07T${hora}:00.000Z`,
    serviceEndAt: `2027-03-07T${hora}:00.000Z`,
    occupancyEndAt: `2027-03-07T${hora}:00.000Z`,
    localStart: hora,
    localServiceEnd: hora,
    timezone: "UTC",
    status: "PENDING",
    durationMinutes: 30,
    priceCents: null,
    notes: null,
    professional: { id: "p", name: "Ana" },
    service: { id: "s", name: "Corte" },
    consumer: { id: `c-${id}`, name: `Cliente ${id}`, whatsapp: "+5511988880001" },
    unitId: "u",
    createdAt: "2027-03-01T00:00:00.000Z",
    origin,
    requestedAt: origin === "PUBLIC" ? "2027-03-01T00:00:00.000Z" : null,
  };
}

const lista = (itens: SolicitacaoPendente[], completa = true): ListaDeSolicitacoes => ({
  solicitacoes: itens,
  completa,
});

function ids(novas: SolicitacaoPendente[]) {
  return novas.map((s) => s.id);
}

describe("compararLeitura", () => {
  it("a primeira leitura é só referência: o que já estava pendente não avisa", () => {
    const r = compararLeitura(null, lista([solicitacao("a", "09:00"), solicitacao("b", "10:00")]));
    expect(r.novas).toEqual([]);
    expect([...r.memoria.vistos].sort()).toEqual(["a", "b"]);
  });

  it("avisa só o pedido online que apareceu depois da referência", () => {
    const { memoria } = compararLeitura(null, lista([solicitacao("a", "09:00")]));
    const r = compararLeitura(
      memoria,
      lista([solicitacao("a", "09:00"), solicitacao("b", "08:00"), solicitacao("i", "11:00", "INTERNAL")]),
    );
    expect(ids(r.novas)).toEqual(["b"]);
  });

  it("nunca avisa duas vezes a mesma solicitação, mesmo se ela sair e voltar", () => {
    let memoria: MemoriaDeAvisos = compararLeitura(null, lista([])).memoria;
    const primeira = compararLeitura(memoria, lista([solicitacao("b", "09:00")]));
    expect(ids(primeira.novas)).toEqual(["b"]);
    memoria = primeira.memoria;
    memoria = compararLeitura(memoria, lista([])).memoria;
    expect(compararLeitura(memoria, lista([solicitacao("b", "09:00")])).novas).toEqual([]);
  });

  it("reserva criada pela agenda entra na memória sem aviso", () => {
    const { memoria } = compararLeitura(null, lista([]));
    const r = compararLeitura(memoria, lista([solicitacao("i", "09:00", "INTERNAL")]));
    expect(r.novas).toEqual([]);
    expect(r.memoria.vistos.has("i")).toBe(true);
  });

  it("lista cortada: o que surge no fim (talvez antigo, além do corte) não avisa", () => {
    const { memoria } = compararLeitura(null, lista([solicitacao("a", "09:00"), solicitacao("b", "10:00")], false));
    // "a" foi respondida; "c" (antiga, 10:30) entra no lugar; "n" (nova, 08:00) também.
    const r = compararLeitura(
      memoria,
      lista([solicitacao("n", "08:00"), solicitacao("b", "10:00"), solicitacao("c", "10:30")], false),
    );
    expect(ids(r.novas)).toEqual(["n"]);
    expect(r.memoria.vistos.has("c")).toBe(true);
  });

  it("lista completa: um pedido novo depois do último também avisa", () => {
    const { memoria } = compararLeitura(null, lista([solicitacao("a", "09:00")]));
    expect(ids(compararLeitura(memoria, lista([solicitacao("a", "09:00"), solicitacao("z", "17:00")])).novas)).toEqual([
      "z",
    ]);
  });
});

describe("quando consultar", () => {
  it("só com a página visível e com conexão", () => {
    expect(podeConsultar("visible", true)).toBe(true);
    expect(podeConsultar("hidden", true)).toBe(false);
    expect(podeConsultar("visible", false)).toBe(false);
  });

  it("para a consulta periódica só em falhas que não passam sozinhas", () => {
    expect(falhaDefinitiva("nao_autenticado")).toBe(true);
    expect(falhaDefinitiva("sem_permissao")).toBe(true);
    expect(falhaDefinitiva("sem_acesso")).toBe(true);
    expect(falhaDefinitiva("falha_comunicacao")).toBe(false);
    expect(falhaDefinitiva("indisponivel")).toBe(false);
  });
});

describe("descricaoDoAviso", () => {
  it("diz quem pediu, o quê, com quem e quando", () => {
    expect(descricaoDoAviso(solicitacao("a", "09:00"), "07/03/2027")).toBe(
      "Cliente a pediu Corte com Ana, 07/03/2027 às 09:00.",
    );
  });
});
