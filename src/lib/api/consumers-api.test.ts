import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { cadastrarCliente, pesquisarClientes } from "./consumers-api";

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
