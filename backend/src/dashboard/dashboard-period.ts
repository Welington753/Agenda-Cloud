// Regras puras de período do Início: sem banco e sem relógio implícito.

export interface PeriodoLocal {
  from: string;
  to: string;
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Mês corrente de uma data local `YYYY-MM-DD`: do dia 1 ao último dia. */
export function mesDaData(data: string): PeriodoLocal {
  const [ano, mes] = data.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    from: `${ano}-${doisDigitos(mes)}-01`,
    to: `${ano}-${doisDigitos(mes)}-${doisDigitos(ultimoDia)}`,
  };
}

/** Situações de atendimento na ordem em que a tela mostra. */
export const SITUACOES = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELED'] as const;
export type Situacao = (typeof SITUACOES)[number];

/** Contagem por situação com todas as chaves presentes (zero quando não
 * houve nenhum): a tela nunca precisa adivinhar se uma chave faltando é zero. */
export function contagemPorSituacao(linhas: readonly { status: string; total: number }[]): Record<Situacao, number> {
  const contagem = Object.fromEntries(SITUACOES.map((s) => [s, 0])) as Record<Situacao, number>;
  for (const linha of linhas) {
    if ((SITUACOES as readonly string[]).includes(linha.status)) {
      contagem[linha.status as Situacao] += Number(linha.total);
    }
  }
  return contagem;
}
