// Normaliza telefone para E.164 assumindo Brasil (+55) quando o código do
// país não vem explícito — formatação comum de usuário final (DDD com
// parênteses, hífen), nunca persistida como veio no formulário.
const DIGITS_ONLY = /\D/g;

export function normalizePhone(rawPhone: string): string {
  const digits = rawPhone.replace(DIGITS_ONLY, '');

  if (digits.length < 10 || digits.length > 13) {
    throw new Error('Telefone inválido.');
  }

  const alreadyHasCountryCode =
    rawPhone.trim().startsWith('+55') || (digits.startsWith('55') && digits.length > 11);
  if (alreadyHasCountryCode) {
    return `+${digits}`;
  }

  return `+55${digits}`;
}
