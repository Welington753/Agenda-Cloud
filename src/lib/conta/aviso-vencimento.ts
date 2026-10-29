// Aviso, dentro do aplicativo, de que o acesso do estabelecimento está perto
// de vencer. Só para o DONO (é quem regulariza; os outros papéis nem recebem
// a validade na sessão). Nada de e-mail, WhatsApp ou push.
//
// Usa a validade EFETIVA (`validUntil`): o fim da validade contínua, com as
// renovações já registradas. Um teste que acaba amanhã, seguido de um
// período pago já registrado, não gera aviso.
import type { ValidadeDoAcessoReal } from "@/lib/api/auth-api";

const DIA_MS = 24 * 60 * 60 * 1000;

export type FaixaDeAviso = 7 | 3 | 1;

export interface AvisoDeVencimento {
  faixa: FaixaDeAviso;
  /** Instante do fim (exclusivo) da validade. */
  validUntil: string;
  /** O que está valendo agora. */
  tipo: "TRIAL" | "PAID" | "COURTESY";
}

/** `null` quando não há o que avisar: sem validade em curso, bloqueado,
 * anterior ao controle, ou mais de 7 dias até o fim. */
export function avisoDeVencimento(
  acesso: ValidadeDoAcessoReal | undefined,
  agora: Date,
): AvisoDeVencimento | null {
  if (!acesso || acesso.blocked || !acesso.validUntil) return null;
  if (acesso.state !== "TRIAL" && acesso.state !== "PAID" && acesso.state !== "COURTESY") return null;
  const restante = Date.parse(acesso.validUntil) - agora.getTime();
  if (!Number.isFinite(restante) || restante <= 0) return null;
  const faixa: FaixaDeAviso | null = restante <= DIA_MS ? 1 : restante <= 3 * DIA_MS ? 3 : restante <= 7 * DIA_MS ? 7 : null;
  return faixa ? { faixa, validUntil: acesso.validUntil, tipo: acesso.state } : null;
}
