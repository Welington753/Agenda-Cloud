import { describe, expect, it } from "vitest";
import type { ValidadeDoAcessoReal } from "@/lib/api/auth-api";
import { avisoDeVencimento } from "./aviso-vencimento";

const agora = new Date("2027-03-10T12:00:00.000Z");
const em = (horas: number) => new Date(agora.getTime() + horas * 3_600_000).toISOString();
const acesso = (validUntil: string | null, extra: Partial<ValidadeDoAcessoReal> = {}): ValidadeDoAcessoReal => ({
  state: "PAID",
  blocked: false,
  validUntil,
  expiredAt: null,
  expiredKind: null,
  ...extra,
});

describe("aviso de vencimento próximo", () => {
  it("faixas de 7, 3 e 1 dia pela validade efetiva", () => {
    expect(avisoDeVencimento(acesso(em(8 * 24)), agora)).toBeNull();
    expect(avisoDeVencimento(acesso(em(7 * 24)), agora)?.faixa).toBe(7);
    expect(avisoDeVencimento(acesso(em(4 * 24)), agora)?.faixa).toBe(7);
    expect(avisoDeVencimento(acesso(em(3 * 24)), agora)?.faixa).toBe(3);
    expect(avisoDeVencimento(acesso(em(30)), agora)?.faixa).toBe(3);
    expect(avisoDeVencimento(acesso(em(24)), agora)?.faixa).toBe(1);
    expect(avisoDeVencimento(acesso(em(1)), agora)).toMatchObject({ faixa: 1, tipo: "PAID" });
  });

  it("teste acabando com período pago já registrado depois: a validade efetiva vai longe, sem aviso", () => {
    // A sessão traz o fim da validade contínua (teste + pago encadeado).
    expect(avisoDeVencimento(acesso(em(35 * 24), { state: "TRIAL" }), agora)).toBeNull();
  });

  it("sem aviso para vencido, sem validade, anterior ao controle ou sem a situação (funcionário)", () => {
    expect(avisoDeVencimento(acesso(null, { state: "EXPIRED", blocked: true }), agora)).toBeNull();
    expect(avisoDeVencimento(acesso(null, { state: "MISSING", blocked: true }), agora)).toBeNull();
    expect(avisoDeVencimento(acesso(null, { state: "UNTRACKED" }), agora)).toBeNull();
    expect(avisoDeVencimento(acesso(null, { state: null }), agora)).toBeNull();
    expect(avisoDeVencimento(undefined, agora)).toBeNull();
    expect(avisoDeVencimento(acesso(em(-1)), agora)).toBeNull();
  });
});
