// Contrato da aplicação de comissão em massa — espelha backend/src/commissions
// (rotas `bulk-settings`). Validação de forma em cada resposta, como em
// comissoes-api.ts.
import { caminhoComissoes, ehRegra, ehRegraGeral, type RegraDeComissao, type RegraGeral } from "@/lib/api/comissoes-api";

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const numero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Aplicação em massa da regra geral (docs/plans/comissoes-aplicacao-em-massa.md).
 * SUBSTITUIR troca a regra geral e liga "Recebe comissão"; PRESERVAR só
 * completa quem recebe sem regra geral. Apurações nunca mudam; exceções por
 * serviço só são removidas em SUBSTITUIR com `REMOVE`. */
export type ModoEmMassa = "REPLACE" | "PRESERVE";
/** `KEEP` (padrão): as exceções por serviço continuam valendo. `REMOVE`
 * (só em SUBSTITUIR): remove as exceções dos profissionais alterados. */
export type EscolhaDeExcecoes = "KEEP" | "REMOVE";
export type AlcanceEmMassa = "ALL" | "SELECTED";
/** `CHANGE`: será (ou foi) alterado; `PRESERVE`: configuração mantida pelo
 * modo PRESERVAR; `UNCHANGED`: já estava como ficaria. */
export type ResultadoEmMassa = "CHANGE" | "PRESERVE" | "UNCHANGED";

export interface ConfiguracaoGeral {
  receivesCommission: boolean;
  defaultRule: RegraGeral | null;
}

export interface PreviaEmMassa {
  target: AlcanceEmMassa;
  mode: ModoEmMassa;
  defaultRule: RegraGeral;
  exceptions: EscolhaDeExcecoes;
  /** Impressão da prévia (inclui as exceções): volta na aplicação; o
   * servidor recusa (409) se o estado mudou desde então. */
  fingerprint: string;
  /** `exceptionsRemoved`: exceções que serão (ou foram) removidas, somando
   * todos os profissionais. */
  summary: { change: number; preserve: number; unchanged: number; total: number; exceptionsRemoved: number };
  professionals: {
    professional: { id: string; name: string };
    current: ConfiguracaoGeral;
    next: ConfiguracaoGeral;
    /** As exceções por serviço do profissional e se serão (ou foram) removidas. */
    exceptions: { services: ExcecaoDoProfissional[]; removed: boolean };
    outcome: ResultadoEmMassa;
  }[];
}

export interface ExcecaoDoProfissional {
  service: { id: string; name: string };
  rule: RegraDeComissao;
}

/** Resposta da aplicação: a mesma forma, já gravada. */
export interface AplicacaoEmMassa extends PreviaEmMassa {
  applied: true;
  operationId: string;
}

const RESULTADOS: readonly unknown[] = ["CHANGE", "PRESERVE", "UNCHANGED"];

function ehConfiguracaoGeral(v: unknown): v is ConfiguracaoGeral {
  return objeto(v) && typeof v.receivesCommission === "boolean" && (v.defaultRule === null || ehRegraGeral(v.defaultRule));
}

function ehExcecoes(v: unknown): boolean {
  return (
    objeto(v) &&
    typeof v.removed === "boolean" &&
    Array.isArray(v.services) &&
    v.services.every((s) => objeto(s) && objeto(s.service) && texto(s.service.id) && texto(s.service.name) && ehRegra(s.rule))
  );
}

export function ehPreviaEmMassa(v: unknown): v is PreviaEmMassa {
  return (
    objeto(v) &&
    (v.target === "ALL" || v.target === "SELECTED") &&
    (v.mode === "REPLACE" || v.mode === "PRESERVE") &&
    ehRegraGeral(v.defaultRule) &&
    (v.exceptions === "KEEP" || v.exceptions === "REMOVE") &&
    texto(v.fingerprint) &&
    objeto(v.summary) &&
    [v.summary.change, v.summary.preserve, v.summary.unchanged, v.summary.total, v.summary.exceptionsRemoved].every(numero) &&
    Array.isArray(v.professionals) &&
    v.professionals.every(
      (p) =>
        objeto(p) &&
        objeto(p.professional) &&
        texto(p.professional.id) &&
        texto(p.professional.name) &&
        ehConfiguracaoGeral(p.current) &&
        ehConfiguracaoGeral(p.next) &&
        ehExcecoes(p.exceptions) &&
        RESULTADOS.includes(p.outcome),
    )
  );
}

export function ehAplicacaoEmMassa(v: unknown): v is AplicacaoEmMassa {
  if (!ehPreviaEmMassa(v)) return false;
  const resto: Record<string, unknown> = { ...v };
  return resto.applied === true && texto(resto.operationId);
}

export const caminhoEmMassa = (tenantId: string) => `${caminhoComissoes(tenantId)}/bulk-settings`;
export const caminhoPreviaEmMassa = (tenantId: string) => `${caminhoEmMassa(tenantId)}/preview`;
