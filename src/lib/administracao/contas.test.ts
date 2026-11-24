import { describe, expect, it } from "vitest";
import { ultimaRedefinicao, type RedefinicaoSenha } from "./contas";

const link = (createdAt: string, origem: "ADMIN" | "SELF_SERVICE"): RedefinicaoSenha => ({
  id: `${origem}-${createdAt}`,
  status: "PENDING",
  delivery: { status: "SENT", attempts: 1, lastAt: createdAt, failure: null },
  createdAt,
  expiresAt: createdAt,
  usedAt: null,
  origin: origem,
  requestedBy: origem === "ADMIN" ? { id: "u1", name: "Master" } : null,
});

describe("ultimaRedefinicao", () => {
  const admin = link("2026-11-20T10:00:00.000Z", "ADMIN");
  const proprio = link("2026-11-21T10:00:00.000Z", "SELF_SERVICE");

  it("mostra o link mais recente, venha de onde vier", () => {
    expect(ultimaRedefinicao({ latestPasswordReset: admin, latestSelfServicePasswordReset: proprio })).toBe(proprio);
    const adminDepois = link("2026-11-22T10:00:00.000Z", "ADMIN");
    expect(ultimaRedefinicao({ latestPasswordReset: adminDepois, latestSelfServicePasswordReset: proprio })).toBe(adminDepois);
  });

  it("só um dos dois, nenhum, ou API anterior sem o campo de autoatendimento", () => {
    expect(ultimaRedefinicao({ latestPasswordReset: null, latestSelfServicePasswordReset: proprio })).toBe(proprio);
    expect(ultimaRedefinicao({ latestPasswordReset: admin, latestSelfServicePasswordReset: null })).toBe(admin);
    expect(ultimaRedefinicao({ latestPasswordReset: admin })).toBe(admin);
    expect(ultimaRedefinicao({ latestPasswordReset: null, latestSelfServicePasswordReset: null })).toBeNull();
  });
});
