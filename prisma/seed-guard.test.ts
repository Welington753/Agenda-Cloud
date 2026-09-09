// Teste puro do guard do seed legado — nunca importa Prisma/pg, nunca lê
// DATABASE_URL/DIRECT_URL, nunca conecta a nada. Roda na suíte padrão
// (`npm test`, ver vitest.config.ts) porque não toca rede nem banco.
import { describe, expect, it } from "vitest";
import { assertLegacySeedConfirmed, CONFIRM_LEGACY_SEED_FLAG, LegacySeedNotConfirmedError } from "./seed-guard";

describe("assertLegacySeedConfirmed", () => {
  it("lança sem a flag de confirmação explícita", () => {
    expect(() => assertLegacySeedConfirmed([])).toThrow(LegacySeedNotConfirmedError);
  });

  it("lança mesmo com outros argumentos presentes, se a flag não estiver entre eles", () => {
    expect(() => assertLegacySeedConfirmed(["node", "seed.ts", "--outra-flag"])).toThrow(
      LegacySeedNotConfirmedError,
    );
  });

  it("nunca lança quando a flag de confirmação está presente", () => {
    expect(() => assertLegacySeedConfirmed(["node", "seed.ts", CONFIRM_LEGACY_SEED_FLAG])).not.toThrow();
  });

  it("a mensagem de erro explica a fronteira Prisma/TypeORM e como confirmar de propósito", () => {
    try {
      assertLegacySeedConfirmed([]);
      throw new Error("deveria ter lançado");
    } catch (erro) {
      expect(String(erro)).toMatch(/TypeORM/);
      expect(String(erro)).toContain(CONFIRM_LEGACY_SEED_FLAG);
    }
  });
});
