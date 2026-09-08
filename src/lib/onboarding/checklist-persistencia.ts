// Estado de exibição do checklist de primeiros passos, por tenant. Só é
// ativado explicitamente por `criarEstabelecimentoDemonstracao` — um
// estabelecimento criado fora do onboarding (seed ou master) nunca mostra o
// checklist, porque o valor padrão de `readValue` é "já dispensado".

import { readValue, writeValue } from "@/lib/storage/local-storage";

function chave(tenantId: string): string {
  return `onboarding-checklist:${tenantId}`;
}

export function ativarChecklistPrimeirosPassos(tenantId: string): void {
  writeValue(chave(tenantId), { dispensado: false });
}

export function checklistPrimeirosPassosVisivel(tenantId: string): boolean {
  return !readValue(chave(tenantId), { dispensado: true }).dispensado;
}

export function dispensarChecklistPrimeirosPassos(tenantId: string): void {
  writeValue(chave(tenantId), { dispensado: true });
}
