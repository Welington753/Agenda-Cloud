// Estado do segundo fator de UMA sessão, calculado no servidor a partir do
// papel de plataforma, do fator ativo, da marca de cadastro obrigatório, da
// fase (`PLATFORM_2FA_ENFORCEMENT`) e das colunas da sessão. Função pura: o
// guard, a rota de estado e a troca de senha usam a mesma regra.
//
// | estado                  | quando                                              | portal |
// |-------------------------|-----------------------------------------------------|--------|
// | NOT_REQUIRED            | conta sem papel de plataforma                       | (o serviço recusa pelo papel) |
// | ENROLLMENT_OPTIONAL     | papel, sem fator, fase optional, conta não marcada  | sim, como antes |
// | ENROLLMENT_REQUIRED     | papel, sem fator, fase required ou conta marcada    | não |
// | VERIFICATION_REQUIRED   | fator ativo, sessão sem verificação válida          | não |
// | VERIFIED                | fator ativo e código aceito nesta sessão há < 12 h  | sim |
//
// Uma conta com fator ativo NUNCA cai em ENROLLMENT_*: recuperação e troca de
// autenticador só substituem o fator depois de um código novo confirmado, e o
// fator antigo vale até lá. Nenhuma fase libera uma conta com fator só pela
// senha.
import type { SecondFactorEnforcement } from './second-factor-config.js';

export const SECOND_FACTOR_VALIDITY_MS = 12 * 60 * 60 * 1000;
/** Ações que alteram a segurança (liberação para outra conta) pedem o
 * segundo fator confirmado há pouco nesta sessão, como a senha. */
export const RECENT_SECOND_FACTOR_MS = 10 * 60 * 1000;
export const ENROLLMENT_TTL_MS = 15 * 60 * 1000;
export const ENROLLMENT_PERMISSION_MS = 30 * 60 * 1000;
export const GRANT_TTL_MS = 60 * 60 * 1000;

export type SecondFactorState =
  | 'NOT_REQUIRED'
  | 'ENROLLMENT_OPTIONAL'
  | 'ENROLLMENT_REQUIRED'
  | 'VERIFICATION_REQUIRED'
  | 'VERIFIED';

export interface SecondFactorFacts {
  hasPlatformRole: boolean;
  factorActive: boolean;
  enrollmentRequired: boolean;
  enforcement: SecondFactorEnforcement;
  verifiedAt: Date | null;
  sessionExpiresAt: Date;
  enrollmentAllowedUntil: Date | null;
  /** Liberação emitida e ainda não usada nem vencida. */
  grantPending: boolean;
  now: Date;
}

export interface SecondFactorStatus {
  state: SecondFactorState;
  /** O guard do portal deixa passar. */
  portalAllowed: boolean;
  /** Esta sessão pode cadastrar um fator sem outro código (convite de
   * plataforma aceito ou liberação usada nela, dentro do prazo). */
  enrollmentPermitted: boolean;
  /** Recuperação em andamento: liberação pendente, ou já usada nesta sessão
   * com o fator antigo ainda ativo. */
  recoveryPending: boolean;
  verifiedUntil: Date | null;
}

export function verificationValid(verifiedAt: Date | null, sessionExpiresAt: Date, now: Date): boolean {
  if (!verifiedAt) return false;
  const idade = now.getTime() - verifiedAt.getTime();
  return idade >= 0 && idade < SECOND_FACTOR_VALIDITY_MS && now < sessionExpiresAt;
}

export function recentlyVerified(verifiedAt: Date | null, now: Date): boolean {
  if (!verifiedAt) return false;
  const idade = now.getTime() - verifiedAt.getTime();
  return idade >= 0 && idade <= RECENT_SECOND_FACTOR_MS;
}

export function secondFactorStatus(f: SecondFactorFacts): SecondFactorStatus {
  const enrollmentPermitted = f.hasPlatformRole && !!f.enrollmentAllowedUntil && f.now < f.enrollmentAllowedUntil;
  if (!f.hasPlatformRole) {
    return { state: 'NOT_REQUIRED', portalAllowed: true, enrollmentPermitted: false, recoveryPending: false, verifiedUntil: null };
  }
  if (f.factorActive) {
    const valid = verificationValid(f.verifiedAt, f.sessionExpiresAt, f.now);
    const until = valid
      ? new Date(Math.min(f.verifiedAt!.getTime() + SECOND_FACTOR_VALIDITY_MS, f.sessionExpiresAt.getTime()))
      : null;
    return {
      state: valid ? 'VERIFIED' : 'VERIFICATION_REQUIRED',
      portalAllowed: valid,
      enrollmentPermitted,
      recoveryPending: f.grantPending || enrollmentPermitted,
      verifiedUntil: until,
    };
  }
  const obrigatorio = f.enforcement === 'required' || f.enrollmentRequired;
  return {
    state: obrigatorio ? 'ENROLLMENT_REQUIRED' : 'ENROLLMENT_OPTIONAL',
    portalAllowed: !obrigatorio,
    enrollmentPermitted,
    recoveryPending: false,
    verifiedUntil: null,
  };
}

// ------------------------------------------------------------ tentativas

export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

export interface AttemptRow {
  failedCount: number;
  windowStartedAt: Date | null;
  lockedUntil: Date | null;
}

/** Trava ativa: as tentativas de segundo fator são recusadas SEM contar,
 * então insistir durante a trava não a prolonga. O login e `/conta` não
 * passam por aqui. */
export function lockedUntil(row: AttemptRow | null, now: Date): Date | null {
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}

/** Próximo estado depois de uma falha (fora da trava). Cinco falhas dentro de
 * 15 minutos travam por 15 minutos e zeram a contagem. */
export function afterFailure(row: AttemptRow | null, now: Date): AttemptRow & { lockedNow: boolean } {
  const janelaValida =
    row?.windowStartedAt && now.getTime() - row.windowStartedAt.getTime() < ATTEMPT_WINDOW_MS && row.windowStartedAt <= now;
  const count = (janelaValida ? row!.failedCount : 0) + 1;
  const inicio = janelaValida ? row!.windowStartedAt : now;
  if (count >= MAX_FAILED_ATTEMPTS) {
    return { failedCount: 0, windowStartedAt: null, lockedUntil: new Date(now.getTime() + LOCK_MS), lockedNow: true };
  }
  return { failedCount: count, windowStartedAt: inicio, lockedUntil: null, lockedNow: false };
}
