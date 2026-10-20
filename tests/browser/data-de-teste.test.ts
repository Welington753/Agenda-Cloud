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
import {
  DATA,
  DATA_SEGUINTE,
  WEEKDAY_DA_DATA,
  hojeNoFusoDoTenant,
  inicioDoRelogioDeTeste,
  instanteLocalDe,
  proximoInicioDeHoje,
  weekdayDe,
} from "./data-de-teste";

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

describe("próximo início de hoje (atendimento em andamento)", () => {
  it("cai na grade de 15 min, hoje, com a folga pedida", () => {
    // 13:07:30Z = 10:07:30 em São Paulo; com 2 min de folga, o próximo é 10:15.
    const agora = new Date("2026-10-15T13:07:30.000Z");
    expect(hojeNoFusoDoTenant(agora)).toBe("2026-10-15");
    expect(proximoInicioDeHoje(agora, 2)).toEqual({
      horaLocal: "10:15",
      startAt: "2026-10-15T13:15:00.000Z",
    });
  });

  it("perto da meia-noite não inventa outro dia", () => {
    // 02:50Z = 23:50 em São Paulo.
    expect(proximoInicioDeHoje(new Date("2026-10-16T02:50:00.000Z"), 2)).toBeNull();
  });

  it("dia da semana de uma data de calendário", () => {
    expect(weekdayDe("2026-10-18")).toBe(0);
    expect(weekdayDe("2026-10-15")).toBe(4);
  });
});

describe("relógio de teste da Visão geral", () => {
  // Bordas da hora REAL: antes, a partir das 21:28 locais o spec era pulado
  // e entre 21:13 e 21:27 a última reserva passava do fim da jornada. 21:00
  // local é 00:00 UTC (o dia do runner do CI vira ali, o do estabelecimento não).
  const casos: [string, string][] = [
    ["2026-10-20T12:00:00.000Z", "2026-10-20"], // 09:00
    ["2026-10-21T00:00:00.000Z", "2026-10-20"], // 21:00, virada do dia em UTC
    ["2026-10-21T00:13:00.000Z", "2026-10-20"], // 21:13
    ["2026-10-21T00:30:00.000Z", "2026-10-20"], // 21:30
    ["2026-10-21T00:31:00.000Z", "2026-10-20"], // 21:31
    ["2026-10-21T02:50:00.000Z", "2026-10-20"], // 23:50
    ["2026-10-21T02:59:59.999Z", "2026-10-20"], // 23:59:59.999
    ["2026-10-21T03:00:00.000Z", "2026-10-21"], // 00:00
    ["2026-10-21T03:01:00.000Z", "2026-10-21"], // 00:01
  ];

  it.each(casos)("hora real %s: começa às 10:00 de %s, com o caso inteiro no mesmo dia", (real, dia) => {
    const inicio = inicioDoRelogioDeTeste(new Date(real));
    expect(diaLocalDe(inicio.toISOString())).toBe(dia);
    expect(horaLocalDe(inicio.toISOString())).toBe("10:00");
    // Mesma conta do spec: início com 3 min de folga, última reserva 120 min
    // depois (30 min de duração) terminando antes do fim da jornada (23:45).
    const caso = proximoInicioDeHoje(inicio, 3, "21:15");
    expect(caso).toEqual({ horaLocal: "10:15", startAt: `${dia}T13:15:00.000Z` });
  });

  it("nunca fica a um dia ou mais do relógio real (sessão e cookie seguem valendo)", () => {
    for (const [real] of casos) {
      const distancia = Math.abs(inicioDoRelogioDeTeste(new Date(real)).getTime() - Date.parse(real));
      expect(distancia).toBeLessThan(86_400_000);
    }
  });
});
