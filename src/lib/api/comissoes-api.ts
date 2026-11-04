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

export interface ServicoComRegra {
  service: { id: string; name: string; priceCents: number | null; active: boolean };
  /** O profissional atende este serviço hoje. */
  linked: boolean;
  /** `null`: não configurada. */
  rule: RegraDeComissao | null;
  updatedAt: string | null;
}

export interface RegrasDoProfissional {
  professional: { id: string; name: string; active: boolean };
  services: ServicoComRegra[];
}

export type SituacaoDoItem = "OK" | "NAO_CONFIGURADA" | "SEM_PRECO" | "ACIMA_DO_PRECO";
export type RecebimentoDoCliente = "RECEBIDO" | "SEM_RECEBIMENTO" | "ESTORNADO";

export interface ItemApurado {
  serviceName: string;
  priceCents: number | null;
  rule: RegraDeComissao | null;
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

function ehRegra(v: unknown): v is RegraDeComissao {
  return objeto(v) && TIPOS.includes(v.kind) && numeroOuNulo(v.value);
}

export function ehRegrasDoProfissional(v: unknown): v is RegrasDoProfissional {
  return (
    objeto(v) &&
    objeto(v.professional) &&
    texto(v.professional.id) &&
    texto(v.professional.name) &&
    Array.isArray(v.services) &&
    v.services.every(
      (s) =>
        objeto(s) &&
        objeto(s.service) &&
        texto(s.service.id) &&
        texto(s.service.name) &&
        numeroOuNulo(s.service.priceCents) &&
        typeof s.linked === "boolean" &&
        (s.rule === null || ehRegra(s.rule)),
    )
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
