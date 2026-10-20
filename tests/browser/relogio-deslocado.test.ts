// Guarda do relógio deslocado que o backend carrega SÓ no teste de navegador
// da Visão geral (tests/browser/support/relogio-deslocado.mjs). Roda num
// processo Node à parte: o módulo troca o `Date` global, e trocá-lo aqui
// contaminaria o resto da suíte.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// URL `file:`, não caminho: no Windows `--import C:\...` é lido como esquema `c:`.
const MODULO = new URL("./support/relogio-deslocado.mjs", import.meta.url).href;

function rodar(codigo: string, deslocamento: string | undefined) {
  const env = { ...process.env, E2E_RELOGIO_DESLOCAMENTO_MS: deslocamento };
  if (deslocamento === undefined) delete env.E2E_RELOGIO_DESLOCAMENTO_MS;
  return execFileSync(process.execPath, ["--import", MODULO, "-e", codigo], {
    env,
    encoding: "utf8",
    stdio: "pipe",
  });
}

describe("relógio deslocado do backend de teste", () => {
  it("desloca `new Date()` e `Date.now()`, e o tempo continua correndo", () => {
    const deslocamento = -6 * 3_600_000;
    const saida = JSON.parse(
      rodar(
        `const antes = Date.now(); const real = performance.timeOrigin + performance.now();
         const agora = new Date(); const t = Date.now();
         while (Date.now() - t < 20) {}
         console.log(JSON.stringify({ antes, real, agora: agora.getTime(), depois: Date.now() - t,
           instancia: agora instanceof Date, texto: typeof Date() }));`,
        String(deslocamento),
      ),
    ) as Record<string, number | boolean | string>;
    expect(Math.abs(Number(saida.antes) - (Number(saida.real) + deslocamento))).toBeLessThan(1_000);
    expect(Math.abs(Number(saida.agora) - Number(saida.antes))).toBeLessThan(1_000);
    expect(Number(saida.depois)).toBeGreaterThanOrEqual(20);
    expect(saida.instancia).toBe(true);
    expect(saida.texto).toBe("string");
  });

  it("não mexe em datas com argumento", () => {
    const saida = rodar(
      `console.log(new Date("2026-10-20T13:15:00.000Z").toISOString(), Date.parse("2026-10-20T13:15:00.000Z"), Date.UTC(2026, 9, 20))`,
      "3600000",
    );
    expect(saida.trim()).toBe(
      `2026-10-20T13:15:00.000Z ${Date.parse("2026-10-20T13:15:00.000Z")} ${Date.UTC(2026, 9, 20)}`,
    );
  });

  it("recusa subir sem deslocamento válido", () => {
    expect(() => rodar("0", undefined)).toThrow(/E2E_RELOGIO_DESLOCAMENTO_MS/);
    expect(() => rodar("0", "dez")).toThrow(/E2E_RELOGIO_DESLOCAMENTO_MS/);
  });
});
