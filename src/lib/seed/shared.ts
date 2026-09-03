// Constantes e helpers de data/hora compartilhados entre os geradores de seed.
// Nada aqui é exportado por src/lib/seed-data.ts — é infraestrutura interna
// dos módulos em src/lib/seed/.

import { addDays, getDay, setHours, setMinutes, startOfDay } from "date-fns";
import type { DiaSemana, HistoricoAlteracao, RegrasAgendamento, StatusAgendamento } from "../types";

export const TENANT_DOM_NAVALHA = "tenant-dom-navalha";
export const TENANT_CORTE_CERTO = "tenant-corte-certo";
export const TENANT_BARBEARIA_VINTAGE = "tenant-barbearia-vintage";
export const TENANT_CLINICA_SORRISO_LEVE = "tenant-clinica-sorriso-leve";
export const TENANT_BARBEARIA_JR = "tenant-barbearia-jr";
export const TENANT_BARBEIRO_BASTIAO = "tenant-barbeiro-bastiao";

export const DIAS_TER_A_SAB: DiaSemana[] = [2, 3, 4, 5, 6];
export const DIAS_SEG_A_SEX: DiaSemana[] = [1, 2, 3, 4, 5];
export const DIAS_SEG_A_SAB: DiaSemana[] = [1, 2, 3, 4, 5, 6];

export function horaISO(dia: Date, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return setMinutes(setHours(startOfDay(dia), h), m).toISOString();
}

export function somarMinutosISO(iso: string, minutos: number): string {
  return new Date(new Date(iso).getTime() + minutos * 60_000).toISOString();
}

/** Encontra os próximos `quantidade` dias (a partir de `offset` dias de hoje) em que o
 * estabelecimento funciona, andando para frente no calendário. */
export function proximosDiasUteis(offsetInicial: number, quantidade: number, diasFuncionamento: DiaSemana[]): Date[] {
  const dias: Date[] = [];
  let cursor = offsetInicial;
  while (dias.length < quantidade && cursor < offsetInicial + 60) {
    const candidato = addDays(startOfDay(new Date()), cursor);
    if (diasFuncionamento.includes(getDay(candidato) as DiaSemana)) {
      dias.push(candidato);
    }
    cursor += 1;
  }
  return dias;
}

/** Anda para trás no calendário buscando dias em que o estabelecimento funcionou. */
export function diasUteisPassados(quantidade: number, diasFuncionamento: DiaSemana[]): Date[] {
  const dias: Date[] = [];
  let cursor = -1;
  while (dias.length < quantidade && cursor > -60) {
    const candidato = addDays(startOfDay(new Date()), cursor);
    if (diasFuncionamento.includes(getDay(candidato) as DiaSemana)) {
      dias.push(candidato);
    }
    cursor -= 1;
  }
  return dias.reverse();
}

export function historico(status: StatusAgendamento, por: string, criadoEm: string): HistoricoAlteracao[] {
  return [{ em: criadoEm, de: "criado", para: status, por }];
}

export function regrasPadrao(overrides: Partial<RegrasAgendamento> = {}): RegrasAgendamento {
  return {
    antecedenciaMinimaMinutos: 60,
    limiteDiasFuturos: 30,
    prazoCancelamentoHoras: 3,
    confirmacaoAutomatica: false,
    permitirQualquerProfissional: true,
    permitirRemarcacaoCliente: true,
    exigirTelefoneCliente: true,
    exigirEmailCliente: false,
    exibirPrecoPublico: true,
    intervaloPadraoMinutos: 0,
    ...overrides,
  };
}
