// Parte pura da configuração do segundo fator (sem Nest): lida também pela
// validação do ambiente (config/env.validation.ts). Ver second-factor-config.ts.

export const SECOND_FACTOR_ENFORCEMENTS = ['optional', 'required'] as const;
export type SecondFactorEnforcement = (typeof SECOND_FACTOR_ENFORCEMENTS)[number];

export const TOTP_KEY_BYTES = 32;

export interface TotpKeyring {
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

/** `null`: as duas variáveis ausentes. `'INVALID'`: alguma presente e
 * inválida (formato, tamanho, versão repetida ou atual fora da lista). Nunca
 * devolve o valor recebido numa mensagem. */
export function parseTotpKeyring(rawKeys: string | undefined, rawCurrent: string | undefined): TotpKeyring | null | 'INVALID' {
  if (rawKeys === undefined && rawCurrent === undefined) return null;
  if (rawKeys === undefined || rawCurrent === undefined) return 'INVALID';
  if (!/^[1-9]\d{0,3}$/.test(rawCurrent.trim())) return 'INVALID';
  const keys = new Map<number, Buffer>();
  for (const parte of rawKeys.split(',')) {
    const m = /^\s*([1-9]\d{0,3}):([A-Za-z0-9+/]+={0,2})\s*$/.exec(parte);
    if (!m) return 'INVALID';
    const versao = Number(m[1]);
    const chave = Buffer.from(m[2], 'base64');
    if (chave.length !== TOTP_KEY_BYTES || keys.has(versao)) return 'INVALID';
    keys.set(versao, chave);
  }
  const current = Number(rawCurrent.trim());
  if (!keys.has(current)) return 'INVALID';
  return { current, keys };
}
