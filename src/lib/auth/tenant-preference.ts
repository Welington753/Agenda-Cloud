// Preferência de estabelecimento ativo para contas REAIS — só uma
// conveniência de navegador, NUNCA uma autorização (ver
// real-session-state.ts, `resolverContextoAtivo`, que sempre revalida contra
// a lista `contexts` vinda do backend antes de usar este valor). Namespace
// próprio, deliberadamente fora de `agenda-barber:v3:` (src/lib/storage/local-storage.ts)
// — aquele namespace é só da simulação; misturar os dois tornaria impossível
// saber, ao ler uma chave, se ela pertence a uma conta demo ou a uma conta
// real.
const CHAVE_PREFERENCIA_TENANT = "agenda-cloud:real-auth:tenant-ativo";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function lerPreferenciaTenant(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(CHAVE_PREFERENCIA_TENANT);
  } catch {
    return null;
  }
}

export function salvarPreferenciaTenant(tenantId: string | null): void {
  if (!isBrowser()) return;
  try {
    if (tenantId === null) {
      window.localStorage.removeItem(CHAVE_PREFERENCIA_TENANT);
    } else {
      window.localStorage.setItem(CHAVE_PREFERENCIA_TENANT, tenantId);
    }
  } catch {
    // localStorage indisponível (modo privado, quota, etc.) — a seleção de
    // tenant simplesmente não sobrevive a um reload; nunca deve quebrar o
    // fluxo de login por causa disso.
  }
}
