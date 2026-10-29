// Nomes comerciais dos planos sobre os códigos estáveis do catálogo. Único
// lugar do backend que liga nome a código (a migration CommercialAccess
// grava estes nomes; o teste confere que os dois concordam).
//
// ARMADILHA: o plano de nome **Pro** tem código `equipe`, e o código `pro` é
// o plano **Max**. Nenhum código decide privilégio pelo nome nem pelo
// código do plano: o que um estabelecimento pode usar vem de
// `plan_features` + `tenant_feature_overrides` (commercial-gate.ts), e a
// administração da plataforma só de `users.platform_role`.
export const COMMERCIAL_PLANS = [
  { code: 'essencial', id: 'plan_essencial', name: 'Básico' },
  { code: 'equipe', id: 'plan_equipe', name: 'Pro' },
  { code: 'pro', id: 'plan_pro', name: 'Max' },
] as const;

export type CommercialPlanCode = (typeof COMMERCIAL_PLANS)[number]['code'];

/** Nome comercial de um código do catálogo; `null` para um plano fora dos
 * três conhecidos (mostrar o nome gravado em `plans.name`). */
export function commercialPlanName(code: string): string | null {
  return COMMERCIAL_PLANS.find((p) => p.code === code)?.name ?? null;
}
