import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classificar,
  confirmarCadastro,
  emitirLiberacao,
  iniciarCadastro,
  lerSituacao,
  verificarCodigo,
} from "./segundo-fator-api";

function responder(status: number, corpo: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(corpo === undefined ? null : JSON.stringify(corpo), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const SITUACAO = {
  state: "VERIFIED",
  enrollmentPermitted: false,
  recoveryPending: false,
  verifiedUntil: "2031-01-15T12:00:00.000Z",
  factor: { method: "TOTP", confirmedAt: "2031-01-15T00:00:00.000Z", remainingRecoveryCodes: 9 },
  locked: null,
  available: true,
};

afterEach(() => vi.unstubAllGlobals());

type Chamadas = { mock: { calls: unknown[][] } };
const urlDa = (f: Chamadas, i = 0) => String(f.mock.calls[i][0]);
const corpoDa = (f: Chamadas, i = 0): unknown => JSON.parse(String((f.mock.calls[i][1] as RequestInit).body));

describe("cliente do segundo fator", () => {
  it("classifica pelo status e pelo code, nunca pelo texto", () => {
    expect(classificar(400, { code: "CODIGO_INVALIDO", message: "qualquer" })).toEqual({ tipo: "codigo-invalido" });
    expect(classificar(429, { code: "SEGUNDO_FATOR_BLOQUEADO", retryAfterSeconds: 120 })).toEqual({ tipo: "bloqueado", segundos: 120 });
    expect(classificar(429, null)).toEqual({ tipo: "limite" });
    expect(classificar(503, { code: "SEGUNDO_FATOR_INDISPONIVEL" })).toEqual({ tipo: "indisponivel" });
    expect(classificar(403, { code: "REAUTENTICACAO_NECESSARIA" })).toEqual({ tipo: "reautenticar" });
    expect(classificar(403, { code: "SEGUNDO_FATOR_RECENTE_NECESSARIO" })).toEqual({ tipo: "segundo-fator-recente" });
    expect(classificar(410, { code: "LIBERACAO_INVALIDA" })).toEqual({ tipo: "liberacao-invalida" });
    expect(classificar(401, null)).toEqual({ tipo: "sessao" });
    expect(classificar(409, { code: "LIBERACAO_SEM_EMAIL", message: "Sem e-mail." })).toEqual({
      tipo: "conflito",
      codigo: "LIBERACAO_SEM_EMAIL",
      mensagem: "Sem e-mail.",
    });
  });

  it("envia só o código, na rota certa, e valida a resposta", async () => {
    const f = responder(200, SITUACAO);
    const r = await verificarCodigo("123456");
    expect(r).toEqual({ ok: true, dados: SITUACAO });
    expect(urlDa(f)).toMatch(/\/auth\/second-factor\/verify$/);
    expect(corpoDa(f)).toEqual({ code: "123456" });
  });

  it("resposta 2xx em forma estranha nunca é sucesso", async () => {
    responder(200, { state: "VERIFIED" });
    expect(await lerSituacao()).toEqual({ ok: false, falha: { tipo: "erro" } });
    responder(200, { otpauthUri: "https://outro.site", qrSvg: "<script>", manualKey: "x", expiresAt: "ontem" });
    expect(await iniciarCadastro()).toEqual({ ok: false, falha: { tipo: "erro" } });
    responder(200, { recoveryCodes: [] });
    expect(await confirmarCadastro("123456")).toEqual({ ok: false, falha: { tipo: "erro" } });
  });

  it("cadastro sem código manda corpo vazio; com código, só o código", async () => {
    const f = responder(403, { code: "SEGUNDO_FATOR_LIBERACAO_NECESSARIA" });
    expect(await iniciarCadastro()).toEqual({ ok: false, falha: { tipo: "liberacao-necessaria" } });
    expect(corpoDa(f)).toEqual({});
    await iniciarCadastro("123456");
    expect(corpoDa(f, 1)).toEqual({ code: "123456" });
  });

  it("liberação: a resposta não traz link e o id vai codificado no caminho", async () => {
    const f = responder(200, { created: true, grantId: "g1", expiresAt: "2031-01-15T13:00:00.000Z", delivery: { status: "SENT" } });
    const r = await emitirLiberacao("conta/../x", "Motivo de teste", "chave-de-formulario-0001");
    expect(r.ok).toBe(true);
    expect(urlDa(f)).toMatch(/\/platform\/users\/conta%2F..%2Fx\/second-factor\/grants$/);
  });

  it("sem resposta: rede (nada é reenviado sozinho)", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("falhou"));
    vi.stubGlobal("fetch", f);
    expect(await verificarCodigo("123456")).toEqual({ ok: false, falha: { tipo: "rede" } });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
