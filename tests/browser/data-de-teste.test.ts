// Guarda da data de teste dos fluxos de agenda. Existe por causa de uma falha
// real: os specs de disponibilidade e de agendamentos fixavam
// `DATA = "2026-09-20"`, a data venceu, e o motor de disponibilidade passou a
// cortar (corretamente) todo horário já passado — os dois specs começaram a
// falhar sem que nada na aplicação tivesse mudado, e o CI acusou "teste
// instável" em vez da causa.
//
// Estes testes são PUROS (sem navegador, sem servidor, sem banco) e rodam na
// suíte rápida `npm run test`, que o CI executa ANTES de subir Postgres e
// Playwright: se a data voltar a envelhecer, a falha aparece em segundos e
// aponta para a causa, em vez de aparecer como lista vazia num teste de tela.
import { describe, expect, it } from "vitest";
import { DATA, DATA_SEGUINTE, WEEKDAY_DA_DATA, instanteLocalDe } from "./data-de-teste";

const TIMEZONE_DO_TENANT = "America/Sao_Paulo";

function horaLocalDe(instanteIso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE_DO_TENANT,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instanteIso));
}

function diaLocalDe(instanteIso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE_DO_TENANT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instanteIso));
}

describe("data de teste dos fluxos de agenda", () => {
  it("é uma data de calendário no formato que a API e o campo de data aceitam", () => {
    expect(DATA).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DATA_SEGUINTE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("está inteiramente no FUTURO — é isto que a data fixa deixou de garantir", () => {
    // O dia inteiro precisa estar à frente, não só o fim dele: o primeiro
    // horário da jornada dos specs é 09:00 local, e é ele que o corte de
    // horário já passado derrubaria primeiro.
    const primeiroHorarioDaJornada = new Date(instanteLocalDe("09:00"));
    expect(primeiroHorarioDaJornada.getTime()).toBeGreaterThan(Date.now());
  });

  it("mantém folga suficiente para a suíte não quebrar ao rodar perto da virada do dia", () => {
    const diasDeFolga = (new Date(instanteLocalDe("09:00")).getTime() - Date.now()) / 86_400_000;
    expect(diasDeFolga).toBeGreaterThan(1);
  });

  it("é domingo, e `WEEKDAY_DA_DATA` é derivado dela (nunca digitado à parte)", () => {
    // Data e dia da semana divergirem significaria gravar a jornada num dia e
    // consultar outro — a lista voltaria vazia por motivo totalmente
    // diferente, e o spec acusaria a aplicação sem culpa.
    const [ano, mes, dia] = DATA.split("-").map(Number);
    expect(new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()).toBe(WEEKDAY_DA_DATA);
    expect(WEEKDAY_DA_DATA).toBe(0);
  });

  it("`DATA_SEGUINTE` é exatamente o dia seguinte", () => {
    const [ano, mes, dia] = DATA.split("-").map(Number);
    const esperado = new Date(Date.UTC(ano, mes - 1, dia, 12) + 86_400_000);
    expect(DATA_SEGUINTE).toBe(esperado.toISOString().slice(0, 10));
    expect(DATA_SEGUINTE).not.toBe(DATA);
  });

  it("traduz hora local do estabelecimento para o instante UTC certo, no dia certo", () => {
    for (const hora of ["09:00", "10:00", "11:00"]) {
      const instante = instanteLocalDe(hora);
      // Mesmo formato que o backend devolve em `startAt` — é por ele que os
      // specs localizam um horário na tela (`data-inicio`).
      expect(instante).toBe(new Date(instante).toISOString());
      expect(horaLocalDe(instante)).toBe(hora);
      expect(diaLocalDe(instante)).toBe(DATA);
    }
  });

  it("recusa uma hora local que não existe na data, em vez de mirar outra", () => {
    expect(() => instanteLocalDe("99:00")).toThrow();
  });
});
