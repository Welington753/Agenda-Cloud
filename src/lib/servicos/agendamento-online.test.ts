import { describe, expect, it } from "vitest";
import { motivoForaDoOnline } from "./agendamento-online";

const servico = (extra: Partial<{ active: boolean; activeInPublicBooking: boolean }> = {}) => ({
  id: "sobrancelha",
  active: true,
  activeInPublicBooking: true,
  ...extra,
});
const profissional = (active: boolean, ...serviceIds: string[]) => ({ active, services: serviceIds.map((serviceId) => ({ serviceId })) });

describe("motivoForaDoOnline", () => {
  it("serviço novo sem profissional que o realize fica fora, com o motivo", () => {
    expect(motivoForaDoOnline(servico(), [profissional(true, "corte", "barba")])).toBe("sem_profissional");
    expect(motivoForaDoOnline(servico(), [])).toBe("sem_profissional");
  });

  it("profissional inativo não conta", () => {
    expect(motivoForaDoOnline(servico(), [profissional(false, "sobrancelha")])).toBe("sem_profissional");
  });

  it("com um profissional ativo que o realiza, aparece", () => {
    expect(motivoForaDoOnline(servico(), [profissional(false, "sobrancelha"), profissional(true, "sobrancelha")])).toBeNull();
  });

  it("desligado no online vem antes do vínculo; inativo não recebe aviso", () => {
    expect(motivoForaDoOnline(servico({ activeInPublicBooking: false }), [profissional(true, "sobrancelha")])).toBe("desligado_no_online");
    expect(motivoForaDoOnline(servico({ active: false }), [])).toBeNull();
  });
});
