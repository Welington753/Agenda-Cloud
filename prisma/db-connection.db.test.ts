import { describe, expect, it } from "vitest";
import { prisma } from "./db-test-helpers";

describe("conexão com o banco", () => {
  it("executa uma query simples contra o Postgres real", async () => {
    const result = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(result[0]?.ok).toBe(1);
  });

  it("enxerga as extensões exigidas pelo schema (citext, btree_gist)", async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('citext', 'btree_gist')
    `;
    const names = rows.map((r) => r.extname).sort();
    expect(names).toEqual(["btree_gist", "citext"]);
  });

  it("enxerga as constraints manuais da migration inicial (CHECK e EXCLUDE)", async () => {
    const rows = await prisma.$queryRaw<{ conname: string; contype: string }[]>`
      SELECT conname, contype::text FROM pg_constraint
      WHERE conname IN ('appointments_end_after_start_check', 'appointments_no_overlap_excl')
    `;
    const byName = Object.fromEntries(rows.map((r) => [r.conname, r.contype]));
    expect(byName["appointments_end_after_start_check"]).toBe("c");
    expect(byName["appointments_no_overlap_excl"]).toBe("x");
  });
});
