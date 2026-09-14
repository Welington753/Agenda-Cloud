// Núcleo puro (sem React, sem `window`, 100% testável) da sessão REAL. Separado
// de `real-auth-context.tsx` (que só liga isto a efeitos: chamar a API,
// escutar montagem) de propósito — mesma disciplina de
// `src/lib/access/access-control.ts`: a regra vive numa função pura,
// nunca reimplementada por componente nenhum.
import type { ResultadoAutenticacaoReal, SessaoRealContexto, TenantContextReal } from "@/lib/api/auth-api";

export type EstadoAutenticacaoReal =
  | { status: "carregando" }
  | { status: "nao_autenticado" }
  | { status: "falha_comunicacao" }
  | { status: "autenticado"; sessao: SessaoRealContexto; tenantIdAtivo: string | null };

/**
 * Decide qual tenant fica "ativo" a partir da sessão vinda do backend + uma
 * preferência salva no navegador (nunca o contrário). Regras (ver AGENTS.md
 * Lote 6C.1, seção 5):
 * - zero contexts: não há o que ativar, sempre `null`.
 * - um contexto: o próprio backend já decidiu (`activeContext`) — a
 *   preferência salva é ignorada aqui, nunca diverge do servidor.
 * - vários contexts: só usa a preferência salva se ela corresponder a um
 *   `tenantId` presente em `contexts` NESTA resposta — uma preferência antiga
 *   apontando para um vínculo removido/suspenso desaparece silenciosamente,
 *   nunca é tratada como autorização.
 */
export function resolverTenantAtivo(sessao: SessaoRealContexto, preferenciaSalva: string | null): string | null {
  if (sessao.contexts.length === 0) return null;
  if (sessao.activeContext) return sessao.activeContext.tenantId;
  if (preferenciaSalva && sessao.contexts.some((c) => c.tenantId === preferenciaSalva)) {
    return preferenciaSalva;
  }
  return null;
}

export function encontrarContextoPorTenantId(
  sessao: SessaoRealContexto,
  tenantId: string,
): TenantContextReal | null {
  return sessao.contexts.find((c) => c.tenantId === tenantId) ?? null;
}

/** Transforma o resultado de `buscarSessaoAtual()`/`login()` no estado da UI.
 * `dados === null` (autenticação ausente, ver auth-api.ts) sempre vira
 * `nao_autenticado` — nunca `falha_comunicacao`, essa distinção é o ponto
 * central do requisito "uma falha de rede não é equivalente a 401". */
export function reduzirResultadoSessao(
  resultado: ResultadoAutenticacaoReal<SessaoRealContexto | null>,
  preferenciaSalva: string | null,
): EstadoAutenticacaoReal {
  if (!resultado.ok) {
    // `limite_tentativas`/`indisponivel` em /auth/me (fora do login) também
    // nunca devem liberar a demonstração automaticamente nem fingir logout —
    // tratados como a mesma falha de comunicação genérica para fins de UI.
    return { status: "falha_comunicacao" };
  }
  if (resultado.dados === null) {
    return { status: "nao_autenticado" };
  }
  return {
    status: "autenticado",
    sessao: resultado.dados,
    tenantIdAtivo: resolverTenantAtivo(resultado.dados, preferenciaSalva),
  };
}

/** Guarda contra resposta desatualizada (ver real-auth-context.tsx): cada
 * chamada assíncrona captura a `geracao` vigente no momento em que começou;
 * só pode aplicar seu resultado se nenhuma ação mais nova (logout, novo
 * login, novo refresh) aconteceu entre o início e o fim dela. Fecha
 * exatamente o caso "resposta antiga de /me restaura a sessão depois do
 * logout" pedido no lote. */
export function podeAplicarResultado(geracaoAtual: number, geracaoDaChamada: number): boolean {
  return geracaoAtual === geracaoDaChamada;
}

/** Seleção de estabelecimento (portal com vários vínculos) — só aceita um
 * `tenantId` que exista de fato em `contexts`; qualquer outro valor (vindo de
 * UI, storage corrompido, URL) é rejeitado sem alterar o estado. Isto É a
 * validação exigida pelo lote: nunca uma chamada de rede nova, porque
 * `contexts` já veio validado do backend nesta mesma sessão. */
export function selecionarTenant(estado: EstadoAutenticacaoReal, tenantId: string): EstadoAutenticacaoReal {
  if (estado.status !== "autenticado") return estado;
  if (!estado.sessao.contexts.some((c) => c.tenantId === tenantId)) return estado;
  return { ...estado, tenantIdAtivo: tenantId };
}
