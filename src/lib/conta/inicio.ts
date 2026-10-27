// Regras puras do Início (dashboard do dono) — sem React, sem fetch e sem
// relógio implícito. Os números vêm prontos do servidor
// (GET /tenants/:id/dashboard); aqui só o período escolhido e os textos.

export type EscolhaDePeriodo = "hoje" | "mes" | "personalizado";

export interface PeriodoLocal {
  from: string;
  to: string;
}

/** Mesmo teto do servidor (`MAIOR_PERIODO_DO_PAINEL_EM_DIAS`). */
export const MAIOR_PERIODO_EM_DIAS = 366;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function diaUtc(data: string): number {
  const [ano, mes, dia] = data.split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia) / 86_400_000;
}

function dataExiste(data: string): boolean {
  if (!DATA.test(data)) return false;
  const [ano, mes, dia] = data.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Mês da data local `YYYY-MM-DD`: do dia 1 ao último dia. */
export function mesDe(data: string): PeriodoLocal {
  const [ano, mes] = data.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  return { from: `${ano}-${mm}-01`, to: `${ano}-${mm}-${String(ultimo).padStart(2, "0")}` };
}

/** Período de cada escolha, a partir do "hoje" do ESTABELECIMENTO (vindo do
 * servidor). `null` para um período personalizado inválido. */
export function periodoDaEscolha(
  escolha: EscolhaDePeriodo,
  hoje: string,
  personalizado: PeriodoLocal,
): PeriodoLocal | null {
  if (escolha === "hoje") return { from: hoje, to: hoje };
  if (escolha === "mes") return mesDe(hoje);
  return erroDoPeriodo(personalizado) ? null : personalizado;
}

/** Por que um período personalizado não serve (`null`: serve). */
export function erroDoPeriodo(periodo: PeriodoLocal): string | null {
  if (!dataExiste(periodo.from) || !dataExiste(periodo.to)) return "Informe as duas datas.";
  const dias = diaUtc(periodo.to) - diaUtc(periodo.from) + 1;
  if (dias < 1) return "A data final vem antes da inicial.";
  if (dias > MAIOR_PERIODO_EM_DIAS) return `Escolha no máximo ${MAIOR_PERIODO_EM_DIAS} dias.`;
  return null;
}

/** "15/08/2031" a partir de "2031-08-15", sem relógio nem fuso do navegador. */
export function dataCurta(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Texto do período para dizer, em cada indicador, de quando ele é. */
export function rotuloDoPeriodo(periodo: PeriodoLocal): string {
  if (periodo.from === periodo.to) return dataCurta(periodo.from);
  return `${dataCurta(periodo.from)} a ${dataCurta(periodo.to)}`;
}

/** "1 cliente", "3 clientes": contagem de PESSOAS. */
export function clientes(n: number): string {
  return n === 1 ? "1 cliente" : `${n} clientes`;
}

/** "1 atendimento", "3 atendimentos": contagem de ATENDIMENTOS. */
export function atendimentos(n: number): string {
  return n === 1 ? "1 atendimento" : `${n} atendimentos`;
}
