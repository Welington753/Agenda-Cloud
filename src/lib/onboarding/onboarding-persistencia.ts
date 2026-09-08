// Persistência do progresso do onboarding — chave própria, exclusiva desta
// demonstração, separada das coleções de dados reais (`STORAGE_KEYS`). Usa o
// mesmo wrapper (`readValue`/`writeValue`) e por isso herda o namespace
// versionado de `local-storage.ts`, sem precisar de uma versão própria.

import { readValue, writeValue } from "@/lib/storage/local-storage";
import { RESPOSTAS_ONBOARDING_INICIAIS, type RespostasOnboarding } from "./onboarding";

const CHAVE_ONBOARDING = "onboarding-demo";

export interface EstadoOnboarding {
  etapaAtual: number;
  respostas: RespostasOnboarding;
  /** Preenchido só depois que a demonstração cria o estabelecimento de verdade
   * (etapa Revisão → Painel). */
  tenantIdCriado: string | null;
  slugCriado: string | null;
}

export const ESTADO_ONBOARDING_INICIAL: EstadoOnboarding = {
  etapaAtual: 0,
  respostas: RESPOSTAS_ONBOARDING_INICIAIS,
  tenantIdCriado: null,
  slugCriado: null,
};

export function lerEstadoOnboarding(): EstadoOnboarding {
  return readValue(CHAVE_ONBOARDING, ESTADO_ONBOARDING_INICIAL);
}

export function salvarEstadoOnboarding(estado: EstadoOnboarding): void {
  writeValue(CHAVE_ONBOARDING, estado);
}

/** "Reiniciar a demonstração" — limpa só o progresso do onboarding. Não apaga o
 * estabelecimento já criado (se houver): é uma decisão consciente, não um bug —
 * a pessoa pode ter entrado no painel e quer só refazer o assistente. */
export function reiniciarOnboarding(): EstadoOnboarding {
  salvarEstadoOnboarding(ESTADO_ONBOARDING_INICIAL);
  return ESTADO_ONBOARDING_INICIAL;
}
