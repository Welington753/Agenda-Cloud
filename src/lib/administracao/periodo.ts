// Período dos relatórios do portal (docs/plans/portal-relatorios-por-periodo.md).
// Regras puras de tela: ler a URL, montar consulta e textos. O servidor é a
// fonte do período aplicado (relatório sem datas = mês atual em São Paulo
// pelo relógio DELE); a tela só afirma o que ele devolveu.
//
// Mesmas regras de validação do servidor (backend/src/platform/
// portal-reports.ts): datas reais, as duas juntas, início <= fim, no máximo
// 366 dias contando os dois extremos. Uma URL inválida nunca vira consulta.

/** Período máximo, contando os dois dias extremos (igual ao servidor). */
export const MAX_DIAS_PERIODO = 366;

export interface Intervalo {
  de: string;
  ate: string;
}

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MES = /^(\d{4})-(\d{2})$/;

export function ehDataDeCalendario(valor: string): boolean {
  const m = DATA.exec(valor);
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 1900 || me < 1 || me > 12 || d < 1) return false;
  const data = new Date(Date.UTC(a, me - 1, d));
  return data.getUTCFullYear() === a && data.getUTCMonth() === me - 1 && data.getUTCDate() === d;
}

export function ehMes(valor: string): boolean {
  const m = MES.exec(valor);
  return !!m && Number(m[1]) >= 1900 && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

const utc = (valor: string) => {
  const [a, m, d] = valor.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
};

/** Dias de `de` a `ate`, contando os dois. */
export function diasInclusivos(de: string, ate: string): number {
  return Math.round((utc(ate) - utc(de)) / 86_400_000) + 1;
}

/** Mensagem do problema, ou `null` se o período é válido. */
export function problemaDoPeriodo(de: string, ate: string): string | null {
  if (!de || !ate) return "Informe a data inicial e a data final.";
  if (!ehDataDeCalendario(de) || !ehDataDeCalendario(ate)) return "Data inválida.";
  if (de > ate) return "A data inicial deve ser anterior ou igual à final.";
  if (diasInclusivos(de, ate) > MAX_DIAS_PERIODO)
    return `O período pode ter no máximo ${MAX_DIAS_PERIODO} dias, contando o primeiro e o último.`;
  return null;
}

/** `"2026-10"` -> do dia 1 ao último dia. */
export function intervaloDoMes(mes: string): Intervalo {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** Mês vizinho: `deslocamento` -1 (anterior) ou +1 (seguinte). */
export function mesVizinho(mes: string, deslocamento: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + deslocamento, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Período pedido pela URL, com os nomes de parâmetro de cada tela:
 * - `mes` (só no relatório): um mês inteiro;
 * - `de` + `ate`: período personalizado.
 * `null`: nenhum período (ou um inválido, ignorado; `invalido` diz se havia
 * algo na URL que foi descartado).
 */
export function lerPeriodoDaUrl(
  params: URLSearchParams,
  nomes: { de: string; ate: string; mes?: string } = { de: "de", ate: "ate", mes: "mes" },
): { intervalo: Intervalo | null; invalido: boolean } {
  const de = params.get(nomes.de);
  const ate = params.get(nomes.ate);
  const mes = nomes.mes ? params.get(nomes.mes) : null;
  if (de !== null || ate !== null) {
    const ok = de !== null && ate !== null && problemaDoPeriodo(de, ate) === null;
    return ok ? { intervalo: { de, ate }, invalido: false } : { intervalo: null, invalido: true };
  }
  if (mes !== null) return ehMes(mes) ? { intervalo: intervaloDoMes(mes), invalido: false } : { intervalo: null, invalido: true };
  return { intervalo: null, invalido: false };
}

/** `YYYY-MM` quando o intervalo é exatamente um mês inteiro. */
export function mesDoIntervalo(intervalo: Intervalo): string | null {
  const mes = intervalo.de.slice(0, 7);
  if (!ehMes(mes)) return null;
  const inteiro = intervaloDoMes(mes);
  return inteiro.de === intervalo.de && inteiro.ate === intervalo.ate ? mes : null;
}

/** `"2026-10-05"` -> `"05/10/2026"`. */
export function diaCurto(valor: string): string {
  const [a, m, d] = valor.split("-");
  return `${d}/${m}/${a}`;
}

/** `"outubro de 2026"` ou `"01/10/2026 a 15/10/2026"`. */
export function textoDoPeriodo(intervalo: Intervalo): string {
  const mes = mesDoIntervalo(intervalo);
  if (mes) {
    const [a, m] = mes.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(a, m - 1, 1)),
    );
  }
  return intervalo.de === intervalo.ate ? diaCurto(intervalo.de) : `${diaCurto(intervalo.de)} a ${diaCurto(intervalo.ate)}`;
}

/**
 * Período que a tela pode afirmar: o devolvido pelo servidor, se bate com o
 * pedido; sem pedido (padrão do servidor), o devolvido. Divergência: `null`.
 */
export function periodoConfirmado(pedido: Intervalo | null, recebido: { from: string; to: string }): Intervalo | null {
  if (!ehDataDeCalendario(recebido.from) || !ehDataDeCalendario(recebido.to)) return null;
  if (pedido && (pedido.de !== recebido.from || pedido.ate !== recebido.to)) return null;
  return { de: recebido.from, ate: recebido.to };
}

/** Parâmetros da URL do relatório: `mes` para mês inteiro, senão `de`/`ate`.
 * Sem intervalo (padrão do servidor), nada. */
export function parametrosDoPeriodo(intervalo: Intervalo | null): Record<string, string> {
  if (!intervalo) return {};
  const mes = mesDoIntervalo(intervalo);
  return mes ? { mes } : { de: intervalo.de, ate: intervalo.ate };
}
