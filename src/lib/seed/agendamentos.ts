// Construção de agendamentos, consumidores derivados e bloqueios de agenda.

import { addDays } from "date-fns";
import type { Agendamento, Bloqueio, Consumidor, Servico, StatusAgendamento } from "../types";
import { gerarServicosSeed } from "./servicos";
import {
  DIAS_SEG_A_SAB,
  DIAS_SEG_A_SEX,
  DIAS_TER_A_SAB,
  TENANT_BARBEARIA_JR,
  TENANT_BARBEIRO_BASTIAO,
  TENANT_CLINICA_SORRISO_LEVE,
  TENANT_DOM_NAVALHA,
  diasUteisPassados,
  historico,
  horaISO,
  proximosDiasUteis,
  somarMinutosISO,
} from "./shared";

interface RascunhoAgendamento {
  id: string;
  consumidorNome: string;
  consumidorWhatsapp: string;
  profissionalId: string;
  servicoId: string;
  dia: Date | undefined;
  hora: string;
  status: StatusAgendamento;
}

function slugifyNome(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-");
}

/** Constrói agendamentos e agrega estatísticas de consumidores a partir de
 * rascunhos — reaproveitado por qualquer tenant, sem nenhum conhecimento de
 * nicho. O mesmo telefone pode aparecer em rascunhos de tenants diferentes: como
 * o id do consumidor é derivado de `tenantId + nome`, cada tenant sempre gera um
 * registro `Consumidor` isolado, mesmo que a pessoa "exista" em mais de um. */
function construirAgendamentosEConsumidores(
  tenantId: string,
  rascunhosBrutos: RascunhoAgendamento[],
  duracaoPorServico: Map<string, number>,
  precoPorServico: Map<string, number | undefined>
): { agendamentos: Agendamento[]; consumidores: Consumidor[] } {
  const rascunhos = rascunhosBrutos.filter((r): r is RascunhoAgendamento & { dia: Date } => r.dia !== undefined);

  const agendamentos: Agendamento[] = rascunhos.map((r) => {
    const inicio = horaISO(r.dia, r.hora);
    const duracao = duracaoPorServico.get(r.servicoId) ?? 30;
    const criadoEm = addDays(new Date(inicio), -3).toISOString();
    return {
      id: r.id,
      tenantId,
      consumidorId: `cons-${tenantId}-${slugifyNome(r.consumidorNome)}`,
      consumidorNome: r.consumidorNome,
      consumidorWhatsapp: r.consumidorWhatsapp,
      profissionalId: r.profissionalId,
      servicoId: r.servicoId,
      dataHoraInicio: inicio,
      dataHoraFim: somarMinutosISO(inicio, duracao),
      status: r.status,
      precoCentavos: precoPorServico.get(r.servicoId),
      criadoEm,
      historico: historico(r.status, "consumidor", criadoEm),
    };
  });

  const consumidoresMap = new Map<string, Consumidor>();
  for (const ag of agendamentos) {
    const existente = consumidoresMap.get(ag.consumidorId);
    const isPassadoOuHoje = new Date(ag.dataHoraInicio).getTime() <= Date.now();
    const consumidor: Consumidor = existente ?? {
      id: ag.consumidorId,
      tenantId,
      nome: ag.consumidorNome,
      whatsapp: ag.consumidorWhatsapp,
      totalVisitas: 0,
      totalFaltas: 0,
    };
    if (ag.status === "concluido") {
      consumidor.totalVisitas += 1;
      if (!consumidor.ultimoAtendimentoEm || ag.dataHoraInicio > consumidor.ultimoAtendimentoEm) {
        consumidor.ultimoAtendimentoEm = ag.dataHoraInicio;
      }
    }
    if (ag.status === "nao_compareceu") consumidor.totalFaltas += 1;
    if (!isPassadoOuHoje && (ag.status === "confirmado" || ag.status === "pendente")) {
      if (!consumidor.proximoAgendamentoEm || ag.dataHoraInicio < consumidor.proximoAgendamentoEm) {
        consumidor.proximoAgendamentoEm = ag.dataHoraInicio;
      }
    }
    consumidoresMap.set(ag.consumidorId, consumidor);
  }

  return { agendamentos, consumidores: Array.from(consumidoresMap.values()) };
}

function gerarAgendamentosEConsumidoresDomNavalha(servicos: Servico[]) {
  const doTenant = servicos.filter((s) => s.tenantId === TENANT_DOM_NAVALHA);
  const duracaoPorServico = new Map(doTenant.map((s) => [s.id, s.duracaoMinutos]));
  const precoPorServico = new Map(doTenant.map((s) => [s.id, s.precoCentavos]));

  const [passado2, passado1] = diasUteisPassados(2, DIAS_TER_A_SAB);
  const [hoje, futuro1, futuro2, futuro3, futuro4] = proximosDiasUteis(0, 5, DIAS_TER_A_SAB);

  const rascunhos: RascunhoAgendamento[] = [
    { id: "ag-001", consumidorNome: "Marcos Andrade", consumidorWhatsapp: "(11) 98123-4501", profissionalId: "prof-joao-silva", servicoId: "serv-corte-tradicional", dia: passado2, hora: "10:00", status: "concluido" },
    { id: "ag-002", consumidorNome: "Felipe Nogueira", consumidorWhatsapp: "(11) 98123-4502", profissionalId: "prof-pedro-martins", servicoId: "serv-barba", dia: passado2, hora: "15:00", status: "nao_compareceu" },
    { id: "ag-003", consumidorNome: "Rodrigo Lima", consumidorWhatsapp: "(11) 98123-4503", profissionalId: "prof-rafael-costa", servicoId: "serv-corte-degrade", dia: passado2, hora: "11:00", status: "concluido" },
    { id: "ag-004", consumidorNome: "Marcos Andrade", consumidorWhatsapp: "(11) 98123-4501", profissionalId: "prof-joao-silva", servicoId: "serv-corte-barba", dia: passado1, hora: "09:30", status: "concluido" },
    { id: "ag-005", consumidorNome: "Bruno Carvalho", consumidorWhatsapp: "(11) 98123-4504", profissionalId: "prof-pedro-martins", servicoId: "serv-corte-tradicional", dia: passado1, hora: "17:00", status: "cancelado" },
    { id: "ag-006", consumidorNome: "Diego Fonseca", consumidorWhatsapp: "(11) 98123-4505", profissionalId: "prof-joao-silva", servicoId: "serv-corte-degrade", dia: hoje, hora: "09:30", status: "concluido" },
    { id: "ag-007", consumidorNome: "Rodrigo Lima", consumidorWhatsapp: "(11) 98123-4503", profissionalId: "prof-rafael-costa", servicoId: "serv-barba", dia: hoje, hora: "11:00", status: "confirmado" },
    { id: "ag-008", consumidorNome: "Felipe Nogueira", consumidorWhatsapp: "(11) 98123-4502", profissionalId: "prof-pedro-martins", servicoId: "serv-corte-tradicional", dia: hoje, hora: "14:00", status: "pendente" },
    { id: "ag-009", consumidorNome: "Bruno Carvalho", consumidorWhatsapp: "(11) 98123-4504", profissionalId: "prof-joao-silva", servicoId: "serv-corte-barba", dia: hoje, hora: "16:30", status: "confirmado" },
    { id: "ag-010", consumidorNome: "Marcos Andrade", consumidorWhatsapp: "(11) 98123-4501", profissionalId: "prof-joao-silva", servicoId: "serv-corte-tradicional", dia: futuro1, hora: "10:00", status: "confirmado" },
    { id: "ag-011", consumidorNome: "Diego Fonseca", consumidorWhatsapp: "(11) 98123-4505", profissionalId: "prof-rafael-costa", servicoId: "serv-corte-degrade", dia: futuro1, hora: "11:00", status: "pendente" },
    { id: "ag-012", consumidorNome: "Camila Ribeiro", consumidorWhatsapp: "(11) 98123-4506", profissionalId: "prof-pedro-martins", servicoId: "serv-corte-tradicional", dia: futuro2, hora: "09:00", status: "confirmado" },
    { id: "ag-013", consumidorNome: "Bruno Carvalho", consumidorWhatsapp: "(11) 98123-4504", profissionalId: "prof-joao-silva", servicoId: "serv-barba", dia: futuro3, hora: "13:30", status: "pendente" },
    { id: "ag-014", consumidorNome: "Felipe Nogueira", consumidorWhatsapp: "(11) 98123-4502", profissionalId: "prof-rafael-costa", servicoId: "serv-corte-barba", dia: futuro4, hora: "15:00", status: "confirmado" },
  ];

  return construirAgendamentosEConsumidores(TENANT_DOM_NAVALHA, rascunhos, duracaoPorServico, precoPorServico);
}

function gerarAgendamentosEConsumidoresClinica(servicos: Servico[]) {
  const doTenant = servicos.filter((s) => s.tenantId === TENANT_CLINICA_SORRISO_LEVE);
  const duracaoPorServico = new Map(doTenant.map((s) => [s.id, s.duracaoMinutos]));
  const precoPorServico = new Map(doTenant.map((s) => [s.id, s.precoCentavos]));

  const [passado1] = diasUteisPassados(1, DIAS_SEG_A_SEX);
  const [hoje, futuro1, futuro2, futuro3] = proximosDiasUteis(0, 4, DIAS_SEG_A_SEX);

  const rascunhos: RascunhoAgendamento[] = [
    { id: "ag-c001", consumidorNome: "Helena Duarte", consumidorWhatsapp: "(11) 97123-9001", profissionalId: "prof-mariana-alves", servicoId: "serv-limpeza", dia: passado1, hora: "09:00", status: "concluido" },
    { id: "ag-c002", consumidorNome: "Otávio Ramos", consumidorWhatsapp: "(11) 97123-9002", profissionalId: "prof-lucas-ferreira", servicoId: "serv-avaliacao-inicial", dia: passado1, hora: "14:00", status: "nao_compareceu" },
    { id: "ag-c003", consumidorNome: "Beatriz Nogueira", consumidorWhatsapp: "(11) 97123-9003", profissionalId: "prof-mariana-alves", servicoId: "serv-avaliacao-inicial", dia: hoje, hora: "09:00", status: "confirmado" },
    { id: "ag-c004", consumidorNome: "Helena Duarte", consumidorWhatsapp: "(11) 97123-9001", profissionalId: "prof-mariana-alves", servicoId: "serv-clareamento", dia: hoje, hora: "10:30", status: "pendente" },
    { id: "ag-c005", consumidorNome: "Otávio Ramos", consumidorWhatsapp: "(11) 97123-9002", profissionalId: "prof-lucas-ferreira", servicoId: "serv-limpeza", dia: futuro1, hora: "08:30", status: "confirmado" },
    { id: "ag-c006", consumidorNome: "Beatriz Nogueira", consumidorWhatsapp: "(11) 97123-9003", profissionalId: "prof-mariana-alves", servicoId: "serv-limpeza", dia: futuro2, hora: "11:00", status: "pendente" },
    { id: "ag-c007", consumidorNome: "Helena Duarte", consumidorWhatsapp: "(11) 97123-9001", profissionalId: "prof-lucas-ferreira", servicoId: "serv-avaliacao-inicial", dia: futuro3, hora: "15:00", status: "confirmado" },
  ];

  return construirAgendamentosEConsumidores(TENANT_CLINICA_SORRISO_LEVE, rascunhos, duracaoPorServico, precoPorServico);
}

function gerarAgendamentosEConsumidoresJR(servicos: Servico[]) {
  const doTenant = servicos.filter((s) => s.tenantId === TENANT_BARBEARIA_JR);
  const duracaoPorServico = new Map(doTenant.map((s) => [s.id, s.duracaoMinutos]));
  const precoPorServico = new Map(doTenant.map((s) => [s.id, s.precoCentavos]));

  const [passado1] = diasUteisPassados(1, DIAS_SEG_A_SAB);
  const [hoje, futuro1, futuro2] = proximosDiasUteis(0, 3, DIAS_SEG_A_SAB);

  // Mesmo whatsapp de "Rodrigo Lima" (Dom Navalha) aparece aqui de propósito —
  // prova que o isolamento é por tenant, não por telefone.
  const rascunhos: RascunhoAgendamento[] = [
    { id: "ag-jr001", consumidorNome: "Rodrigo Lima", consumidorWhatsapp: "(11) 98123-4503", profissionalId: "prof-jonas-ribeiro", servicoId: "serv-jr-combo", dia: passado1, hora: "14:00", status: "concluido" },
    { id: "ag-jr002", consumidorNome: "Vinícius Prado", consumidorWhatsapp: "(11) 96123-7701", profissionalId: "prof-kayky-souza", servicoId: "serv-jr-corte", dia: passado1, hora: "17:00", status: "concluido" },
    { id: "ag-jr003", consumidorNome: "Igor Batista", consumidorWhatsapp: "(11) 96123-7702", profissionalId: "prof-jonas-ribeiro", servicoId: "serv-jr-barba", dia: hoje, hora: "11:00", status: "confirmado" },
    { id: "ag-jr004", consumidorNome: "Vinícius Prado", consumidorWhatsapp: "(11) 96123-7701", profissionalId: "prof-kayky-souza", servicoId: "serv-jr-combo", dia: futuro1, hora: "15:00", status: "pendente" },
    { id: "ag-jr005", consumidorNome: "Igor Batista", consumidorWhatsapp: "(11) 96123-7702", profissionalId: "prof-jonas-ribeiro", servicoId: "serv-jr-corte", dia: futuro2, hora: "18:00", status: "confirmado" },
  ];

  return construirAgendamentosEConsumidores(TENANT_BARBEARIA_JR, rascunhos, duracaoPorServico, precoPorServico);
}

function gerarAgendamentosEConsumidoresBastiao(servicos: Servico[]) {
  const doTenant = servicos.filter((s) => s.tenantId === TENANT_BARBEIRO_BASTIAO);
  const duracaoPorServico = new Map(doTenant.map((s) => [s.id, s.duracaoMinutos]));
  const precoPorServico = new Map(doTenant.map((s) => [s.id, s.precoCentavos]));

  const [passado1] = diasUteisPassados(1, DIAS_TER_A_SAB);
  const [hoje, futuro1] = proximosDiasUteis(0, 2, DIAS_TER_A_SAB);

  const rascunhos: RascunhoAgendamento[] = [
    { id: "ag-bb001", consumidorNome: "Cláudio Peixoto", consumidorWhatsapp: "(11) 95123-3301", profissionalId: "prof-bastiao-nunes", servicoId: "serv-bast-corte", dia: passado1, hora: "10:00", status: "concluido" },
    { id: "ag-bb002", consumidorNome: "Cláudio Peixoto", consumidorWhatsapp: "(11) 95123-3301", profissionalId: "prof-bastiao-nunes", servicoId: "serv-bast-barba", dia: hoje, hora: "09:30", status: "confirmado" },
    { id: "ag-bb003", consumidorNome: "Emerson Diniz", consumidorWhatsapp: "(11) 95123-3302", profissionalId: "prof-bastiao-nunes", servicoId: "serv-bast-corte", dia: futuro1, hora: "14:00", status: "pendente" },
  ];

  return construirAgendamentosEConsumidores(TENANT_BARBEIRO_BASTIAO, rascunhos, duracaoPorServico, precoPorServico);
}

export function gerarAgendamentosEConsumidoresSeed(): { agendamentos: Agendamento[]; consumidores: Consumidor[] } {
  const servicos = gerarServicosSeed();
  const grupos = [
    gerarAgendamentosEConsumidoresDomNavalha(servicos),
    gerarAgendamentosEConsumidoresClinica(servicos),
    gerarAgendamentosEConsumidoresJR(servicos),
    gerarAgendamentosEConsumidoresBastiao(servicos),
  ];
  return {
    agendamentos: grupos.flatMap((g) => g.agendamentos),
    consumidores: grupos.flatMap((g) => g.consumidores),
  };
}

export function gerarBloqueiosSeed(): Bloqueio[] {
  const [, , futuro2Navalha, futuro3Navalha] = proximosDiasUteis(0, 5, DIAS_TER_A_SAB);
  const [, futuro1Clinica] = proximosDiasUteis(0, 4, DIAS_SEG_A_SEX);
  const bloqueios: Bloqueio[] = [];
  if (futuro2Navalha) {
    bloqueios.push({
      id: "bloq-001",
      tenantId: TENANT_DOM_NAVALHA,
      profissionalId: "prof-rafael-costa",
      inicio: horaISO(futuro2Navalha, "10:00"),
      fim: horaISO(futuro2Navalha, "13:00"),
      motivo: "Curso de aperfeiçoamento",
    });
  }
  if (futuro3Navalha) {
    bloqueios.push({
      id: "bloq-002",
      tenantId: TENANT_DOM_NAVALHA,
      profissionalId: "prof-pedro-martins",
      inicio: horaISO(futuro3Navalha, "09:00"),
      fim: horaISO(futuro3Navalha, "10:30"),
      motivo: "Consulta médica",
    });
  }
  if (futuro1Clinica) {
    bloqueios.push({
      id: "bloq-c001",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      profissionalId: "prof-mariana-alves",
      inicio: horaISO(futuro1Clinica, "13:00"),
      fim: horaISO(futuro1Clinica, "14:00"),
      motivo: "Congresso odontológico",
    });
  }
  return bloqueios;
}
