// Contratos das comissões reais — espelham backend/src/commissions e a rota
// das próprias comissões (backend/src/team). Valores em centavos inteiros;
// percentual em pontos-base (12,5% = 1250). Validação de forma em cada
// resposta: campo faltando vira "erro do servidor", nunca um zero inventado.
//
// Comissão APURADA (calculada na conclusão do atendimento) não é pagamento
// ao profissional: esta API não registra nem informa repasses.
import { precoParaCentavos } from "@/lib/servicos/dinheiro";
import { formatarMoeda } from "@/lib/format";

export type TipoDeRegra = "NONE" | "PERCENTAGE" | "FIXED";

/** `value`: pontos-base (percentual) ou centavos (fixo); `null` em "sem comissão". */
export interface RegraDeComissao {
  kind: TipoDeRegra;
  value: number | null;
}

/** De onde vem a regra: exceção do serviço ou regra geral do profissional. */
export type OrigemDaRegra = "SERVICE" | "DEFAULT";

export interface ServicoComRegra {
  service: { id: string; name: string; priceCents: number | null; active: boolean };
  /** O profissional atende este serviço hoje. */
  linked: boolean;
  /** Exceção do serviço; `null`: sem exceção (usa a regra geral). */
  rule: RegraDeComissao | null;
  /** A regra que a próxima conclusão aplicaria com o profissional recebendo,
   * calculada no servidor com a MESMA precedência da apuração. */
  effective: { source: OrigemDaRegra | null; rule: RegraDeComissao | null };
  updatedAt: string | null;
}

/** Regra geral: só percentual ou fixo por serviço realizado. */
export interface RegraGeral {
  kind: "PERCENTAGE" | "FIXED";
  value: number;
}

export interface RegrasDoProfissional {
  professional: { id: string; name: string; active: boolean };
  /** Desligado: as regras ficam guardadas, mas nenhuma conclusão gera comissão. */
  settings: { receivesCommission: boolean; defaultRule: RegraGeral | null };
  services: ServicoComRegra[];
  /** Impressão das exceções por serviço lidas agora: volta no pedido de
   * remoção, recusado (409 `EXCECOES_DESATUALIZADAS`) se elas mudaram. */
  exceptionsFingerprint: string;
}

export interface ResumoDeRecebeComissao {
  professionals: { professionalId: string; receivesCommission: boolean }[];
}

export type SituacaoDoItem = "OK" | "NAO_CONFIGURADA" | "SEM_PRECO" | "ACIMA_DO_PRECO";
export type RecebimentoDoCliente = "RECEBIDO" | "SEM_RECEBIMENTO" | "ESTORNADO";

/** Origem da regra de um item já apurado. `LEGACY_SERVICE`: regra por serviço
 * gravada antes da regra geral (não é chamada de exceção); `null`: sem regra. */
export type OrigemApurada = OrigemDaRegra | "LEGACY_SERVICE" | null;

export interface ItemApurado {
  serviceName: string;
  priceCents: number | null;
  rule: RegraDeComissao | null;
  ruleSource: OrigemApurada;
  commissionCents: number | null;
  situation: SituacaoDoItem;
}

export interface AtendimentoApurado {
  id: string;
  localDate: string;
  localStart: string;
  completedAt: string;
  consumerName: string;
  professional: { id: string; name: string };
  status: string;
  /** Entra no total apurado. */
  counted: boolean;
  commissionCents: number;
  items: ItemApurado[];
  /** Só na visão do dono. */
  clientPayment?: RecebimentoDoCliente;
  flags: string[];
}

export interface TotalDoProfissional {
  professional: { id: string; name: string; active: boolean };
  accruedCents: number;
  appointments: number;
  items: number;
  review: { notConfigured: number; withoutPrice: number; abovePrice: number; refundedPayment?: number; outOfTotal: number };
}

export interface RelatorioDeComissoes {
  timezone: string;
  period: { from: string; to: string };
  basis: "APURADA_NA_CONCLUSAO";
  totalAccruedCents: number;
  professionals: TotalDoProfissional[];
  appointments: AtendimentoApurado[];
  appointmentsComplete: boolean;
  /** Só no relatório do dono: os profissionais para o filtro. */
  professionalOptions?: { id: string; name: string; active: boolean }[];
  /** Só nas próprias comissões. */
  professional?: { id: string; name: string };
}

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const numero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numeroOuNulo = (v: unknown) => v === null || numero(v);
const TIPOS: readonly unknown[] = ["NONE", "PERCENTAGE", "FIXED"];

const ORIGENS: readonly unknown[] = ["SERVICE", "DEFAULT"];
const ORIGENS_APURADAS: readonly unknown[] = ["SERVICE", "DEFAULT", "LEGACY_SERVICE", null];

export function ehRegra(v: unknown): v is RegraDeComissao {
  return objeto(v) && TIPOS.includes(v.kind) && numeroOuNulo(v.value);
}

export function ehRegraGeral(v: unknown): v is RegraGeral {
  return objeto(v) && (v.kind === "PERCENTAGE" || v.kind === "FIXED") && numero(v.value);
}

/** Origem e regra vêm juntas: sem regra, sem origem. */
function ehEfetiva(v: unknown): boolean {
  if (!objeto(v)) return false;
  if (v.source === null) return v.rule === null;
  return ORIGENS.includes(v.source) && ehRegra(v.rule);
}

export function ehRegrasDoProfissional(v: unknown): v is RegrasDoProfissional {
  return (
    objeto(v) &&
    objeto(v.professional) &&
    texto(v.professional.id) &&
    texto(v.professional.name) &&
    objeto(v.settings) &&
    typeof v.settings.receivesCommission === "boolean" &&
    (v.settings.defaultRule === null || ehRegraGeral(v.settings.defaultRule)) &&
    texto(v.exceptionsFingerprint) &&
    Array.isArray(v.services) &&
    v.services.every(
      (s) =>
        objeto(s) &&
        objeto(s.service) &&
        texto(s.service.id) &&
        texto(s.service.name) &&
        numeroOuNulo(s.service.priceCents) &&
        typeof s.linked === "boolean" &&
        (s.rule === null || ehRegra(s.rule)) &&
        ehEfetiva(s.effective),
    )
  );
}

export function ehResumoDeRecebeComissao(v: unknown): v is ResumoDeRecebeComissao {
  return (
    objeto(v) &&
    Array.isArray(v.professionals) &&
    v.professionals.every((p) => objeto(p) && texto(p.professionalId) && typeof p.receivesCommission === "boolean")
  );
}

function ehAtendimento(v: unknown): v is AtendimentoApurado {
  return (
    objeto(v) &&
    [v.id, v.localDate, v.localStart, v.consumerName, v.status].every(texto) &&
    objeto(v.professional) &&
    texto(v.professional.name) &&
    typeof v.counted === "boolean" &&
    numero(v.commissionCents) &&
    Array.isArray(v.flags) &&
    Array.isArray(v.items) &&
    v.items.every(
      (i) =>
        objeto(i) &&
        texto(i.serviceName) &&
        numeroOuNulo(i.priceCents) &&
        numeroOuNulo(i.commissionCents) &&
        (i.rule === null || ehRegra(i.rule)) &&
        ORIGENS_APURADAS.includes(i.ruleSource) &&
        texto(i.situation),
    )
  );
}

export function ehRelatorioDeComissoes(v: unknown): v is RelatorioDeComissoes {
  return (
    objeto(v) &&
    v.basis === "APURADA_NA_CONCLUSAO" &&
    texto(v.timezone) &&
    objeto(v.period) &&
    texto(v.period.from) &&
    texto(v.period.to) &&
    numero(v.totalAccruedCents) &&
    Array.isArray(v.professionals) &&
    v.professionals.every(
      (p) => objeto(p) && objeto(p.professional) && texto(p.professional.name) && numero(p.accruedCents) && objeto(p.review),
    ) &&
    Array.isArray(v.appointments) &&
    v.appointments.every(ehAtendimento) &&
    typeof v.appointmentsComplete === "boolean"
  );
}

export const caminhoComissoes = (tenantId: string) => `/tenants/${encodeURIComponent(tenantId)}/commissions`;
export const caminhoRegras = (tenantId: string, professionalId: string) =>
  `${caminhoComissoes(tenantId)}/rules/${encodeURIComponent(professionalId)}`;
export const caminhoRegra = (tenantId: string, professionalId: string, serviceId: string) =>
  `${caminhoRegras(tenantId, professionalId)}/${encodeURIComponent(serviceId)}`;
export const caminhoConfiguracoes = (tenantId: string) => `${caminhoComissoes(tenantId)}/settings`;
export const caminhoConfiguracao = (tenantId: string, professionalId: string) =>
  `${caminhoConfiguracoes(tenantId)}/${encodeURIComponent(professionalId)}`;
export const caminhoProprias = (tenantId: string) => `/tenants/${encodeURIComponent(tenantId)}/my-agenda/commissions`;

/** Percentual digitado ("12,5") em pontos-base (1250), sem ponto flutuante:
 * é a mesma conta de centavos com duas casas. */
export function percentualParaPontosBase(valor: string): { ok: true; pontos: number } | { ok: false; erro: string } {
  const lido = precoParaCentavos(valor);
  if (!lido.ok) return { ok: false, erro: lido.erro.replace("85,50", "12,5") };
  if (lido.centavos === null) return { ok: false, erro: "Informe o percentual." };
  if (lido.centavos <= 0) return { ok: false, erro: "Para não pagar comissão, escolha “Sem comissão”." };
  if (lido.centavos > 10_000) return { ok: false, erro: "O percentual vai até 100%." };
  return { ok: true, pontos: lido.centavos };
}

/** Lê o campo de valor de um percentual ou de um valor fixo. `mensagemZero`:
 * o que dizer para zero (a exceção tem "Sem comissão"; a regra geral não). */
export function lerValor(
  tipo: "PERCENTAGE" | "FIXED",
  valor: string,
  mensagemZero: string,
): { ok: true; corpo: { kind: "PERCENTAGE" | "FIXED"; value: number } } | { ok: false; erro: string } {
  const zero = precoParaCentavos(valor);
  if (zero.ok && zero.centavos !== null && zero.centavos <= 0) return { ok: false, erro: mensagemZero };
  if (tipo === "PERCENTAGE") {
    const lido = percentualParaPontosBase(valor);
    return lido.ok ? { ok: true, corpo: { kind: "PERCENTAGE", value: lido.pontos } } : lido;
  }
  const lido = precoParaCentavos(valor);
  if (!lido.ok) return lido;
  if (lido.centavos === null) return { ok: false, erro: "Informe o valor." };
  if (lido.centavos > 100_000_000) return { ok: false, erro: "Valor acima do máximo aceito." };
  return { ok: true, corpo: { kind: "FIXED", value: lido.centavos } };
}

export function pontosBaseParaCampo(pontos: number): string {
  const inteira = Math.floor(pontos / 100);
  const resto = pontos % 100;
  return resto === 0 ? String(inteira) : `${inteira},${String(resto).padStart(2, "0").replace(/0$/, "")}`;
}

/** "Não configurada", "Sem comissão", "12,5%" ou "R$ 9,90 fixo". */
export function rotuloDaRegra(regra: RegraDeComissao | null): string {
  if (regra === null) return "Não configurada";
  if (regra.kind === "NONE") return "Sem comissão";
  if (regra.kind === "PERCENTAGE") return `${pontosBaseParaCampo(regra.value ?? 0)}%`;
  return `${formatarMoeda(regra.value ?? 0)} fixo`;
}

/** Etiqueta da regra que vale num serviço: "Exceção · 12,5%", "Regra geral ·
 * R$ 10,00 fixo" ou "Não configurada". */
export function rotuloDaEfetiva(efetiva: ServicoComRegra["effective"]): string {
  if (efetiva.source === null || efetiva.rule === null) return "Não configurada";
  return `${efetiva.source === "SERVICE" ? "Exceção" : "Regra geral"} · ${rotuloDaRegra(efetiva.rule)}`;
}

/** Origem de um item apurado, para o relatório. Nada para item sem regra
 * (a situação "Sem regra na conclusão" já explica). */
export const ROTULO_ORIGEM_APURADA: Record<Exclude<OrigemApurada, null>, string> = {
  SERVICE: "exceção do serviço",
  DEFAULT: "regra geral",
  LEGACY_SERVICE: "regra por serviço",
};

export const ROTULO_SITUACAO: Record<string, string> = {
  NAO_CONFIGURADA: "Sem regra na conclusão",
  SEM_PRECO: "Percentual sem preço registrado",
  ACIMA_DO_PRECO: "Comissão maior que o preço",
  RECEBIMENTO_ESTORNADO: "Recebimento do cliente estornado",
  FORA_DO_TOTAL: "Fora do total: apuração revertida",
};

export const ROTULO_RECEBIMENTO: Record<RecebimentoDoCliente, string> = {
  RECEBIDO: "Cliente pagou",
  SEM_RECEBIMENTO: "Sem recebimento registrado",
  ESTORNADO: "Recebimento estornado",
};
