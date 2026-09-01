import { addDays } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  agendamentosParaOcupados,
  calcularHorariosDisponiveis,
  encontrarProfissionalDisponivel,
  horarioAindaDisponivel,
  type OpcoesDisponibilidade,
} from "./engine";
import type { Agendamento, HorarioDia } from "@/lib/types";

// Terça-feira, 2026-09-01 — dia de funcionamento de teste (evita depender do dia atual real).
const TERCA = new Date("2026-09-01T00:00:00");
const AGORA_CEDO = new Date("2026-09-01T07:00:00");

const HORARIO_PADRAO: HorarioDia[] = [
  { diaSemana: 2, ativo: true, inicio: "09:00", fim: "19:00", almocoInicio: "12:00", almocoFim: "13:00" },
];

function baseOpcoes(overrides: Partial<OpcoesDisponibilidade> = {}): OpcoesDisponibilidade {
  return {
    data: TERCA,
    horarios: HORARIO_PADRAO,
    duracaoServicoMinutos: 30,
    ocupados: [],
    antecedenciaMinimaMinutos: 60,
    limiteDiasFuturos: 30,
    agora: AGORA_CEDO,
    ...overrides,
  };
}

function hora(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(TERCA);
  d.setHours(h, m, 0, 0);
  return d;
}

describe("calcularHorariosDisponiveis", () => {
  it("não permite sobreposição: horário já ocupado por outro agendamento some da lista", () => {
    const opcoes = baseOpcoes({ ocupados: [{ inicio: hora("14:00"), fim: hora("14:30") }] });
    const disponiveis = calcularHorariosDisponiveis(opcoes);
    expect(disponiveis.some((d) => d.getTime() === hora("14:00").getTime())).toBe(false);
    // Um serviço que começaria às 13:45 e terminaria às 14:15 também conflita (sobreposição parcial).
    expect(disponiveis.some((d) => d.getTime() === hora("13:45").getTime())).toBe(false);
    // 14:30 em diante volta a ficar livre.
    expect(disponiveis.some((d) => d.getTime() === hora("14:30").getTime())).toBe(true);
  });

  it("respeita o limite de dias futuros para agendamento", () => {
    // 42 dias à frente (6 terças depois) ultrapassa o limite de 30 dias, mas continua
    // sendo um dia de funcionamento (terça-feira), isolando o efeito do limite.
    const diaMuitoFuturo = addDays(TERCA, 42);
    const opcoesDentroDoLimite = baseOpcoes({ data: hora("10:00"), limiteDiasFuturos: 30 });
    const opcoesForaDoLimite = baseOpcoes({ data: diaMuitoFuturo, limiteDiasFuturos: 30 });
    expect(calcularHorariosDisponiveis(opcoesDentroDoLimite).length).toBeGreaterThan(0);
    expect(calcularHorariosDisponiveis(opcoesForaDoLimite)).toHaveLength(0);
  });

  it("respeita a duração do serviço: só mostra horário se o serviço inteiro cabe antes do fechamento", () => {
    const opcoes = baseOpcoes({ duracaoServicoMinutos: 60 });
    const disponiveis = calcularHorariosDisponiveis(opcoes);
    // Expediente fecha às 19:00 — um serviço de 60 min não pode começar às 18:30.
    expect(disponiveis.some((d) => d.getTime() === hora("18:30").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("18:00").getTime())).toBe(true);
  });

  it("respeita o horário de almoço e bloqueios manuais", () => {
    const opcoes = baseOpcoes({
      ocupados: [{ inicio: hora("16:00"), fim: hora("17:00") }], // bloqueio manual
    });
    const disponiveis = calcularHorariosDisponiveis(opcoes);
    expect(disponiveis.some((d) => d.getTime() === hora("12:00").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("12:30").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("16:30").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("13:00").getTime())).toBe(true);
  });

  it("cancelamento libera novamente o horário", () => {
    const duracaoPorServico = new Map([["serv-x", 30]]);
    const intervaloPorServico = new Map([["serv-x", 0]]);
    const agendamentoCancelado: Agendamento = {
      id: "ag-1",
      tenantId: "t1",
      consumidorId: "c1",
      consumidorNome: "Consumidor Teste",
      consumidorWhatsapp: "(11) 90000-0000",
      profissionalId: "p1",
      servicoId: "serv-x",
      dataHoraInicio: hora("10:00").toISOString(),
      dataHoraFim: hora("10:30").toISOString(),
      status: "cancelado",
      precoCentavos: 4000,
      criadoEm: new Date().toISOString(),
      historico: [],
    };
    const ocupados = agendamentosParaOcupados([agendamentoCancelado], duracaoPorServico, intervaloPorServico);
    expect(ocupados).toHaveLength(0);

    const disponiveis = calcularHorariosDisponiveis(baseOpcoes({ ocupados }));
    expect(disponiveis.some((d) => d.getTime() === hora("10:00").getTime())).toBe(true);
  });
});

describe("encontrarProfissionalDisponivel", () => {
  it("escolhe o primeiro profissional com horário livre quando o cliente pede 'qualquer profissional'", () => {
    const ocupadoDiaTodo = [{ inicio: hora("09:00"), fim: hora("19:00") }];
    const resultado = encontrarProfissionalDisponivel([
      { profissionalId: "prof-ocupado", opcoes: baseOpcoes({ ocupados: ocupadoDiaTodo }) },
      { profissionalId: "prof-livre", opcoes: baseOpcoes() },
    ]);
    expect(resultado?.profissionalId).toBe("prof-livre");
    expect(resultado?.horarios.length).toBeGreaterThan(0);
  });

  it("retorna undefined quando nenhum profissional está disponível", () => {
    const ocupadoDiaTodo = [{ inicio: hora("09:00"), fim: hora("19:00") }];
    const resultado = encontrarProfissionalDisponivel([
      { profissionalId: "prof-a", opcoes: baseOpcoes({ ocupados: ocupadoDiaTodo }) },
      { profissionalId: "prof-b", opcoes: baseOpcoes({ ocupados: ocupadoDiaTodo }) },
    ]);
    expect(resultado).toBeUndefined();
  });
});

describe("horarioAindaDisponivel", () => {
  it("detecta quando um horário deixou de estar disponível entre a listagem e a confirmação", () => {
    const opcoesIniciais = baseOpcoes();
    expect(horarioAindaDisponivel(opcoesIniciais, hora("15:00"))).toBe(true);

    const opcoesComNovoConflito = baseOpcoes({ ocupados: [{ inicio: hora("15:00"), fim: hora("15:30") }] });
    expect(horarioAindaDisponivel(opcoesComNovoConflito, hora("15:00"))).toBe(false);
  });
});

describe("intervalo posterior e duração real do agendamento existente", () => {
  it("agendamento existente de 90 minutos não vira 30 minutos quando o novo serviço é diferente", () => {
    const outroServico: Agendamento = {
      id: "ag-outro",
      tenantId: "t1",
      consumidorId: "c1",
      consumidorNome: "Cliente",
      consumidorWhatsapp: "(11) 90000-0000",
      profissionalId: "p1",
      servicoId: "serv-longo",
      dataHoraInicio: hora("10:00").toISOString(),
      dataHoraFim: hora("11:30").toISOString(),
      status: "confirmado",
      precoCentavos: 5000,
      criadoEm: new Date().toISOString(),
      historico: [],
    };
    const ocupados = agendamentosParaOcupados(
      [outroServico],
      new Map([["serv-x", 30]]),
      new Map([["serv-x", 0]])
    );
    expect(ocupados).toHaveLength(1);
    expect(ocupados[0].fim.getTime()).toBe(hora("11:30").getTime());
    expect(ocupados[0].fim.getTime()).not.toBe(hora("10:30").getTime());

    const disponiveis = calcularHorariosDisponiveis(baseOpcoes({ ocupados }));
    expect(disponiveis.some((d) => d.getTime() === hora("11:00").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("11:30").getTime())).toBe(true);
  });

  it("intervalo posterior do agendamento existente bloqueia o próximo início", () => {
    const agendamento: Agendamento = {
      id: "ag-1",
      tenantId: "t1",
      consumidorId: "c1",
      consumidorNome: "Cliente",
      consumidorWhatsapp: "(11) 90000-0000",
      profissionalId: "p1",
      servicoId: "serv-x",
      dataHoraInicio: hora("10:00").toISOString(),
      dataHoraFim: hora("10:30").toISOString(),
      status: "confirmado",
      precoCentavos: 4000,
      criadoEm: new Date().toISOString(),
      historico: [],
    };
    const ocupados = agendamentosParaOcupados(
      [agendamento],
      new Map([["serv-x", 30]]),
      new Map([["serv-x", 15]])
    );
    expect(ocupados[0].fim.getTime()).toBe(hora("10:45").getTime());

    const disponiveis = calcularHorariosDisponiveis(baseOpcoes({ ocupados }));
    expect(disponiveis.some((d) => d.getTime() === hora("10:30").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("10:45").getTime())).toBe(true);
  });

  it("intervalo posterior do novo serviço impede sobreposição com o próximo compromisso", () => {
    const opcoes = baseOpcoes({
      duracaoServicoMinutos: 30,
      intervaloPosteriorMinutos: 20,
      ocupados: [{ inicio: hora("11:00"), fim: hora("11:30") }],
    });
    const disponiveis = calcularHorariosDisponiveis(opcoes);
    // 10:15 + 30min + 20min de intervalo = 11:05, invade o compromisso das 11:00 —
    // não deve aparecer. 09:45 + 30min + 20min = 10:35, sem invasão — deve aparecer.
    expect(disponiveis.some((d) => d.getTime() === hora("10:15").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("09:45").getTime())).toBe(true);
  });

  it("duração + intervalo do novo serviço precisam caber antes do fechamento", () => {
    const opcoes = baseOpcoes({ duracaoServicoMinutos: 30, intervaloPosteriorMinutos: 20 });
    const disponiveis = calcularHorariosDisponiveis(opcoes);
    // Fecha às 19:00. 18:15 + 30min + 20min = 19:05, passa do fechamento — não deve
    // aparecer. 18:00 + 30min + 20min = 18:50, cabe exatamente — deve aparecer.
    expect(disponiveis.some((d) => d.getTime() === hora("18:15").getTime())).toBe(false);
    expect(disponiveis.some((d) => d.getTime() === hora("18:00").getTime())).toBe(true);
  });

  it("cancelamento continua liberando o horário mesmo com intervalo posterior cadastrado", () => {
    const cancelado: Agendamento = {
      id: "ag-c",
      tenantId: "t1",
      consumidorId: "c1",
      consumidorNome: "Cliente",
      consumidorWhatsapp: "(11) 90000-0000",
      profissionalId: "p1",
      servicoId: "serv-x",
      dataHoraInicio: hora("10:00").toISOString(),
      dataHoraFim: hora("10:30").toISOString(),
      status: "cancelado",
      precoCentavos: 4000,
      criadoEm: new Date().toISOString(),
      historico: [],
    };
    const ocupados = agendamentosParaOcupados([cancelado], new Map([["serv-x", 30]]), new Map([["serv-x", 15]]));
    expect(ocupados).toHaveLength(0);
    const disponiveis = calcularHorariosDisponiveis(baseOpcoes({ ocupados }));
    expect(disponiveis.some((d) => d.getTime() === hora("10:00").getTime())).toBe(true);
  });
});
