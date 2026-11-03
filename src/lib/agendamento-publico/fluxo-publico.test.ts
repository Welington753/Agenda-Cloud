import { describe, expect, it } from "vitest";
import type { PaginaPublica } from "@/lib/api/public-booking-api";
import {
  ESCOLHAS_VAZIAS,
  ETAPA_DADOS,
  ETAPA_HORARIO,
  ETAPA_PROFISSIONAL,
  ETAPA_REVISAR,
  ETAPA_SERVICO,
  alternarServicoNaEscolha,
  conferirHorario,
  resumoPublico,
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
  return { serviceIds: ["corte"], professionalId: "bia", date: "2027-03-07", slot: NOVE, nome: "Joana", whatsapp: "(11) 98888-0001" };
}

describe("percurso do agendamento público", () => {
  it("serviço com vários profissionais não escolhe nenhum por conta própria", () => {
    const r = escolherServico(PAGINA, ESCOLHAS_VAZIAS, "corte", "2027-03-07");
    expect(r.professionalId).toBeNull();
    expect(etapaMaxima(PAGINA, r)).toBe(ETAPA_PROFISSIONAL);
  });

  it("profissional único já vem escolhido (com o id certo), mas a etapa não é pulada", () => {
    const r = escolherServico(PAGINA, ESCOLHAS_VAZIAS, "massagem", "2027-03-07");
    expect(r.professionalId).toBe("caio");
    expect(r.date).toBe("2027-03-07");
    // Pode seguir para o horário, mas voltar passa de novo pela etapa Profissional.
    expect(etapaMaxima(PAGINA, r)).toBe(ETAPA_HORARIO);
    expect(etapaAnterior(ETAPA_HORARIO)).toBe(ETAPA_PROFISSIONAL);
    expect(etapaAnterior(ETAPA_PROFISSIONAL)).toBe(ETAPA_SERVICO);
    expect(etapaAnterior(ETAPA_REVISAR)).toBe(ETAPA_DADOS);
  });

  it("serviço sem profissional elegível não deixa passar da etapa Profissional", () => {
    const pagina: PaginaPublica = { ...PAGINA, services: [...PAGINA.services, servico("orfao")] };
    const r = escolherServico(pagina, ESCOLHAS_VAZIAS, "orfao", "2027-03-07");
    expect(r.professionalId).toBeNull();
    expect(etapaMaxima(pagina, r)).toBe(ETAPA_PROFISSIONAL);
    // Nem com um id de outro serviço forçado.
    expect(etapaMaxima(pagina, { ...r, professionalId: "ana", date: "2027-03-07", slot: NOVE })).toBe(ETAPA_PROFISSIONAL);
  });

  it("trocar o serviço mantém o profissional que ainda atende e derruba o horário", () => {
    const r = escolherServico(PAGINA, { ...completo(), professionalId: "ana" }, "barba", null);
    expect(r.professionalId).toBe("ana");
    expect(r.slot).toBeNull();
    expect(r.nome).toBe("Joana");
  });

  it("serviço que o profissional não atende limpa o profissional (ou troca pelo único)", () => {
    const t = escolherServico(PAGINA, { ...completo(), professionalId: "caio" }, "corte", null);
    expect(t.professionalId).toBeNull();
    expect(t.slot).toBeNull();
    const s = escolherServico(PAGINA, { ...completo(), professionalId: "ana" }, "massagem", null);
    expect(s.professionalId).toBe("caio");
    expect(s.slot).toBeNull();
  });

  it("escolher de novo o mesmo serviço e profissional mantém o horário", () => {
    expect(escolherServico(PAGINA, completo(), "corte", null).slot).toEqual(NOVE);
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
    expect(etapaMaxima(PAGINA, { ...ESCOLHAS_VAZIAS, serviceIds: ["corte"] })).toBe(ETAPA_PROFISSIONAL);
    expect(etapaMaxima(PAGINA, { ...completo(), slot: null })).toBe(ETAPA_HORARIO);
    expect(etapaMaxima(PAGINA, { ...completo(), whatsapp: "1234" })).toBe(ETAPA_DADOS);
    expect(etapaMaxima(PAGINA, completo())).toBe(ETAPA_REVISAR);
    // Profissional que não atende o serviço não vale; serviço que saiu do catálogo também não.
    expect(etapaMaxima(PAGINA, { ...completo(), professionalId: "caio" })).toBe(ETAPA_PROFISSIONAL);
    expect(etapaMaxima(PAGINA, { ...completo(), serviceIds: ["removido"] })).toBe(ETAPA_SERVICO);
  });
});

describe("vários serviços no pedido público", () => {
  it("adicionar a barba ao corte deixa só quem faz os dois, e o horário cai", () => {
    const comCorte = { ...completo(), professionalId: "bia" };
    const r = alternarServicoNaEscolha(PAGINA, comCorte, "barba", "2027-03-07");
    expect(r.serviceIds).toEqual(["corte", "barba"]);
    // Bia só corta: sai; Ana é a única que faz os dois e fica escolhida.
    expect(r.professionalId).toBe("ana");
    expect(r.slot).toBeNull();
    expect(etapaMaxima(PAGINA, r)).toBe(ETAPA_HORARIO);
  });

  it("retirar volta à lista anterior; combinação que ninguém faz não deixa seguir", () => {
    const dois = alternarServicoNaEscolha(PAGINA, ESCOLHAS_VAZIAS, "corte", null);
    const tres = alternarServicoNaEscolha(PAGINA, dois, "massagem", null);
    expect(tres.serviceIds).toEqual(["corte", "massagem"]);
    expect(tres.professionalId).toBeNull();
    expect(etapaMaxima(PAGINA, tres)).toBe(ETAPA_PROFISSIONAL);
    expect(alternarServicoNaEscolha(PAGINA, tres, "massagem", null).serviceIds).toEqual(["corte"]);
  });

  it("Corte + Barba: R$ 67,50 e 60 min; um preço escondido vira sob consulta", () => {
    const corte = { id: "corte", name: "Corte", description: "", durationMinutes: 30, priceCents: 4250, priceVisible: true };
    const barba = { id: "barba", name: "Barba", description: "", durationMinutes: 30, priceCents: 2500, priceVisible: true };
    const resumo = resumoPublico([corte, barba]);
    expect([resumo.rotulo, resumo.minutos]).toEqual(["Corte + Barba", 60]);
    expect(resumo.preco).toContain("67,50");
    expect(resumoPublico([corte, { ...barba, priceVisible: false }]).preco).toBe("Sob consulta");
  });
});
