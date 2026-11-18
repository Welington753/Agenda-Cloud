// Rascunho da conferência guardado no navegador (`sessionStorage`), isolado
// por usuário e estabelecimento. Só conveniência da tela: o servidor é quem
// decide, e uma contagem desatualizada é recusada lá.
//
// Invalidação:
// - ao abrir a tela num contexto (usuário + estabelecimento), os rascunhos de
//   QUALQUER outro contexto são apagados;
// - no logout, todos são apagados (lib/auth/real-auth-context.tsx);
// - sem permissão de operar, sem o adicional ou com acesso recusado pela API,
//   o do contexto é apagado;
// - depois de confirmar, o do contexto é apagado.
// Toda leitura e escrita aceita falhar (janela privada, armazenamento
// bloqueado): a tela continua funcionando sem rascunho.
import type { Rascunho } from "./conferencia";

export const PREFIXO_DO_RASCUNHO = "timvix:estoque:conferencia:v1:";

export interface Armazenamento {
  readonly length: number;
  key(indice: number): string | null;
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

export function chaveDoRascunho(userId: string, tenantId: string): string {
  return `${PREFIXO_DO_RASCUNHO}${userId}:${tenantId}`;
}

/** `sessionStorage` quando existe e responde; senão, `null`. */
export function armazenamentoDaSessao(): Armazenamento | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function ehRascunho(valor: unknown, userId: string, tenantId: string): valor is Rascunho {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return v.versao === 1 && v.userId === userId && v.tenantId === tenantId && typeof v.iniciadoEm === "string" && Array.isArray(v.itens);
}

export function lerRascunho(armazenamento: Armazenamento | null, userId: string, tenantId: string): Rascunho | null {
  if (!armazenamento) return null;
  try {
    const bruto = armazenamento.getItem(chaveDoRascunho(userId, tenantId));
    if (!bruto) return null;
    const valor = JSON.parse(bruto) as unknown;
    if (ehRascunho(valor, userId, tenantId)) return valor;
    armazenamento.removeItem(chaveDoRascunho(userId, tenantId));
  } catch {
    // rascunho ilegível: tratado como ausente
  }
  return null;
}

export function gravarRascunho(armazenamento: Armazenamento | null, rascunho: Rascunho): void {
  if (!armazenamento) return;
  try {
    armazenamento.setItem(chaveDoRascunho(rascunho.userId, rascunho.tenantId), JSON.stringify(rascunho));
  } catch {
    // sem espaço ou bloqueado: segue sem rascunho
  }
}

export function apagarRascunho(armazenamento: Armazenamento | null, userId: string, tenantId: string): void {
  if (!armazenamento) return;
  try {
    armazenamento.removeItem(chaveDoRascunho(userId, tenantId));
  } catch {
    // nada a fazer
  }
}

function chavesDeRascunho(armazenamento: Armazenamento): string[] {
  const chaves: string[] = [];
  for (let i = 0; i < armazenamento.length; i += 1) {
    const chave = armazenamento.key(i);
    if (chave?.startsWith(PREFIXO_DO_RASCUNHO)) chaves.push(chave);
  }
  return chaves;
}

/** Apaga os rascunhos de qualquer outro usuário ou estabelecimento. */
export function apagarOutrosContextos(armazenamento: Armazenamento | null, userId: string, tenantId: string): void {
  if (!armazenamento) return;
  try {
    const manter = chaveDoRascunho(userId, tenantId);
    for (const chave of chavesDeRascunho(armazenamento)) if (chave !== manter) armazenamento.removeItem(chave);
  } catch {
    // nada a fazer
  }
}

/** Logout: nenhum rascunho fica para a próxima pessoa no aparelho. */
export function apagarTodosOsRascunhos(armazenamento: Armazenamento | null = armazenamentoDaSessao()): void {
  if (!armazenamento) return;
  try {
    for (const chave of chavesDeRascunho(armazenamento)) armazenamento.removeItem(chave);
  } catch {
    // nada a fazer
  }
}
