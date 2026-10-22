export const SITUACOES = {
  TRIAL: "Em teste",
  ACTIVE: "Ativo",
  SUSPENDED: "Suspenso",
  PAST_DUE: "Acesso restrito",
  CANCELED: "Cancelado",
} as const;
export type SituacaoEstabelecimento = keyof typeof SITUACOES;
export interface EstabelecimentoAdministrado {
  id: string;
  name: string;
  slug: string;
  category: string;
  timezone: string;
  status: SituacaoEstabelecimento;
  createdAt: string;
  plan: {
    id: string;
    code: string;
    name: string;
    catalogPriceCents: number | null;
    maxProfessionals: number;
    maxUnits: number;
  };
  owners: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    status: string;
  }[];
}
export interface ListaEstabelecimentos {
  items: EstabelecimentoAdministrado[];
  total: number;
  page: number;
  pageSize: number;
  summary: { total: number; active: number; trial: number; restricted: number };
  plans: { id: string; name: string }[];
}
export interface DetalheEstabelecimento extends EstabelecimentoAdministrado {
  units: { id: string; name: string; address: string; isPrimary: boolean }[];
  usage: { professionals: number; services: number; consumers: number };
  trial: { trialStartAt: string; trialEndAt: string; durationDays: number };
  billing: { available: false };
}

function objeto(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
const inteiro = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const texto = (value: unknown): value is string => typeof value === "string";
const data = (value: unknown): value is string =>
  texto(value) && Number.isFinite(Date.parse(value));
export function ehAcesso(
  value: unknown,
): value is { canViewEstablishments: boolean } {
  return objeto(value) && typeof value.canViewEstablishments === "boolean";
}
export function ehEstabelecimento(
  value: unknown,
): value is EstabelecimentoAdministrado {
  if (
    !objeto(value) ||
    ![value.id, value.name, value.slug, value.category, value.timezone].every(
      texto,
    ) ||
    !texto(value.status) ||
    !Object.hasOwn(SITUACOES, value.status) ||
    !data(value.createdAt)
  )
    return false;
  const plan = value.plan;
  return (
    objeto(plan) &&
    [plan.id, plan.code, plan.name].every(texto) &&
    (plan.catalogPriceCents === null || inteiro(plan.catalogPriceCents)) &&
    inteiro(plan.maxProfessionals) &&
    inteiro(plan.maxUnits) &&
    Array.isArray(value.owners) &&
    value.owners.every(
      (owner: unknown) =>
        objeto(owner) &&
        [owner.id, owner.name, owner.email, owner.status].every(texto) &&
        (owner.phone === null || texto(owner.phone)),
    )
  );
}
export function ehListaEstabelecimentos(
  value: unknown,
): value is ListaEstabelecimentos {
  if (
    !objeto(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(ehEstabelecimento) ||
    !inteiro(value.total) ||
    !inteiro(value.page) ||
    value.page < 1 ||
    !inteiro(value.pageSize) ||
    value.pageSize < 1 ||
    value.pageSize > 100
  )
    return false;
  const summary = value.summary;
  return (
    objeto(summary) &&
    [summary.total, summary.active, summary.trial, summary.restricted].every(
      inteiro,
    ) &&
    value.items.length <= value.pageSize &&
    value.items.length <= value.total &&
    Array.isArray(value.plans) &&
    value.plans.every(
      (plan: unknown) => objeto(plan) && texto(plan.id) && texto(plan.name),
    )
  );
}
export function ehDetalheEstabelecimento(
  value: unknown,
): value is DetalheEstabelecimento {
  if (!ehEstabelecimento(value)) return false;
  const detail = value as unknown as Record<string, unknown>;
  const usage = detail.usage,
    trial = detail.trial;
  return (
    objeto(usage) &&
    [usage.professionals, usage.services, usage.consumers].every(inteiro) &&
    objeto(trial) &&
    data(trial.trialStartAt) &&
    data(trial.trialEndAt) &&
    inteiro(trial.durationDays) &&
    objeto(detail.billing) &&
    detail.billing.available === false &&
    Array.isArray(detail.units) &&
    detail.units.every(
      (unit: unknown) =>
        objeto(unit) &&
        [unit.id, unit.name, unit.address].every(texto) &&
        typeof unit.isPrimary === "boolean",
    )
  );
}

export function precoCatalogo(centavos: number | null): string {
  return centavos === null
    ? "Não definido"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(centavos / 100);
}
export function dataCadastro(instant: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date(instant));
}
export const SEGMENTOS: Record<string, string> = {
  BARBERSHOP: "Barbearia",
  HAIR_SALON: "Salão",
  CLINIC: "Clínica",
  DENTAL_CLINIC: "Consultório odontológico",
  AESTHETICS: "Estética",
  TATTOO: "Estúdio de tatuagem",
  PET_SHOP: "Pet shop",
  OTHER: "Outro / não informado",
};
