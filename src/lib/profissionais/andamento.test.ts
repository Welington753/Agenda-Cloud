import { describe, expect, it } from "vitest";
import type { AgendamentoReal, StatusAgendamentoReal } from "@/lib/api/appointments-api";
import {
  acoesDaReserva,
  mensagemFalhaStatus,
  mensagemSucessoStatus,
  temAlgumaAcao,
  type AcoesDaReserva,
} from "./andamento";

const INICIO = new Date("2026-09-20T12:00:00.000Z");
const MINUTO = 60_000;
const em = (ms: number) => new Date(INICIO.getTime() + ms);

function reserva(status: StatusAgendamentoReal): AgendamentoReal {
  return {
    id: "a1",
    startAt: INICIO.toISOString(),
    serviceEndAt: "2026-09-20T13:00:00.000Z",
    occupancyEndAt: "2026-09-20T13:00:00.000Z",
    localStart: "09:00",
    localServiceEnd: "10:00",
    timezone: "America/Sao_Paulo",
    status,
    durationMinutes: 60,
    priceCents: 5000,
    notes: null,
    professional: { id: "p1", name: "Ana" },
    service: { id: "s1", name: "Corte" },
    consumer: { id: "c1", name: "Maria", whatsapp: "(11) 90000-0000" },
    unitId: "u1",
    createdAt: "2026-09-19T12:00:00.000Z",
  };
}

const NENHUMA: AcoesDaReserva = {
  confirmar: false,
  iniciar: false,
  concluir: false,
  registrarFalta: false,
  remarcar: false,
  cancelar: false,
};

describe("acoesDaReserva", () => {
  it("PENDING bem antes: confirmar, remarcar e cancelar", () => {
    expect(acoesDaReserva(reserva("PENDING"), em(-2 * 60 * MINUTO))).toEqual({
      ...NENHUMA,
      confirmar: true,
      remarcar: true,
      cancelar: true,
    });
  });

  it("CONFIRMED 1 ms antes da janela de 30 min: ainda sem iniciar", () => {
    expect(acoesDaReserva(reserva("CONFIRMED"), em(-30 * MINUTO - 1)).iniciar).toBe(false);
  });

  it("na janela de 30 min, iniciar SE SOMA a remarcar e cancelar", () => {
    expect(acoesDaReserva(reserva("CONFIRMED"), em(-30 * MINUTO))).toEqual({
      ...NENHUMA,
      iniciar: true,
      remarcar: true,
      cancelar: true,
    });
    expect(acoesDaReserva(reserva("PENDING"), em(-10 * MINUTO))).toEqual({
      ...NENHUMA,
      confirmar: true,
      iniciar: true,
      remarcar: true,
      cancelar: true,
    });
  });

  it("CONFIRMED no instante do início: iniciar e concluir direto; ainda sem falta", () => {
    expect(acoesDaReserva(reserva("CONFIRMED"), INICIO)).toEqual({
      ...NENHUMA,
      iniciar: true,
      concluir: true,
    });
  });

  it("CONFIRMED depois do início: iniciar, concluir e registrar falta", () => {
    expect(acoesDaReserva(reserva("CONFIRMED"), em(1))).toEqual({
      ...NENHUMA,
      iniciar: true,
      concluir: true,
      registrarFalta: true,
    });
  });

  it("PENDING depois do início: iniciar e falta, nunca concluir direto", () => {
    expect(acoesDaReserva(reserva("PENDING"), em(10 * MINUTO))).toEqual({
      ...NENHUMA,
      iniciar: true,
      registrarFalta: true,
    });
  });

  it("IN_PROGRESS: só concluir, a qualquer momento", () => {
    for (const agora of [em(-20 * MINUTO), em(5 * 60 * MINUTO)]) {
      expect(acoesDaReserva(reserva("IN_PROGRESS"), agora)).toEqual({ ...NENHUMA, concluir: true });
    }
  });

  it.each(["COMPLETED", "NO_SHOW", "CANCELED"] as const)("%s é final: nenhuma ação", (status) => {
    for (const agora of [em(-60 * MINUTO), INICIO, em(60 * MINUTO)]) {
      const acoes = acoesDaReserva(reserva(status), agora);
      expect(acoes).toEqual(NENHUMA);
      expect(temAlgumaAcao(acoes)).toBe(false);
    }
  });
});

describe("mensagens do andamento", () => {
  it("sucesso nomeia o horário da reserva", () => {
    expect(mensagemSucessoStatus("complete", reserva("IN_PROGRESS"))).toContain("09:00");
    expect(mensagemSucessoStatus("no-show", reserva("CONFIRMED"))).toContain("Falta");
  });

  it("400 e 409 preferem a mensagem do servidor", () => {
    expect(
      mensagemFalhaStatus("start", { tipo: "nao_agendavel", mensagem: "Só é possível iniciar..." }),
    ).toBe("Só é possível iniciar...");
    expect(mensagemFalhaStatus("complete", { tipo: "horario_ocupado", mensagem: null })).toContain(
      "Nada foi alterado",
    );
  });

  it("falha de rede nunca afirma que nada aconteceu", () => {
    expect(mensagemFalhaStatus("no-show", { tipo: "falha_comunicacao" })).toContain(
      "pode ter sido gravada",
    );
  });

  it("403 fala de permissão de andamento", () => {
    expect(mensagemFalhaStatus("confirm", { tipo: "sem_permissao" })).toContain("permissão");
  });
});
