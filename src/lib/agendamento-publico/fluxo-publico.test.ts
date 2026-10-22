import { describe, expect, it } from "vitest";
import type { PaginaPublica } from "@/lib/api/public-booking-api";
import {
  ESCOLHAS_VAZIAS,
  ETAPA_DADOS,
  ETAPA_HORARIO,
  ETAPA_PROFISSIONAL,
  ETAPA_REVISAR,
  ETAPA_SERVICO,
  conferirHorario,
  escolherDia,
  escolherProfissional,
  escolherServico,
  etapaAnterior,
  etapaMaxima,
  type Escolhas,
} from "./fluxo-publico";

const servico = (id: string) => ({ id, name: id, description: "", durationMinutes: 30, priceCents: null, priceVisible: true });
const PAGINA: PaginaPublica = {
  establishment: { name: "Estúdio", slug: "estudio", timezone: "America/Sao_Paulo" },
  services: [servico("corte"), servico("barba"), servico("massagem")],
  professionals: [
    { id: "ana", name: "Ana", initials: "AN", serviceIds: ["corte", "barba"] },
    { id: "bia", name: "Bia", initials: "BI", serviceIds: ["corte"] },
    { id: "caio", name: "Caio", initials: "CA", serviceIds: ["massagem"] },
  ],
};
const NOVE = { startAt: "2027-03-07T12:00:00.000Z", localStart: "09:00" };

function completo(): Escolhas {
  return { serviceId: "corte", professionalId: "bia", date: "2027-03-07", slot: NOVE, nome: "Joana", whatsapp: "(11) 98888-0001" };
}

describe("percurso do agendamento público", () => {
  it("serviço com vários profissionais vai para a escolha do profissional", () => {
    const r = escolherServico(PAGINA, ESCOLHAS_VAZIAS, "corte", "2027-03-07");
    expect(r.proxima).toBe(ETAPA_PROFISSIONAL);
    expect(r.escolhas.professionalId).toBeNull();
  });

  it("profissional único já vem escolhido (com o id certo) e a etapa é pulada na ida e na volta", () => {
    const r = escolherServico(PAGINA, ESCOLHAS_VAZIAS, "massagem", "2027-03-07");
    expect(r.proxima).toBe(ETAPA_HORARIO);
    expect(r.escolhas.professionalId).toBe("caio");
    expect(r.escolhas.date).toBe("2027-03-07");
    expect(etapaAnterior(PAGINA, r.escolhas, ETAPA_HORARIO)).toBe(ETAPA_SERVICO);
    expect(etapaAnterior(PAGINA, completo(), ETAPA_HORARIO)).toBe(ETAPA_PROFISSIONAL);
    expect(etapaAnterior(PAGINA, completo(), ETAPA_REVISAR)).toBe(ETAPA_DADOS);
  });

  it("trocar o serviço mantém o profissional que ainda atende e derruba o horário", () => {
    const r = escolherServico(PAGINA, { ...completo(), professionalId: "ana" }, "barba", null);
    expect(r.escolhas.professionalId).toBe("ana");
    expect(r.escolhas.slot).toBeNull();
    expect(r.escolhas.nome).toBe("Joana");
  });

  it("serviço que o profissional não atende limpa o profissional (ou troca pelo único)", () => {
    const t = escolherServico(PAGINA, { ...completo(), professionalId: "caio" }, "corte", null);
    expect(t.escolhas.professionalId).toBeNull();
    expect(t.escolhas.slot).toBeNull();
    const s = escolherServico(PAGINA, { ...completo(), professionalId: "ana" }, "massagem", null);
    expect(s.escolhas.professionalId).toBe("caio");
    expect(s.escolhas.slot).toBeNull();
  });

  it("escolher de novo o mesmo serviço e profissional mantém o horário", () => {
    expect(escolherServico(PAGINA, completo(), "corte", null).escolhas.slot).toEqual(NOVE);
    expect(escolherProfissional(completo(), "bia", null).slot).toEqual(NOVE);
  });

  it("trocar profissional ou dia derruba o horário; o primeiro dia é o padrão", () => {
    expect(escolherProfissional(completo(), "ana", null).slot).toBeNull();
    expect(escolherProfissional(ESCOLHAS_VAZIAS, "ana", "2027-03-07").date).toBe("2027-03-07");
    expect(escolherDia(completo(), "2027-03-08").slot).toBeNull();
    expect(escolherDia(completo(), "2027-03-07").slot).toEqual(NOVE);
  });

  it("horário que sumiu da lista mais recente cai", () => {
    expect(conferirHorario(completo(), [{ startAt: NOVE.startAt }]).slot).toEqual(NOVE);
    expect(conferirHorario(completo(), [{ startAt: "2027-03-07T13:00:00.000Z" }]).slot).toBeNull();
    const sem = { ...completo(), slot: null };
    expect(conferirHorario(sem, [])).toBe(sem);
  });

  it("só abre a etapa que as escolhas permitem", () => {
    expect(etapaMaxima(PAGINA, ESCOLHAS_VAZIAS)).toBe(ETAPA_SERVICO);
    expect(etapaMaxima(PAGINA, { ...ESCOLHAS_VAZIAS, serviceId: "corte" })).toBe(ETAPA_PROFISSIONAL);
    expect(etapaMaxima(PAGINA, { ...completo(), slot: null })).toBe(ETAPA_HORARIO);
    expect(etapaMaxima(PAGINA, { ...completo(), whatsapp: "1234" })).toBe(ETAPA_DADOS);
    expect(etapaMaxima(PAGINA, completo())).toBe(ETAPA_REVISAR);
    // Profissional que não atende o serviço não vale; serviço que saiu do catálogo também não.
    expect(etapaMaxima(PAGINA, { ...completo(), professionalId: "caio" })).toBe(ETAPA_PROFISSIONAL);
    expect(etapaMaxima(PAGINA, { ...completo(), serviceId: "removido" })).toBe(ETAPA_SERVICO);
  });
});
