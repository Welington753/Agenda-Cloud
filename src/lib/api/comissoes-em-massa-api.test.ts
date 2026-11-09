import { describe, expect, it } from "vitest";
import { caminhoEmMassa, caminhoPreviaEmMassa, ehAplicacaoEmMassa, ehPreviaEmMassa } from "./comissoes-em-massa-api";

describe("aplicação em massa", () => {
  const previa = {
    target: "ALL",
    mode: "PRESERVE",
    defaultRule: { kind: "PERCENTAGE", value: 1000 },
    fingerprint: "f".repeat(64),
    summary: { change: 1, preserve: 1, unchanged: 0, total: 2 },
    professionals: [
      {
        professional: { id: "p1", name: "Ana" },
        current: { receivesCommission: true, defaultRule: null },
        next: { receivesCommission: true, defaultRule: { kind: "PERCENTAGE", value: 1000 } },
        outcome: "CHANGE",
      },
      {
        professional: { id: "p2", name: "Bia" },
        current: { receivesCommission: false, defaultRule: null },
        next: { receivesCommission: false, defaultRule: null },
        outcome: "PRESERVE",
      },
    ],
  };

  it("caminhos sob as comissões do estabelecimento", () => {
    expect(caminhoEmMassa("t/1")).toBe("/tenants/t%2F1/commissions/bulk-settings");
    expect(caminhoPreviaEmMassa("t1")).toBe("/tenants/t1/commissions/bulk-settings/preview");
  });

  it("forma da prévia e da aplicação", () => {
    expect(ehPreviaEmMassa(previa)).toBe(true);
    expect(ehPreviaEmMassa({ ...previa, fingerprint: undefined })).toBe(false);
    expect(ehPreviaEmMassa({ ...previa, summary: { ...previa.summary, change: "1" } })).toBe(false);
    expect(ehPreviaEmMassa({ ...previa, professionals: [{ ...previa.professionals[0], outcome: "MERGE" }] })).toBe(false);
    expect(ehPreviaEmMassa({ ...previa, professionals: [{ ...previa.professionals[0], next: { receivesCommission: true, defaultRule: { kind: "NONE", value: null } } }] })).toBe(false);
    expect(ehAplicacaoEmMassa(previa)).toBe(false);
    expect(ehAplicacaoEmMassa({ ...previa, applied: true, operationId: "op" })).toBe(true);
  });

});
