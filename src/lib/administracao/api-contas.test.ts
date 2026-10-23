import { afterEach, describe, expect, it, vi } from "vitest";
import { acaoAdministrativa, confirmarSenha, novaChaveDeFormulario } from "./api-contas";

function responder(status: number, corpo: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(corpo === null ? null : JSON.stringify(corpo), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("ações da gestão de contas", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("separa reautenticação de permissão negada", async () => {
    responder(403, { code: "REAUTENTICACAO_NECESSARIA", message: "Confirme" });
    expect(await acaoAdministrativa("/x", "POST", {})).toEqual({ tipo: "reautenticar" });
    responder(403, { message: "Sem permissão" });
    expect(await acaoAdministrativa("/x", "POST", {})).toEqual({ tipo: "proibido", mensagem: "Sem permissão" });
  });

  it("conflito e convite encerrado trazem código e mensagem do servidor", async () => {
    responder(409, { code: "ALTERADO_POR_OUTRA_TELA", message: "Recarregue" });
    expect(await acaoAdministrativa("/x", "PATCH", {})).toMatchObject({ tipo: "conflito", codigo: "ALTERADO_POR_OUTRA_TELA", mensagem: "Recarregue" });
    responder(410, { code: "CONVITE_EXPIRED", message: "Expirou" });
    expect(await acaoAdministrativa("/x", "POST", {})).toMatchObject({ tipo: "conflito", codigo: "CONVITE_EXPIRED" });
  });

  it("resposta perdida é rede, nunca sucesso nem erro definitivo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("falhou")));
    expect(await acaoAdministrativa("/x", "POST", {})).toEqual({ tipo: "rede" });
  });

  it("senha errada na confirmação é distinta de limite", async () => {
    responder(401, { message: "x" });
    expect(await confirmarSenha("senha-qualquer")).toBe("senha-incorreta");
    responder(429, null);
    expect(await confirmarSenha("senha-qualquer")).toBe("limite");
    responder(204, null);
    expect(await confirmarSenha("senha-qualquer")).toBe("ok");
  });

  it("chave de formulário única e no formato aceito pela API", () => {
    const a = novaChaveDeFormulario();
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(novaChaveDeFormulario()).not.toBe(a);
  });
});
