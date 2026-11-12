// TOTP pelo pacote `otpauth` (versão fixada em package.json; o algoritmo não é
// implementado aqui). Parâmetros compatíveis com os aplicativos comuns
// (Google Authenticator, Microsoft Authenticator, Authy, 1Password): SHA1, 6
// dígitos, 30 segundos, segredo de 20 bytes.
//
// REUTILIZAÇÃO: a biblioteca só diz se o código vale na janela. Impedir que o
// MESMO código seja aceito duas vezes é responsabilidade da aplicação:
// `matchTotpCounter` devolve o contador do código aceito e quem chama só o
// aceita se for MAIOR que o último usado (`user_second_factors.
// last_used_counter`), lendo e gravando com a linha travada (`FOR UPDATE`).
// Não usamos a opção `afterCounter` da biblioteca: ela só existe a partir da
// 9.6.0, e a regra fica explícita aqui, testada contra o banco.
import * as OTPAuth from 'otpauth';

export const TOTP_ISSUER = 'Agenda Cloud';
export const TOTP_PERIOD_SECONDS = 30;
const PARAMETROS = { algorithm: 'SHA1', digits: 6, period: TOTP_PERIOD_SECONDS } as const;
/** Um período antes e um depois do atual (relógio do celular adiantado ou
 * atrasado), como a documentação da biblioteca recomenda. */
export const TOTP_WINDOW = 1;

export function newTotpSecret(): Buffer {
  return Buffer.from(new OTPAuth.Secret({ size: 20 }).bytes);
}

function totp(secret: Buffer, label = 'conta'): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    ...PARAMETROS,
    issuer: TOTP_ISSUER,
    label,
    secret: OTPAuth.Secret.fromHex(secret.toString('hex')),
  });
}

/** Só os 6 dígitos (espaços e hífens de quem colou são ignorados). */
export function normalizeTotpCode(code: string): string | null {
  const limpo = code.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(limpo) ? limpo : null;
}

/** Contador do código aceito na janela, ou `null`. Não decide reutilização. */
export function matchTotpCounter(secret: Buffer, code: string, nowMs: number): number | null {
  const normalizado = normalizeTotpCode(code);
  if (!normalizado) return null;
  const t = totp(secret);
  const delta = t.validate({ token: normalizado, timestamp: nowMs, window: TOTP_WINDOW });
  if (delta === null) return null;
  return OTPAuth.TOTP.counter({ period: TOTP_PERIOD_SECONDS, timestamp: nowMs }) + delta;
}

/** Só para testes com dados fictícios: o código de um instante. */
export function totpCodeAt(secret: Buffer, nowMs: number): string {
  return totp(secret).generate({ timestamp: nowMs });
}

export function otpauthUri(secret: Buffer, label: string): string {
  return totp(secret, label).toString();
}

/** Chave para digitar à mão: base32 em grupos de 4. */
export function manualKey(secret: Buffer): string {
  return (OTPAuth.Secret.fromHex(secret.toString('hex')).base32.match(/.{1,4}/g) ?? []).join(' ');
}
