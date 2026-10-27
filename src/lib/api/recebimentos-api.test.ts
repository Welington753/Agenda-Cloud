import { describe, expect, it } from "vitest";
import { ehRecebimentos, ehResumoFinanceiro } from "./recebimentos-api";

const resumo = { receivedCents: 100, refundedCents: 0, netCents: 100, paidAppointments: 1, paidTotalCents: 100, averageTicketCents: 100 };

describe("contrato dos recebimentos", () => {
  it("ticket médio pode ser nulo (sem atendimento pago), nunca ausente", () => {
    expect(ehResumoFinanceiro({ ...resumo, averageTicketCents: null })).toBe(true);
    const semTicket: Record<string, unknown> = { ...resumo };
    delete semTicket.averageTicketCents;
    expect(ehResumoFinanceiro(semTicket)).toBe(false);
  });

  it("resposta inteira conferida", () => {
    const corpo = {
      timezone: "America/Sao_Paulo",
      period: { from: "2031-09-01", to: "2031-09-30" },
      summary: resumo,
      payments: [
        {
          id: "p1",
          appointmentId: "a1",
          amountCents: 4250,
          method: "PIX",
          receivedOn: "2031-09-10",
          recordedAt: "2031-09-10T15:00:00.000Z",
          recordedBy: { id: "u1", name: "Dona" },
          notes: null,
          refund: null,
          appointment: { localDate: "2031-09-10", localStart: "10:00", status: "COMPLETED", consumerName: "Ana", serviceName: "Corte", professionalName: "Bia" },
        },
      ],
      paymentsComplete: true,
      awaitingPayment: [],
      awaitingComplete: true,
    };
    expect(ehRecebimentos(corpo)).toBe(true);
    expect(ehRecebimentos({ ...corpo, payments: [{ ...corpo.payments[0], method: "BOLETO" }] })).toBe(false);
  });
});
