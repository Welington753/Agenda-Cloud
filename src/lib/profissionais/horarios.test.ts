import { describe, expect, it } from "vitest";
import {
  DIAS_DA_SEMANA,
  ehHoraValida,
  paraSemanaEditavel,
  validarDia,
  validarSemana,
} from "./horarios";

describe("formato de hora (espelho da regra do servidor)", () => {
  it.each(["00:00", "09:00", "23:59"])("aceita %s", (valor) => {
    expect(ehHoraValida(valor)).toBe(true);
  });

  it.each(["9:00", "09:0", "24:00", "09:60", "", "9h"])("recusa %s", (valor) => {
    expect(ehHoraValida(valor)).toBe(false);
  });
});

describe("validarDia", () => {
  it("aponta o campo exato quando a hora está fora do formato", () => {
    const resultado = validarDia([{ start: "9:00", end: "18:00" }]);
    expect(resultado.errosDeCampo).toEqual([
      { intervalo: 0, campo: "start", mensagem: "Use HH:MM." },
    ]);
  });

  it("aponta o fim quando ele não é depois do início — nunca vira virada de dia", () => {
    const resultado = validarDia([{ start: "18:00", end: "09:00" }]);
    expect(resultado.errosDeCampo).toEqual([
      { intervalo: 0, campo: "end", mensagem: "O fim precisa ser depois do início." },
    ]);
  });

  it("recusa sobreposição com erro do dia", () => {
    const resultado = validarDia([
      { start: "09:00", end: "13:00" },
      { start: "12:00", end: "18:00" },
    ]);
    expect(resultado.erroDoDia).toMatch(/se sobrep/);
  });

  it("adjacentes não são sobreposição: viram um período contínuo", () => {
    const resultado = validarDia([
      { start: "09:00", end: "12:00" },
      { start: "12:00", end: "18:00" },
    ]);
    expect(resultado.erroDoDia).toBeNull();
    expect(resultado.intervals).toEqual([{ start: "09:00", end: "18:00" }]);
  });

  it("ordena manhã e tarde de forma determinística", () => {
    const resultado = validarDia([
      { start: "13:00", end: "18:00" },
      { start: "09:00", end: "12:00" },
    ]);
    expect(resultado.intervals).toEqual([
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "18:00" },
    ]);
  });

  it("recusa três intervalos, explicando o limite do modelo", () => {
    const resultado = validarDia([
      { start: "08:00", end: "10:00" },
      { start: "11:00", end: "13:00" },
      { start: "14:00", end: "16:00" },
    ]);
    expect(resultado.erroDoDia).toMatch(/no máximo 2 intervalos/);
  });
});

describe("validarSemana", () => {
  it("dia sem intervalo não vira erro nem entra no envio", () => {
    const semana = paraSemanaEditavel([]);
    const validacao = validarSemana(semana);

    expect(validacao.ok).toBe(true);
    expect(validacao.days).toEqual([]);
  });

  it("monta o envio só com os dias que atendem, em ordem", () => {
    const semana = paraSemanaEditavel([
      { weekday: 3, intervals: [{ start: "10:00", end: "16:00" }] },
      {
        weekday: 1,
        intervals: [
          { start: "09:00", end: "12:00" },
          { start: "13:00", end: "18:00" },
        ],
      },
    ]);

    const validacao = validarSemana(semana);

    expect(validacao.ok).toBe(true);
    expect(validacao.days.map((d) => d.weekday)).toEqual([1, 3]);
    expect(validacao.days[0].intervals).toHaveLength(2);
  });

  it("um dia inválido reprova a semana inteira e não devolve envio parcial", () => {
    const semana = paraSemanaEditavel([
      { weekday: 1, intervals: [{ start: "09:00", end: "18:00" }] },
      { weekday: 2, intervals: [{ start: "18:00", end: "09:00" }] },
    ]);

    const validacao = validarSemana(semana);

    expect(validacao.ok).toBe(false);
    expect(validacao.days).toEqual([]);
    expect(validacao.errosDeCampo[2]).toHaveLength(1);
  });

  it("erro de um dia não contamina os outros", () => {
    const semana = paraSemanaEditavel([
      { weekday: 1, intervals: [{ start: "09:00", end: "18:00" }] },
      { weekday: 2, intervals: [{ start: "09:00", end: "9:00" }] },
    ]);

    const validacao = validarSemana(semana);

    expect(validacao.errosDeCampo[1]).toBeUndefined();
    expect(validacao.errosDeCampo[2]).toBeDefined();
  });
});

describe("paraSemanaEditavel", () => {
  it("sempre devolve os sete dias, com lista vazia em quem não atende", () => {
    const semana = paraSemanaEditavel([{ weekday: 6, intervals: [{ start: "09:00", end: "13:00" }] }]);

    expect(Object.keys(semana)).toHaveLength(DIAS_DA_SEMANA.length);
    expect(semana[0]).toEqual([]);
    expect(semana[6]).toEqual([{ start: "09:00", end: "13:00" }]);
  });

  it("copia os intervalos — editar a tela nunca muda a resposta da API em memória", () => {
    const daApi = [{ weekday: 1, intervals: [{ start: "09:00", end: "18:00" }] }];
    const semana = paraSemanaEditavel(daApi);
    semana[1][0].start = "10:00";

    expect(daApi[0].intervals[0].start).toBe("09:00");
  });
});
