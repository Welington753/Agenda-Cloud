// `users.updated_at` é a versão que as telas da administração comparam para
// perceber que outra tela mudou a conta. Toda escrita na conta faz a versão
// AVANÇAR, mesmo quando duas escritas caem no mesmo milissegundo; sem isso,
// uma mudança poderia manter o mesmo valor e passar despercebida.
export function avancarVersao(parametroAgora: string): string {
  return `updated_at = GREATEST(${parametroAgora}::timestamptz, updated_at + interval '1 millisecond')`;
}
