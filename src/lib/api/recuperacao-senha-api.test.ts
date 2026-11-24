import { afterEach, describe, expect, it, vi } from "vitest";
import { pedirRecuperacaoDeSenha } from "./recuperacao-senha-api";

function responder(status: number) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pedirRecuperacaoDeSenha", () => {
  it("manda só o identificador aparado, no corpo de um POST", async () => {
    responder(202);
    expect(await pedirRecuperacaoDeSenha("  ana@example.test ")).toBe("aceito");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(/\/password-resets\/request$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ identifier: "ana@example.test" });
  });

  it("classifica pelo status: 429 limite, 400 inválido, outro erro indisponível", async () => {
    responder(429);
    expect(await pedirRecuperacaoDeSenha("ana@example.test")).toBe("limite");
    responder(400);
    expect(await pedirRecuperacaoDeSenha("ana@example.test")).toBe("invalido");
    responder(500);
    expect(await pedirRecuperacaoDeSenha("ana@example.test")).toBe("indisponivel");
  });

  it("sem resposta: falha de comunicação, sem repetir o pedido", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await pedirRecuperacaoDeSenha("ana@example.test")).toBe("falha_comunicacao");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
