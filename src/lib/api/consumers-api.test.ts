import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  cadastrarCliente,
  editarCliente,
  lerFichaDoCliente,
  lerHistoricoDoCliente,
  lerPreviaDaUnificacao,
  listarGruposDeClientes,
  pesquisarClientes,
  unificarClientes,
} from "./consumers-api";

const CLIENTE = { id: "c1", name: "Maria", whatsapp: "(11) 90000-0000", email: null };

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );
}

function ultimaChamada() {
  return (globalThis.fetch as unknown as Mock<(u: string, i: RequestInit) => unknown>).mock.calls[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pesquisarClientes", () => {
  it("GET com o termo codificado, escopado pelo tenant", async () => {
    mockFetch(200, { consumers: [CLIENTE] });
    const resultado = await pesquisarClientes("t/1", "Ana & Bia");
    expect(resultado).toEqual({ ok: true, dados: [CLIENTE] });
    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/t%2F1/consumers?q=Ana%20%26%20Bia");
    expect(init.method).toBe("GET");
  });

  it("403 é falta de permissão; corpo inesperado é indisponível", async () => {
    mockFetch(403, { message: "x" });
    expect(await pesquisarClientes("t1", "an")).toEqual({ ok: false, falha: { tipo: "sem_permissao" } });
    mockFetch(200, { consumers: [{ id: 1 }] });
    expect(await pesquisarClientes("t1", "an")).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });

  it("sem resposta vira falha de comunicação", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("rede")));
    expect(await pesquisarClientes("t1", "an")).toEqual({
      ok: false,
      falha: { tipo: "falha_comunicacao" },
    });
  });
});

describe("cadastrarCliente", () => {
  it("POST só com os campos do DTO e devolve o cliente", async () => {
    mockFetch(201, { consumer: CLIENTE });
    const resultado = await cadastrarCliente("t1", { name: "Maria", whatsapp: "11900000000" });
    expect(resultado).toEqual({ ok: true, dados: CLIENTE });
    const [url, init] = ultimaChamada();
    expect(url).toMatch(/\/tenants\/t1\/consumers$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Maria", whatsapp: "11900000000" });
  });

  it("409 vira duplicado com a mensagem do servidor", async () => {
    mockFetch(409, { message: "Já existe um cliente com este WhatsApp." });
    expect(await cadastrarCliente("t1", { name: "M", whatsapp: "11900000000" })).toEqual({
      ok: false,
      falha: { tipo: "duplicado", mensagem: "Já existe um cliente com este WhatsApp." },
    });
  });

  it("400 vira dados inválidos", async () => {
    mockFetch(400, { message: "Informe um telefone válido com DDD." });
    expect(await cadastrarCliente("t1", { name: "M", whatsapp: "1" })).toEqual({
      ok: false,
      falha: { tipo: "dados_invalidos", mensagem: "Informe um telefone válido com DDD." },
    });
  });
});

describe("telefone compartilhado, ficha e unificação", () => {
  const PREVIA = {
    principal: CLIENTE,
    secundario: { ...CLIENTE, id: "c2" },
    relacoes: ["MESMO_TELEFONE"],
    transferir: { agendamentos: 1, concluidos: 1, cancelados: 0, faltas: 0, outros: 0, recebimentos: 0, comissoes: 0, pedidosPublicos: 0 },
    versaoDaPrevia: "a".repeat(64),
  };

  it("409 pelo code: telefone em uso traz os cadastros; unificado traz o principal; prévia desatualizada traz a nova", async () => {
    mockFetch(409, { code: "TELEFONE_EM_USO", message: "m", consumers: [CLIENTE] });
    expect(await cadastrarCliente("t1", { name: "M", whatsapp: "11900000000" })).toEqual({
      ok: false,
      falha: { tipo: "duplicado", mensagem: "m", cadastros: [CLIENTE] },
    });
    mockFetch(409, { code: "CLIENTE_UNIFICADO", message: "m", principalId: "c9" });
    expect(await lerFichaDoCliente("t1", "c1")).toEqual({ ok: false, falha: { tipo: "cliente_unificado", mensagem: "m", principalId: "c9" } });
    mockFetch(409, { code: "PREVIA_DESATUALIZADA", message: "m", previa: PREVIA });
    expect(await unificarClientes("t1", "c2", { principalId: "c1", versaoDaPrevia: "b".repeat(64) })).toEqual({
      ok: false,
      falha: { tipo: "previa_desatualizada", mensagem: "m", previa: PREVIA },
    });
    mockFetch(409, { code: "NAO_SUGERIDO", message: "m" });
    expect(await lerPreviaDaUnificacao("t1", "c2", "c1")).toEqual({ ok: false, falha: { tipo: "conflito", mensagem: "m" } });
  });

  it("cadastro de outra pessoa manda a chave e o pedido explícito", async () => {
    mockFetch(201, { consumer: CLIENTE, repeated: false });
    await cadastrarCliente("t1", { name: "M", whatsapp: "11900000000", requestKey: "k".repeat(32), outraPessoa: true });
    expect(JSON.parse(ultimaChamada()[1].body as string)).toEqual({ name: "M", whatsapp: "11900000000", requestKey: "k".repeat(32), outraPessoa: true });
  });

  it("lista agrupada valida grupos e membros; grupo vazio é indisponível", async () => {
    const membro = { ...CLIENTE, relacoes: ["MESMO_TELEFONE"], mesmoNome: 0 };
    mockFetch(200, { groups: [{ chave: "k1", membros: [membro] }], nextCursor: null, total: 1 });
    expect(await listarGruposDeClientes("t1", { termo: "Ma" })).toEqual({
      ok: true,
      dados: { grupos: [{ chave: "k1", membros: [membro] }], proximoCursor: null, total: 1 },
    });
    expect(ultimaChamada()[0]).toContain("/tenants/t1/consumers/groups?limit=20&q=Ma");
    mockFetch(200, { groups: [{ chave: "k1", membros: [] }], nextCursor: null, total: 1 });
    expect(await listarGruposDeClientes("t1", {})).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });

  it("prévia e unificação: caminho do secundário, corpo com principal e versão", async () => {
    mockFetch(200, PREVIA);
    expect(await lerPreviaDaUnificacao("t1", "c2", "c1")).toEqual({ ok: true, dados: PREVIA });
    expect(ultimaChamada()[0]).toContain("/tenants/t1/consumers/c2/merge-preview?principalId=c1");
    const RESULTADO = { principal: CLIENTE, secundarioId: "c2", mergedAt: "2026-11-23T12:00:00.000Z", repeated: false, transferido: PREVIA.transferir };
    mockFetch(200, RESULTADO);
    expect(await unificarClientes("t1", "c2", { principalId: "c1", versaoDaPrevia: PREVIA.versaoDaPrevia })).toEqual({ ok: true, dados: RESULTADO });
    const [url, init] = ultimaChamada();
    expect(url).toMatch(/\/tenants\/t1\/consumers\/c2\/merge$/);
    expect(init.method).toBe("POST");
  });

  it("edição manda a versão lida; histórico valida item com data local", async () => {
    mockFetch(200, { consumer: { ...CLIENTE, updatedAt: "2026-11-23T12:00:00.000Z" } });
    expect((await editarCliente("t1", "c1", { name: "Maria", expectedUpdatedAt: "2026-11-23T11:00:00.000Z" })).ok).toBe(true);
    expect(ultimaChamada()[1].method).toBe("PATCH");
    const item = {
      id: "a1",
      startAt: "2026-11-23T12:00:00.000Z",
      localDate: "2026-11-23",
      localStart: "09:00",
      status: "COMPLETED",
      professionalName: "Ana",
      services: ["Corte"],
      priceCents: null,
      hidden: ["price", "payment"],
    };
    mockFetch(200, { appointments: [item], nextCursor: null });
    expect(await lerHistoricoDoCliente("t1", "c1", null)).toEqual({ ok: true, dados: { itens: [item], proximoCursor: null } });
  });
});
