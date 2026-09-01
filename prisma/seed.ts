// Seed determinístico do Agenda Cloud — réplica fiel dos dados hoje gerados em
// src/lib/seed-data.ts (localStorage) e src/lib/planos.ts, agora persistidos no
// Postgres via Prisma. Executado via `tsx prisma/seed.ts` (ou `prisma db seed`,
// que delega para o mesmo comando — ver `migrations.seed` em prisma.config.ts).
//
// Decisões registradas aqui (não implícitas):
//
// 1. Datas absolutas, não relativas: o gerador original (src/lib/seed-data.ts)
//    usa `addDays(new Date(), -N)` — recalculado a cada carga de página, o que é
//    aceitável para dado só-de-memória. Persistido em banco, isso produziria um
//    diff de auditoria/agendamento diferente a cada execução em dias diferentes.
//    Este arquivo ancora todos os cálculos em REFERENCE_DATE (constante abaixo,
//    fixada na data em que este seed foi escrito) em vez de `new Date()`. Rodar
//    o seed em qualquer dia produz exatamente os mesmos registros.
//
// 2. Idempotência: toda escrita usa `upsert` por chave natural estável (slug em
//    Tenant, email em User, code em Plan, key em Feature, tokenHash em Invite,
//    IDs de negócio determinísticos do tipo "dom-navalha-corte-tradicional" em
//    Service, e o próprio `id` determinístico — reaproveitado de
//    src/lib/seed-data.ts — como chave de upsert nas demais tabelas
//    operacionais). Nunca `create` cego.
//
// 3. IDs de Service seguem o padrão `${slugDoTenant}-${slugDoServico}` (ex.:
//    "dom-navalha-corte-tradicional"), como no exemplo do plano
//    (docs/plans/fundacao-postgresql.md). Demais entidades operacionais
//    reaproveitam os IDs determinísticos já usados em seed-data.ts
//    (ex.: "prof-joao-silva", "ag-001") — já eram estáveis, só passam a viver
//    no banco em vez do localStorage.
//
// 4. `Convite.createdByUserId` é obrigatório no schema (FK), mas o tipo de
//    domínio `Convite` (src/lib/types.ts) não tem campo de autor. Este seed
//    atribui um ator plausível (o dono do estabelecimento, ou um master para o
//    convite de plataforma) só para satisfazer o FK — não é um dado espelhado
//    do gerador original.
//
// 5. `PublicSettings.isPublished` é um campo novo (não existe na UI atual, ver
//    comentário em prisma/schema.prisma). Este seed marca `false` só para o
//    tenant suspenso (Barbearia Vintage) e `true` para os demais — decisão de
//    seed, não dado espelhado.
//
// 6. O override de limite "Barbeiro Bastião: máx. 1 profissional" (presente em
//    `Estabelecimento.limites` no gerador original) NÃO tem tabela
//    correspondente no schema atual (só `TenantFeatureOverride` existe, para
//    features — não para limites numéricos). Omitido aqui; reportado como
//    desvio no relatório final desta etapa, não escondido.
//
// 7. Conexão via `@prisma/adapter-pg` + `pg.Pool` com DIRECT_URL — mesmo padrão
//    de prisma.config.ts: este é um script CLI de sessão longa, não deve usar a
//    URL com pooling (DATABASE_URL) que a aplicação usa em runtime.

import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash } from "node:crypto";
import { setHours, setMinutes, startOfDay } from "date-fns";
import { PrismaClient } from "../src/generated/prisma/client";

loadEnvConfig(process.cwd());

if (!process.env.DIRECT_URL) {
  throw new Error("DIRECT_URL não definida — necessária para rodar o seed (ver prisma.config.ts).");
}

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

// Âncora fixa — ver decisão 1 no cabeçalho. Não trocar por `new Date()`.
const REFERENCE_DATE = new Date("2026-09-01T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Helpers de data/hora e string
// ---------------------------------------------------------------------------

function addDaysTo(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function horaDate(dia: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return setMinutes(setHours(startOfDay(dia), h), m);
}

function addMinutesTo(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Espelha `proximosDiasUteis` de seed-data.ts, mas ancorado em REFERENCE_DATE. */
function proximosDiasUteis(offsetInicial: number, quantidade: number, diasFuncionamento: number[]): Date[] {
  const dias: Date[] = [];
  let cursor = offsetInicial;
  while (dias.length < quantidade && cursor < offsetInicial + 60) {
    const candidato = addDaysTo(startOfDay(REFERENCE_DATE), cursor);
    if (diasFuncionamento.includes(candidato.getUTCDay())) {
      dias.push(candidato);
    }
    cursor += 1;
  }
  return dias;
}

/** Espelha `diasUteisPassados` de seed-data.ts, mas ancorado em REFERENCE_DATE. */
function diasUteisPassados(quantidade: number, diasFuncionamento: number[]): Date[] {
  const dias: Date[] = [];
  let cursor = -1;
  while (dias.length < quantidade && cursor > -60) {
    const candidato = addDaysTo(startOfDay(REFERENCE_DATE), cursor);
    if (diasFuncionamento.includes(candidato.getUTCDay())) {
      dias.push(candidato);
    }
    cursor -= 1;
  }
  return dias.reverse();
}

function slugify(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Hash determinístico fictício — nunca o token em texto puro (ver decisão de
 * segurança do plano: Invite não persiste token). */
function fakeTokenHash(seedToken: string): string {
  return createHash("sha256").update(`fake-invite-token:${seedToken}`).digest("hex");
}

const DIAS_TER_A_SAB = [2, 3, 4, 5, 6];
const DIAS_SEG_A_SEX = [1, 2, 3, 4, 5];
const DIAS_SEG_A_SAB = [1, 2, 3, 4, 5, 6];

// ---------------------------------------------------------------------------
// Planos e features (src/lib/planos.ts)
// ---------------------------------------------------------------------------

const FEATURES: { key: string; label: string }[] = [
  { key: "AGENDA", label: "Agenda" },
  { key: "AGENDAMENTO_PUBLICO", label: "Agendamento público" },
  { key: "PROFISSIONAIS", label: "Cadastro de profissionais" },
  { key: "CONSUMIDORES", label: "Cadastro de consumidores" },
  { key: "RELATORIOS", label: "Relatórios" },
  { key: "EQUIPE", label: "Gestão de equipe" },
  { key: "PERSONALIZACAO_AVANCADA", label: "Personalização avançada" },
  { key: "MULTIPLAS_UNIDADES", label: "Múltiplas unidades" },
  { key: "DOMINIO_PROPRIO", label: "Domínio próprio" },
  { key: "LISTA_DE_ESPERA", label: "Lista de espera" },
  { key: "COMISSOES", label: "Comissões" },
  { key: "PAGAMENTOS", label: "Pagamentos" },
  { key: "ASSINATURAS", label: "Assinaturas" },
];

const PLANS: {
  code: string;
  name: string;
  priceCents: number;
  shortDescription: string;
  maxProfessionals: number;
  maxUnits: number;
  featureKeys: string[];
}[] = [
  {
    code: "essencial",
    name: "Essencial",
    priceCents: 7900,
    shortDescription: "Agenda, agendamento público e serviços para um profissional só ou uma equipe pequena.",
    maxProfessionals: 2,
    maxUnits: 1,
    featureKeys: ["AGENDA", "AGENDAMENTO_PUBLICO", "PROFISSIONAIS"],
  },
  {
    code: "equipe",
    name: "Equipe",
    priceCents: 14900,
    shortDescription: "Tudo do Essencial, mais consumidores, relatórios básicos e gestão de equipe.",
    maxProfessionals: 5,
    maxUnits: 1,
    featureKeys: ["AGENDA", "AGENDAMENTO_PUBLICO", "PROFISSIONAIS", "CONSUMIDORES", "RELATORIOS", "EQUIPE"],
  },
  {
    code: "pro",
    name: "Pro",
    priceCents: 24900,
    shortDescription:
      'Tudo do Equipe, mais unidades extras e personalização avançada. Alguns módulos aparecem como "em breve".',
    maxProfessionals: 20,
    maxUnits: 5,
    featureKeys: [
      "AGENDA",
      "AGENDAMENTO_PUBLICO",
      "PROFISSIONAIS",
      "CONSUMIDORES",
      "RELATORIOS",
      "EQUIPE",
      "PERSONALIZACAO_AVANCADA",
      "MULTIPLAS_UNIDADES",
      "LISTA_DE_ESPERA",
      "COMISSOES",
      "PAGAMENTOS",
      "ASSINATURAS",
      "DOMINIO_PROPRIO",
    ],
  },
];

// ---------------------------------------------------------------------------
// Usuários globais (plataforma + estabelecimento)
// ---------------------------------------------------------------------------

const PLATFORM_USERS = [
  {
    id: "mstr-ana-beatriz",
    name: "Ana Beatriz Ferreira",
    email: "ana.ferreira@agendabarber.com",
    platformRole: "MASTER_OWNER" as const,
    platformPermissions: [] as string[],
    createdAt: addDaysTo(REFERENCE_DATE, -600),
    lastSeenAt: addDaysTo(REFERENCE_DATE, -1),
  },
  {
    id: "mstr-rodrigo-salles",
    name: "Rodrigo Salles",
    email: "rodrigo.salles@agendabarber.com",
    platformRole: "MASTER_ADMIN" as const,
    platformPermissions: ["ESTABLISHMENTS_MANAGE"],
    createdAt: addDaysTo(REFERENCE_DATE, -200),
    lastSeenAt: addDaysTo(REFERENCE_DATE, -3),
  },
  {
    id: "mstr-camila-duarte",
    name: "Camila Duarte",
    email: "camila.duarte@agendabarber.com",
    platformRole: "MASTER_SUPPORT" as const,
    platformPermissions: [] as string[],
    createdAt: addDaysTo(REFERENCE_DATE, -90),
    lastSeenAt: addDaysTo(REFERENCE_DATE, -7),
  },
];

const ESTABLISHMENT_USERS = [
  { id: "user-marcelo-nogueira", name: "Marcelo Nogueira", email: "marcelo@domnavalha.com.br", phone: "(11) 98888-1111", status: "ACTIVE" as const, createdAt: addDaysTo(REFERENCE_DATE, -220), lastSeenAt: addDaysTo(REFERENCE_DATE, -1) },
  { id: "user-juliana-prado", name: "Juliana Prado", email: "juliana@domnavalha.com.br", phone: "(11) 98888-2222", status: "ACTIVE" as const, createdAt: addDaysTo(REFERENCE_DATE, -180), lastSeenAt: addDaysTo(REFERENCE_DATE, -2) },
  { id: "user-debora-alves", name: "Débora Alves", email: "debora@domnavalha.com.br", phone: "(11) 98888-3333", status: "ACTIVE" as const, createdAt: addDaysTo(REFERENCE_DATE, -150), lastSeenAt: addDaysTo(REFERENCE_DATE, -5) },
  { id: "user-joao-silva", name: "João Silva", email: "joao.silva@domnavalha.com.br", phone: "(11) 98888-4444", status: "ACTIVE" as const, createdAt: addDaysTo(REFERENCE_DATE, -220), lastSeenAt: addDaysTo(REFERENCE_DATE, -1) },
  { id: "user-mariana-alves", name: "Dra. Mariana Alves", email: "mariana@sorrisoleve.com.br", phone: "(11) 97777-1111", status: "ACTIVE" as const, createdAt: addDaysTo(REFERENCE_DATE, -60), lastSeenAt: addDaysTo(REFERENCE_DATE, -1) },
  { id: "user-lucas-ferreira", name: "Dr. Lucas Ferreira", email: "lucas@sorrisoleve.com.br", phone: "(11) 97777-2222", status: "ACTIVE" as const, createdAt: addDaysTo(REFERENCE_DATE, -60), lastSeenAt: addDaysTo(REFERENCE_DATE, -4) },
  { id: "user-renata-ribeiro", name: "Renata Ribeiro", email: "renata@barbeariajr.com.br", phone: "(11) 96222-1111", status: "ACTIVE" as const, createdAt: addDaysTo(REFERENCE_DATE, -45), lastSeenAt: addDaysTo(REFERENCE_DATE, -1) },
  { id: "user-jonas-ribeiro", name: "Jonas Ribeiro", email: "jonas@barbeariajr.com.br", phone: "(11) 96222-2222", status: "ACTIVE" as const, createdAt: addDaysTo(REFERENCE_DATE, -45), lastSeenAt: addDaysTo(REFERENCE_DATE, -2) },
  { id: "user-bastiao-nunes", name: "Bastião Nunes", email: "bastiao@barbeirobastiao.com.br", phone: "(11) 95111-1111", status: "ACTIVE" as const, createdAt: addDaysTo(REFERENCE_DATE, -90), lastSeenAt: addDaysTo(REFERENCE_DATE, -3) },
  { id: "user-felipe-cardoso", name: "Felipe Cardoso", email: "felipe.cardoso@barbeariajr.com.br", phone: "(11) 96222-3333", status: "INVITED" as const, createdAt: addDaysTo(REFERENCE_DATE, -2), lastSeenAt: undefined },
];

// ---------------------------------------------------------------------------
// Tipos auxiliares para os dados por tenant
// ---------------------------------------------------------------------------

interface ScheduleDraft {
  weekday: number;
  startTime: string;
  endTime: string;
  lunchStart?: string;
  lunchEnd?: string;
}

interface ServiceDraft {
  id: string;
  name: string;
  shortDescription: string;
  priceCents?: number;
  priceVisible: boolean;
  durationMinutes: number;
  bufferAfterMinutes: number;
  modality: "IN_PERSON" | "REMOTE" | "HOME";
  activeInPublicBooking: boolean;
  requiresManualConfirmation: boolean;
}

interface ProfessionalDraft {
  id: string;
  name: string;
  avatarInitials: string;
  avatarColor: string;
  serviceIds: string[];
  schedules: ScheduleDraft[];
}

interface AppointmentDraft {
  id: string;
  consumerName: string;
  consumerWhatsapp: string;
  professionalId: string;
  serviceId: string;
  day: Date | undefined;
  time: string;
  status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | "NO_SHOW";
}

interface TimeBlockDraft {
  id: string;
  professionalId: string;
  start: Date;
  end: Date;
  reason: string;
}

interface ResourceDraft {
  id: string;
  name: string;
  type: "CHAIR" | "ROOM" | "OFFICE" | "EQUIPMENT" | "TABLE" | "VEHICLE" | "OTHER";
}

interface MembershipDraft {
  id: string;
  userId: string;
  role: "DONO" | "GERENTE" | "RECEPCIONISTA" | "PROFISSIONAL";
  professionalId?: string;
  createdAt: Date;
  permissionOverrides?: { permission: string; mode: "GRANTED" | "DENIED" }[];
}

interface InviteDraft {
  id: string;
  targetName: string;
  targetEmail: string;
  establishmentRole?: "DONO" | "GERENTE" | "RECEPCIONISTA" | "PROFISSIONAL";
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  createdByUserId: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt?: Date;
  generatedUserId?: string;
}

interface AuditLogDraft {
  id: string;
  occurredAt: Date;
  action:
    | "TENANT_CREATED"
    | "TENANT_PLAN_CHANGED"
    | "TENANT_FEATURE_CHANGED"
    | "TENANT_SUSPENDED"
    | "TENANT_REACTIVATED"
    | "MASTER_CREATED"
    | "MASTER_REMOVED"
    | "USER_INVITED"
    | "USER_PERMISSION_CHANGED"
    | "SUPPORT_ACCESSED"
    | "IDENTITY_CHANGED";
  actorUserId: string;
  actorName: string;
  summary: string;
  previousData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
}

interface TenantSeed {
  id: string;
  slug: string;
  category: "BARBERSHOP" | "HAIR_SALON" | "CLINIC" | "DENTAL_CLINIC" | "AESTHETICS" | "TATTOO" | "PET_SHOP" | "OTHER";
  taxDocument?: string;
  timezone: string;
  planCode: string;
  status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "PAST_DUE" | "CANCELED";
  suspensionReason?: string;
  professionalCount: number;
  createdAt: Date;
  disabledFeatureKeys: string[];
  brand: {
    name: string;
    shortName: string;
    logoInitials: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    style: string;
    template: "CLASSIC" | "MODERN";
    address: string;
    phone: string;
    instagram?: string;
    presentationText: string;
  };
  operatingDays: number[];
  openTime: string;
  closeTime: string;
  bookingPolicy: {
    minLeadMinutes: number;
    maxFutureDays: number;
    cancellationHours: number;
    autoConfirm: boolean;
    allowAnyProfessional: boolean;
    allowClientReschedule: boolean;
    requireClientPhone: boolean;
    requireClientEmail: boolean;
    showPublicPrice: boolean;
    defaultBufferMinutes: number;
  };
  unit?: { id: string; name: string; address: string };
  professionals: ProfessionalDraft[];
  services: ServiceDraft[];
  appointments: AppointmentDraft[];
  timeBlocks: TimeBlockDraft[];
  resources: ResourceDraft[];
  memberships: MembershipDraft[];
  invites: InviteDraft[];
  auditLogs: AuditLogDraft[];
}

function schedule(dias: number[], base: { start: string; end: string; lunchStart?: string; lunchEnd?: string }, extra?: Partial<Record<number, Partial<{ start: string; end: string }>>>): ScheduleDraft[] {
  return dias.map((dia) => ({
    weekday: dia,
    startTime: extra?.[dia]?.start ?? base.start,
    endTime: extra?.[dia]?.end ?? base.end,
    lunchStart: base.lunchStart,
    lunchEnd: base.lunchEnd,
  }));
}

const bookingPolicyDefaults = {
  minLeadMinutes: 60,
  maxFutureDays: 30,
  cancellationHours: 3,
  autoConfirm: false,
  allowAnyProfessional: true,
  allowClientReschedule: true,
  requireClientPhone: true,
  requireClientEmail: false,
  showPublicPrice: true,
  defaultBufferMinutes: 0,
};

// ---------------------------------------------------------------------------
// Dom Navalha (barbearia — plano Pro, operação completa)
// ---------------------------------------------------------------------------

function buildDomNavalha(): TenantSeed {
  const [passado2, passado1] = diasUteisPassados(2, DIAS_TER_A_SAB);
  const [hoje, futuro1, futuro2, futuro3, futuro4] = proximosDiasUteis(0, 5, DIAS_TER_A_SAB);

  const appointments: AppointmentDraft[] = [
    { id: "ag-001", consumerName: "Marcos Andrade", consumerWhatsapp: "(11) 98123-4501", professionalId: "prof-joao-silva", serviceId: "dom-navalha-corte-tradicional", day: passado2, time: "10:00", status: "COMPLETED" },
    { id: "ag-002", consumerName: "Felipe Nogueira", consumerWhatsapp: "(11) 98123-4502", professionalId: "prof-pedro-martins", serviceId: "dom-navalha-barba", day: passado2, time: "15:00", status: "NO_SHOW" },
    { id: "ag-003", consumerName: "Rodrigo Lima", consumerWhatsapp: "(11) 98123-4503", professionalId: "prof-rafael-costa", serviceId: "dom-navalha-corte-degrade", day: passado2, time: "11:00", status: "COMPLETED" },
    { id: "ag-004", consumerName: "Marcos Andrade", consumerWhatsapp: "(11) 98123-4501", professionalId: "prof-joao-silva", serviceId: "dom-navalha-corte-barba", day: passado1, time: "09:30", status: "COMPLETED" },
    { id: "ag-005", consumerName: "Bruno Carvalho", consumerWhatsapp: "(11) 98123-4504", professionalId: "prof-pedro-martins", serviceId: "dom-navalha-corte-tradicional", day: passado1, time: "17:00", status: "CANCELED" },
    { id: "ag-006", consumerName: "Diego Fonseca", consumerWhatsapp: "(11) 98123-4505", professionalId: "prof-joao-silva", serviceId: "dom-navalha-corte-degrade", day: hoje, time: "09:30", status: "COMPLETED" },
    { id: "ag-007", consumerName: "Rodrigo Lima", consumerWhatsapp: "(11) 98123-4503", professionalId: "prof-rafael-costa", serviceId: "dom-navalha-barba", day: hoje, time: "11:00", status: "CONFIRMED" },
    { id: "ag-008", consumerName: "Felipe Nogueira", consumerWhatsapp: "(11) 98123-4502", professionalId: "prof-pedro-martins", serviceId: "dom-navalha-corte-tradicional", day: hoje, time: "14:00", status: "PENDING" },
    { id: "ag-009", consumerName: "Bruno Carvalho", consumerWhatsapp: "(11) 98123-4504", professionalId: "prof-joao-silva", serviceId: "dom-navalha-corte-barba", day: hoje, time: "16:30", status: "CONFIRMED" },
    { id: "ag-010", consumerName: "Marcos Andrade", consumerWhatsapp: "(11) 98123-4501", professionalId: "prof-joao-silva", serviceId: "dom-navalha-corte-tradicional", day: futuro1, time: "10:00", status: "CONFIRMED" },
    { id: "ag-011", consumerName: "Diego Fonseca", consumerWhatsapp: "(11) 98123-4505", professionalId: "prof-rafael-costa", serviceId: "dom-navalha-corte-degrade", day: futuro1, time: "11:00", status: "PENDING" },
    { id: "ag-012", consumerName: "Camila Ribeiro", consumerWhatsapp: "(11) 98123-4506", professionalId: "prof-pedro-martins", serviceId: "dom-navalha-corte-tradicional", day: futuro2, time: "09:00", status: "CONFIRMED" },
    { id: "ag-013", consumerName: "Bruno Carvalho", consumerWhatsapp: "(11) 98123-4504", professionalId: "prof-joao-silva", serviceId: "dom-navalha-barba", day: futuro3, time: "13:30", status: "PENDING" },
    { id: "ag-014", consumerName: "Felipe Nogueira", consumerWhatsapp: "(11) 98123-4502", professionalId: "prof-rafael-costa", serviceId: "dom-navalha-corte-barba", day: futuro4, time: "15:00", status: "CONFIRMED" },
  ];

  const timeBlocks: TimeBlockDraft[] = [];
  if (futuro2) {
    timeBlocks.push({ id: "bloq-001", professionalId: "prof-rafael-costa", start: horaDate(futuro2, "10:00"), end: horaDate(futuro2, "13:00"), reason: "Curso de aperfeiçoamento" });
  }
  if (futuro3) {
    timeBlocks.push({ id: "bloq-002", professionalId: "prof-pedro-martins", start: horaDate(futuro3, "09:00"), end: horaDate(futuro3, "10:30"), reason: "Consulta médica" });
  }

  return {
    id: "tenant-dom-navalha",
    slug: "dom-navalha",
    category: "BARBERSHOP",
    taxDocument: "12.345.678/0001-01",
    timezone: "America/Sao_Paulo",
    planCode: "pro",
    status: "ACTIVE",
    professionalCount: 3,
    createdAt: addDaysTo(REFERENCE_DATE, -220),
    disabledFeatureKeys: [],
    brand: {
      name: "Barbearia Dom Navalha",
      shortName: "Dom Navalha",
      logoInitials: "DN",
      primaryColor: "#1C1A17",
      secondaryColor: "#FAF7F2",
      accentColor: "#B5651D",
      style: "Sofisticado, grafite e cobre",
      template: "CLASSIC",
      address: "Rua das Palmeiras, 245 – Centro",
      phone: "(11) 99999-9999",
      instagram: "@domnavalha",
      presentationText: "Barbearia de bairro com acabamento de navalha e atendimento sem enrolação.",
    },
    operatingDays: DIAS_TER_A_SAB,
    openTime: "09:00",
    closeTime: "19:00",
    bookingPolicy: { ...bookingPolicyDefaults, minLeadMinutes: 60, maxFutureDays: 30, cancellationHours: 3 },
    unit: { id: "unit-dom-navalha", name: "Unidade Centro", address: "Rua das Palmeiras, 245 – Centro" },
    professionals: [
      {
        id: "prof-joao-silva",
        name: "João Silva",
        avatarInitials: "JS",
        avatarColor: "#B5651D",
        serviceIds: ["dom-navalha-corte-tradicional", "dom-navalha-corte-degrade", "dom-navalha-barba", "dom-navalha-corte-barba", "dom-navalha-corte-infantil"],
        schedules: schedule(DIAS_TER_A_SAB, { start: "09:00", end: "19:00", lunchStart: "12:00", lunchEnd: "13:00" }),
      },
      {
        id: "prof-pedro-martins",
        name: "Pedro Martins",
        avatarInitials: "PM",
        avatarColor: "#3B5A6B",
        serviceIds: ["dom-navalha-corte-tradicional", "dom-navalha-corte-degrade", "dom-navalha-barba", "dom-navalha-corte-barba"],
        schedules: schedule(DIAS_TER_A_SAB, { start: "09:00", end: "19:00", lunchStart: "12:00", lunchEnd: "13:00" }, { 6: { end: "14:00" } }),
      },
      {
        id: "prof-rafael-costa",
        name: "Rafael Costa",
        avatarInitials: "RC",
        avatarColor: "#6B4226",
        serviceIds: ["dom-navalha-corte-degrade", "dom-navalha-barba", "dom-navalha-corte-barba"],
        schedules: schedule([3, 4, 5, 6], { start: "10:00", end: "19:00", lunchStart: "13:00", lunchEnd: "14:00" }),
      },
    ],
    services: [
      { id: "dom-navalha-corte-tradicional", name: "Corte tradicional", shortDescription: "Corte na tesoura e máquina, acabamento na navalha.", priceCents: 4000, priceVisible: true, durationMinutes: 30, bufferAfterMinutes: 0, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
      { id: "dom-navalha-corte-degrade", name: "Corte degradê", shortDescription: "Degradê navalhado com acabamento personalizado.", priceCents: 5000, priceVisible: true, durationMinutes: 45, bufferAfterMinutes: 5, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
      { id: "dom-navalha-barba", name: "Barba", shortDescription: "Toalha quente, navalha e hidratação.", priceCents: 3000, priceVisible: true, durationMinutes: 30, bufferAfterMinutes: 0, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
      { id: "dom-navalha-corte-barba", name: "Corte + barba", shortDescription: "Combo completo com acabamento na navalha.", priceCents: 7000, priceVisible: true, durationMinutes: 60, bufferAfterMinutes: 10, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
      { id: "dom-navalha-corte-infantil", name: "Corte infantil", shortDescription: "Corte para crianças até 10 anos, com paciência extra.", priceCents: 3500, priceVisible: true, durationMinutes: 30, bufferAfterMinutes: 0, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
    ],
    appointments,
    timeBlocks,
    resources: [
      { id: "recurso-cadeira-1", name: "Cadeira 1", type: "CHAIR" },
      { id: "recurso-cadeira-2", name: "Cadeira 2", type: "CHAIR" },
      { id: "recurso-cadeira-3", name: "Cadeira 3", type: "CHAIR" },
    ],
    memberships: [
      { id: "memb-marcelo-dn", userId: "user-marcelo-nogueira", role: "DONO", createdAt: addDaysTo(REFERENCE_DATE, -220) },
      { id: "memb-juliana-dn", userId: "user-juliana-prado", role: "GERENTE", createdAt: addDaysTo(REFERENCE_DATE, -180) },
      { id: "memb-debora-dn", userId: "user-debora-alves", role: "RECEPCIONISTA", createdAt: addDaysTo(REFERENCE_DATE, -150) },
      { id: "memb-joao-dn", userId: "user-joao-silva", role: "PROFISSIONAL", professionalId: "prof-joao-silva", createdAt: addDaysTo(REFERENCE_DATE, -220) },
    ],
    invites: [],
    auditLogs: [
      {
        id: "audit-001",
        occurredAt: addDaysTo(REFERENCE_DATE, -220),
        action: "TENANT_CREATED",
        actorUserId: "mstr-ana-beatriz",
        actorName: "Ana Beatriz Ferreira",
        summary: "Estabelecimento Barbearia Dom Navalha criado com plano Pro.",
      },
      {
        id: "audit-006",
        occurredAt: addDaysTo(REFERENCE_DATE, -7),
        action: "SUPPORT_ACCESSED",
        actorUserId: "mstr-camila-duarte",
        actorName: "Camila Duarte",
        summary: "Acesso de suporte para investigar dúvida sobre remarcação.",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Corte Certo (barbearia — plano Essencial, em teste, só listagem do master)
// ---------------------------------------------------------------------------

function buildCorteCerto(): TenantSeed {
  return {
    id: "tenant-corte-certo",
    slug: "corte-certo",
    category: "BARBERSHOP",
    taxDocument: "23.456.789/0001-02",
    timezone: "America/Sao_Paulo",
    planCode: "essencial",
    status: "TRIAL",
    professionalCount: 2,
    createdAt: addDaysTo(REFERENCE_DATE, -12),
    disabledFeatureKeys: [],
    brand: {
      name: "Corte Certo Barbearia",
      shortName: "Corte Certo",
      logoInitials: "CC",
      primaryColor: "#1C1A17",
      secondaryColor: "#FAF7F2",
      accentColor: "#2F6F4E",
      style: "Moderno",
      template: "MODERN",
      address: "Av. Brasil, 900 – Jardim América",
      phone: "(11) 98888-1234",
      presentationText: "Barbearia em fase de testes na plataforma.",
    },
    operatingDays: DIAS_SEG_A_SAB,
    openTime: "08:00",
    closeTime: "20:00",
    bookingPolicy: { ...bookingPolicyDefaults, minLeadMinutes: 30, maxFutureDays: 15, cancellationHours: 2 },
    professionals: [],
    services: [],
    appointments: [],
    timeBlocks: [],
    resources: [],
    memberships: [],
    invites: [],
    auditLogs: [],
  };
}

// ---------------------------------------------------------------------------
// Barbearia Vintage (barbearia — plano Essencial, suspensa, só listagem)
// ---------------------------------------------------------------------------

function buildBarbeariaVintage(): TenantSeed {
  return {
    id: "tenant-barbearia-vintage",
    slug: "barbearia-vintage",
    category: "BARBERSHOP",
    taxDocument: "34.567.890/0001-03",
    timezone: "America/Sao_Paulo",
    planCode: "essencial",
    status: "SUSPENDED",
    suspensionReason: "Pagamento em atraso há mais de 30 dias.",
    professionalCount: 4,
    createdAt: addDaysTo(REFERENCE_DATE, -400),
    disabledFeatureKeys: [],
    brand: {
      name: "Barbearia Vintage",
      shortName: "Vintage",
      logoInitials: "BV",
      primaryColor: "#1C1A17",
      secondaryColor: "#FAF7F2",
      accentColor: "#8A8D91",
      style: "Retrô",
      template: "CLASSIC",
      address: "Rua Sete de Setembro, 88 – Centro",
      phone: "(11) 97777-5678",
      presentationText: "Estabelecimento suspenso na plataforma (demonstração).",
    },
    operatingDays: DIAS_TER_A_SAB,
    openTime: "10:00",
    closeTime: "20:00",
    bookingPolicy: { ...bookingPolicyDefaults, minLeadMinutes: 60, maxFutureDays: 20, cancellationHours: 4 },
    professionals: [],
    services: [],
    appointments: [],
    timeBlocks: [],
    resources: [],
    memberships: [],
    invites: [
      {
        id: "conv-antigo-vintage",
        targetName: "Sérgio Matos",
        targetEmail: "sergio@barbeariavintage.com.br",
        establishmentRole: "DONO",
        status: "EXPIRED",
        // Ver decisão 4 no cabeçalho: domínio não guarda autor do convite.
        createdByUserId: "mstr-ana-beatriz",
        createdAt: addDaysTo(REFERENCE_DATE, -410),
        expiresAt: addDaysTo(REFERENCE_DATE, -403),
      },
    ],
    auditLogs: [
      {
        id: "audit-005",
        occurredAt: addDaysTo(REFERENCE_DATE, -30),
        action: "TENANT_SUSPENDED",
        actorUserId: "mstr-ana-beatriz",
        actorName: "Ana Beatriz Ferreira",
        summary: "Estabelecimento suspenso por inadimplência.",
        previousData: { status: "inadimplente" },
        newData: { status: "suspenso", motivoSuspensao: "Pagamento em atraso há mais de 30 dias." },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Clínica Sorriso Leve (clínica odontológica — plano Equipe, operação completa)
// ---------------------------------------------------------------------------

function buildClinicaSorrisoLeve(): TenantSeed {
  const [passado1] = diasUteisPassados(1, DIAS_SEG_A_SEX);
  const [hoje, futuro1, futuro2, futuro3] = proximosDiasUteis(0, 4, DIAS_SEG_A_SEX);

  const appointments: AppointmentDraft[] = [
    { id: "ag-c001", consumerName: "Helena Duarte", consumerWhatsapp: "(11) 97123-9001", professionalId: "prof-mariana-alves", serviceId: "clinica-sorriso-leve-limpeza", day: passado1, time: "09:00", status: "COMPLETED" },
    { id: "ag-c002", consumerName: "Otávio Ramos", consumerWhatsapp: "(11) 97123-9002", professionalId: "prof-lucas-ferreira", serviceId: "clinica-sorriso-leve-avaliacao-inicial", day: passado1, time: "14:00", status: "NO_SHOW" },
    { id: "ag-c003", consumerName: "Beatriz Nogueira", consumerWhatsapp: "(11) 97123-9003", professionalId: "prof-mariana-alves", serviceId: "clinica-sorriso-leve-avaliacao-inicial", day: hoje, time: "09:00", status: "CONFIRMED" },
    { id: "ag-c004", consumerName: "Helena Duarte", consumerWhatsapp: "(11) 97123-9001", professionalId: "prof-mariana-alves", serviceId: "clinica-sorriso-leve-clareamento", day: hoje, time: "10:30", status: "PENDING" },
    { id: "ag-c005", consumerName: "Otávio Ramos", consumerWhatsapp: "(11) 97123-9002", professionalId: "prof-lucas-ferreira", serviceId: "clinica-sorriso-leve-limpeza", day: futuro1, time: "08:30", status: "CONFIRMED" },
    { id: "ag-c006", consumerName: "Beatriz Nogueira", consumerWhatsapp: "(11) 97123-9003", professionalId: "prof-mariana-alves", serviceId: "clinica-sorriso-leve-limpeza", day: futuro2, time: "11:00", status: "PENDING" },
    { id: "ag-c007", consumerName: "Helena Duarte", consumerWhatsapp: "(11) 97123-9001", professionalId: "prof-lucas-ferreira", serviceId: "clinica-sorriso-leve-avaliacao-inicial", day: futuro3, time: "15:00", status: "CONFIRMED" },
  ];

  const timeBlocks: TimeBlockDraft[] = [];
  if (futuro1) {
    timeBlocks.push({ id: "bloq-c001", professionalId: "prof-mariana-alves", start: horaDate(futuro1, "13:00"), end: horaDate(futuro1, "14:00"), reason: "Congresso odontológico" });
  }

  return {
    id: "tenant-clinica-sorriso-leve",
    slug: "clinica-sorriso-leve",
    category: "DENTAL_CLINIC",
    taxDocument: "45.678.901/0001-04",
    timezone: "America/Sao_Paulo",
    planCode: "equipe",
    status: "ACTIVE",
    professionalCount: 2,
    createdAt: addDaysTo(REFERENCE_DATE, -60),
    disabledFeatureKeys: [],
    brand: {
      name: "Clínica Sorriso Leve",
      shortName: "Sorriso Leve",
      logoInitials: "SL",
      primaryColor: "#0F3B4D",
      secondaryColor: "#8FBFA6",
      accentColor: "#1C6E8C",
      style: "Clínico, limpo e acolhedor",
      template: "CLASSIC",
      address: "Av. Higienópolis, 512 – Sala 12",
      phone: "(11) 3555-2200",
      instagram: "@sorrisoleveclinica",
      presentationText: "Cuidado odontológico completo, com atendimento humano e consultas sem espera.",
    },
    operatingDays: DIAS_SEG_A_SEX,
    openTime: "08:00",
    closeTime: "18:00",
    bookingPolicy: {
      ...bookingPolicyDefaults,
      minLeadMinutes: 120,
      maxFutureDays: 45,
      cancellationHours: 24,
      allowAnyProfessional: false,
      requireClientEmail: true,
      defaultBufferMinutes: 10,
    },
    unit: { id: "unit-clinica-sorriso-leve", name: "Unidade Higienópolis", address: "Av. Higienópolis, 512 – Sala 12" },
    professionals: [
      {
        id: "prof-mariana-alves",
        name: "Dra. Mariana Alves",
        avatarInitials: "MA",
        avatarColor: "#1C6E8C",
        serviceIds: ["clinica-sorriso-leve-avaliacao-inicial", "clinica-sorriso-leve-limpeza", "clinica-sorriso-leve-clareamento"],
        schedules: schedule(DIAS_SEG_A_SEX, { start: "08:00", end: "18:00", lunchStart: "12:00", lunchEnd: "13:00" }),
      },
      {
        id: "prof-lucas-ferreira",
        name: "Dr. Lucas Ferreira",
        avatarInitials: "LF",
        avatarColor: "#3E7C59",
        serviceIds: ["clinica-sorriso-leve-avaliacao-inicial", "clinica-sorriso-leve-limpeza"],
        schedules: schedule([2, 3, 4, 5], { start: "08:30", end: "17:30", lunchStart: "12:30", lunchEnd: "13:30" }),
      },
    ],
    services: [
      { id: "clinica-sorriso-leve-avaliacao-inicial", name: "Avaliação inicial", shortDescription: "Exame clínico completo para planejar o tratamento.", priceCents: 5000, priceVisible: false, durationMinutes: 40, bufferAfterMinutes: 10, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: true },
      { id: "clinica-sorriso-leve-limpeza", name: "Limpeza", shortDescription: "Profilaxia e remoção de tártaro.", priceCents: 18000, priceVisible: true, durationMinutes: 60, bufferAfterMinutes: 10, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
      { id: "clinica-sorriso-leve-clareamento", name: "Clareamento", shortDescription: "Clareamento dental a laser em consultório.", priceVisible: true, durationMinutes: 90, bufferAfterMinutes: 15, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: true },
    ],
    appointments,
    timeBlocks,
    resources: [
      { id: "recurso-consultorio-1", name: "Consultório 1", type: "OFFICE" },
      { id: "recurso-consultorio-2", name: "Consultório 2", type: "OFFICE" },
    ],
    memberships: [
      { id: "memb-mariana-cl", userId: "user-mariana-alves", role: "DONO", createdAt: addDaysTo(REFERENCE_DATE, -60) },
      { id: "memb-lucas-cl", userId: "user-lucas-ferreira", role: "PROFISSIONAL", professionalId: "prof-lucas-ferreira", createdAt: addDaysTo(REFERENCE_DATE, -60) },
    ],
    invites: [],
    auditLogs: [
      {
        id: "audit-002",
        occurredAt: addDaysTo(REFERENCE_DATE, -60),
        action: "TENANT_CREATED",
        actorUserId: "mstr-ana-beatriz",
        actorName: "Ana Beatriz Ferreira",
        summary: "Estabelecimento Clínica Sorriso Leve criado com plano Equipe.",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Barbearia JR (barbearia — plano Equipe, operação completa, feature override)
// ---------------------------------------------------------------------------

function buildBarbeariaJR(): TenantSeed {
  const [passado1] = diasUteisPassados(1, DIAS_SEG_A_SAB);
  const [hoje, futuro1, futuro2] = proximosDiasUteis(0, 3, DIAS_SEG_A_SAB);

  const appointments: AppointmentDraft[] = [
    { id: "ag-jr001", consumerName: "Rodrigo Lima", consumerWhatsapp: "(11) 98123-4503", professionalId: "prof-jonas-ribeiro", serviceId: "barbearia-jr-combo-completo", day: passado1, time: "14:00", status: "COMPLETED" },
    { id: "ag-jr002", consumerName: "Vinícius Prado", consumerWhatsapp: "(11) 96123-7701", professionalId: "prof-kayky-souza", serviceId: "barbearia-jr-corte-na-maquina", day: passado1, time: "17:00", status: "COMPLETED" },
    { id: "ag-jr003", consumerName: "Igor Batista", consumerWhatsapp: "(11) 96123-7702", professionalId: "prof-jonas-ribeiro", serviceId: "barbearia-jr-barba-desenhada", day: hoje, time: "11:00", status: "CONFIRMED" },
    { id: "ag-jr004", consumerName: "Vinícius Prado", consumerWhatsapp: "(11) 96123-7701", professionalId: "prof-kayky-souza", serviceId: "barbearia-jr-combo-completo", day: futuro1, time: "15:00", status: "PENDING" },
    { id: "ag-jr005", consumerName: "Igor Batista", consumerWhatsapp: "(11) 96123-7702", professionalId: "prof-jonas-ribeiro", serviceId: "barbearia-jr-corte-na-maquina", day: futuro2, time: "18:00", status: "CONFIRMED" },
  ];

  return {
    id: "tenant-barbearia-jr",
    slug: "barbearia-jr",
    category: "BARBERSHOP",
    taxDocument: "56.789.012/0001-05",
    timezone: "America/Sao_Paulo",
    planCode: "equipe",
    status: "ACTIVE",
    professionalCount: 2,
    createdAt: addDaysTo(REFERENCE_DATE, -45),
    // Exceção do master: mesmo o plano Equipe incluindo relatórios, este tenant
    // específico está com o módulo desativado.
    disabledFeatureKeys: ["RELATORIOS"],
    brand: {
      name: "Barbearia JR",
      shortName: "JR",
      logoInitials: "JR",
      primaryColor: "#141414",
      secondaryColor: "#F5F1E8",
      accentColor: "#D4A017",
      style: "Urbano e despojado",
      template: "MODERN",
      address: "Rua Voluntários da Pátria, 1300 – Santana",
      phone: "(11) 96222-8080",
      instagram: "@barbeariajr",
      presentationText: "Barbearia urbana com playlist boa e horário que cabe na sua rotina.",
    },
    operatingDays: DIAS_SEG_A_SAB,
    openTime: "10:00",
    closeTime: "21:00",
    bookingPolicy: { ...bookingPolicyDefaults, minLeadMinutes: 30, maxFutureDays: 30, cancellationHours: 2 },
    unit: { id: "unit-barbearia-jr", name: "Unidade Santana", address: "Rua Voluntários da Pátria, 1300 – Santana" },
    professionals: [
      {
        id: "prof-jonas-ribeiro",
        name: "Jonas Ribeiro",
        avatarInitials: "JR",
        avatarColor: "#D4A017",
        serviceIds: ["barbearia-jr-corte-na-maquina", "barbearia-jr-barba-desenhada", "barbearia-jr-combo-completo"],
        schedules: schedule(DIAS_SEG_A_SAB, { start: "10:00", end: "21:00", lunchStart: "13:00", lunchEnd: "14:00" }),
      },
      {
        id: "prof-kayky-souza",
        name: "Kayky Souza",
        avatarInitials: "KS",
        avatarColor: "#8A6D3B",
        serviceIds: ["barbearia-jr-corte-na-maquina", "barbearia-jr-combo-completo"],
        schedules: schedule(DIAS_SEG_A_SAB, { start: "12:00", end: "21:00", lunchStart: "16:00", lunchEnd: "16:30" }, { 6: { start: "10:00", end: "18:00" } }),
      },
    ],
    services: [
      { id: "barbearia-jr-corte-na-maquina", name: "Corte na máquina", shortDescription: "Corte moderno na máquina com acabamento na régua.", priceCents: 4500, priceVisible: true, durationMinutes: 30, bufferAfterMinutes: 0, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
      { id: "barbearia-jr-barba-desenhada", name: "Barba desenhada", shortDescription: "Barba alinhada e desenhada na navalha.", priceCents: 3500, priceVisible: true, durationMinutes: 25, bufferAfterMinutes: 0, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
      { id: "barbearia-jr-combo-completo", name: "Combo completo", shortDescription: "Corte + barba com sobrancelha incluída.", priceCents: 7500, priceVisible: true, durationMinutes: 60, bufferAfterMinutes: 10, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
    ],
    appointments,
    timeBlocks: [],
    resources: [],
    memberships: [
      { id: "memb-renata-jr", userId: "user-renata-ribeiro", role: "DONO", createdAt: addDaysTo(REFERENCE_DATE, -45) },
      {
        id: "memb-jonas-jr",
        userId: "user-jonas-ribeiro",
        role: "PROFISSIONAL",
        professionalId: "prof-jonas-ribeiro",
        createdAt: addDaysTo(REFERENCE_DATE, -45),
        // Jonas ganhou acesso a relatórios por exceção individual mesmo com a
        // feature desativada pelo master neste tenant — "liberação de papel" e
        // "feature ligada" são checagens independentes.
        permissionOverrides: [{ permission: "RELATORIOS_VISUALIZAR", mode: "GRANTED" }],
      },
    ],
    invites: [
      {
        id: "conv-jonas-jr",
        targetName: "Jonas Ribeiro",
        targetEmail: "jonas@barbeariajr.com.br",
        establishmentRole: "PROFISSIONAL",
        status: "ACCEPTED",
        createdByUserId: "user-renata-ribeiro",
        createdAt: addDaysTo(REFERENCE_DATE, -46),
        expiresAt: addDaysTo(REFERENCE_DATE, -39),
        acceptedAt: addDaysTo(REFERENCE_DATE, -45),
        generatedUserId: "user-jonas-ribeiro",
      },
      {
        id: "conv-felipe-jr",
        targetName: "Felipe Cardoso",
        targetEmail: "felipe.cardoso@barbeariajr.com.br",
        establishmentRole: "RECEPCIONISTA",
        status: "PENDING",
        createdByUserId: "user-renata-ribeiro",
        createdAt: addDaysTo(REFERENCE_DATE, -2),
        expiresAt: addDaysTo(REFERENCE_DATE, 5),
      },
    ],
    auditLogs: [
      {
        id: "audit-003",
        occurredAt: addDaysTo(REFERENCE_DATE, -45),
        action: "TENANT_CREATED",
        actorUserId: "mstr-rodrigo-salles",
        actorName: "Rodrigo Salles",
        summary: "Estabelecimento Barbearia JR criado com plano Equipe.",
      },
      {
        id: "audit-004",
        occurredAt: addDaysTo(REFERENCE_DATE, -44),
        action: "TENANT_FEATURE_CHANGED",
        actorUserId: "mstr-rodrigo-salles",
        actorName: "Rodrigo Salles",
        summary: "Módulo de relatórios desativado por exceção.",
        previousData: { featuresDesativadas: [] },
        newData: { featuresDesativadas: ["relatorios"] },
      },
      {
        id: "audit-007",
        occurredAt: addDaysTo(REFERENCE_DATE, -2),
        action: "USER_INVITED",
        actorUserId: "user-renata-ribeiro",
        actorName: "Renata Ribeiro",
        summary: "Convite de recepcionista enviado para Felipe Cardoso.",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Barbeiro Bastião (barbearia — plano Essencial, profissional único)
// ---------------------------------------------------------------------------

function buildBarbeiroBastiao(): TenantSeed {
  const [passado1] = diasUteisPassados(1, DIAS_TER_A_SAB);
  const [hoje, futuro1] = proximosDiasUteis(0, 2, DIAS_TER_A_SAB);

  const appointments: AppointmentDraft[] = [
    { id: "ag-bb001", consumerName: "Cláudio Peixoto", consumerWhatsapp: "(11) 95123-3301", professionalId: "prof-bastiao-nunes", serviceId: "barbeiro-bastiao-corte-simples", day: passado1, time: "10:00", status: "COMPLETED" },
    { id: "ag-bb002", consumerName: "Cláudio Peixoto", consumerWhatsapp: "(11) 95123-3301", professionalId: "prof-bastiao-nunes", serviceId: "barbeiro-bastiao-barba", day: hoje, time: "09:30", status: "CONFIRMED" },
    { id: "ag-bb003", consumerName: "Emerson Diniz", consumerWhatsapp: "(11) 95123-3302", professionalId: "prof-bastiao-nunes", serviceId: "barbeiro-bastiao-corte-simples", day: futuro1, time: "14:00", status: "PENDING" },
  ];

  return {
    id: "tenant-barbeiro-bastiao",
    slug: "barbeiro-bastiao",
    category: "BARBERSHOP",
    timezone: "America/Sao_Paulo",
    planCode: "essencial",
    status: "ACTIVE",
    professionalCount: 1,
    createdAt: addDaysTo(REFERENCE_DATE, -90),
    disabledFeatureKeys: [],
    brand: {
      name: "Barbeiro Bastião",
      shortName: "Bastião",
      logoInitials: "BB",
      primaryColor: "#2B2321",
      secondaryColor: "#EFE6DA",
      accentColor: "#6B4226",
      style: "Artesanal, um profissional só",
      template: "CLASSIC",
      address: "Rua dos Ipês, 45 – Vila Ipê",
      phone: "(11) 95111-4433",
      presentationText: "Corte e barba feitos com calma, na cadeira do próprio Bastião.",
    },
    operatingDays: DIAS_TER_A_SAB,
    openTime: "09:00",
    closeTime: "18:00",
    bookingPolicy: { ...bookingPolicyDefaults, minLeadMinutes: 60, maxFutureDays: 20, cancellationHours: 3 },
    unit: { id: "unit-barbeiro-bastiao", name: "Unidade Vila Ipê", address: "Rua dos Ipês, 45 – Vila Ipê" },
    professionals: [
      {
        id: "prof-bastiao-nunes",
        name: "Bastião Nunes",
        avatarInitials: "BN",
        avatarColor: "#6B4226",
        serviceIds: ["barbeiro-bastiao-corte-simples", "barbeiro-bastiao-barba"],
        schedules: schedule(DIAS_TER_A_SAB, { start: "09:00", end: "18:00", lunchStart: "12:00", lunchEnd: "13:30" }),
      },
    ],
    services: [
      { id: "barbeiro-bastiao-corte-simples", name: "Corte simples", shortDescription: "Corte clássico na tesoura, com calma.", priceCents: 3500, priceVisible: true, durationMinutes: 40, bufferAfterMinutes: 5, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
      { id: "barbeiro-bastiao-barba", name: "Barba", shortDescription: "Barba feita na navalha, com toalha quente.", priceCents: 2500, priceVisible: true, durationMinutes: 30, bufferAfterMinutes: 5, modality: "IN_PERSON", activeInPublicBooking: true, requiresManualConfirmation: false },
    ],
    appointments,
    timeBlocks: [],
    resources: [],
    memberships: [
      { id: "memb-bastiao-bb", userId: "user-bastiao-nunes", role: "DONO", professionalId: "prof-bastiao-nunes", createdAt: addDaysTo(REFERENCE_DATE, -90) },
    ],
    invites: [],
    auditLogs: [],
  };
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

async function seedGlobal() {
  const planIdByCode = new Map<string, string>();
  const featureIdByKey = new Map<string, string>();

  for (const feature of FEATURES) {
    const row = await prisma.feature.upsert({
      where: { key: feature.key as never },
      update: { label: feature.label },
      create: { key: feature.key as never, label: feature.label },
    });
    featureIdByKey.set(feature.key, row.id);
  }

  for (const plan of PLANS) {
    const row = await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        priceCents: plan.priceCents,
        shortDescription: plan.shortDescription,
        maxProfessionals: plan.maxProfessionals,
        maxUnits: plan.maxUnits,
      },
      create: {
        code: plan.code,
        name: plan.name,
        priceCents: plan.priceCents,
        shortDescription: plan.shortDescription,
        maxProfessionals: plan.maxProfessionals,
        maxUnits: plan.maxUnits,
      },
    });
    planIdByCode.set(plan.code, row.id);

    for (const featureKey of plan.featureKeys) {
      const featureId = featureIdByKey.get(featureKey)!;
      await prisma.planFeature.upsert({
        where: { planId_featureId: { planId: row.id, featureId } },
        update: {},
        create: { planId: row.id, featureId },
      });
    }
  }

  for (const user of PLATFORM_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        platformRole: user.platformRole,
        platformPermissions: user.platformPermissions as never,
        lastSeenAt: user.lastSeenAt,
      },
      create: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: "ACTIVE",
        platformRole: user.platformRole,
        platformPermissions: user.platformPermissions as never,
        createdAt: user.createdAt,
        lastSeenAt: user.lastSeenAt,
      },
    });
  }

  for (const user of ESTABLISHMENT_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        phone: user.phone,
        status: user.status,
        lastSeenAt: user.lastSeenAt,
      },
      create: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        status: user.status,
        createdAt: user.createdAt,
        lastSeenAt: user.lastSeenAt,
      },
    });
  }

  // Convite de plataforma (não pertence a nenhum tenant) — Rodrigo Salles.
  const rodrigoTokenHash = fakeTokenHash("conv-rodrigo-master");
  await prisma.invite.upsert({
    where: { tokenHash: rodrigoTokenHash },
    update: {},
    create: {
      id: "conv-rodrigo-master",
      type: "PLATFORM",
      targetName: "Rodrigo Salles",
      targetEmail: "rodrigo.salles@agendabarber.com",
      platformRole: "MASTER_ADMIN",
      status: "ACCEPTED",
      tokenHash: rodrigoTokenHash,
      createdByUserId: "mstr-ana-beatriz",
      createdAt: addDaysTo(REFERENCE_DATE, -201),
      expiresAt: addDaysTo(REFERENCE_DATE, -194),
      acceptedAt: addDaysTo(REFERENCE_DATE, -200),
      generatedUserId: "mstr-rodrigo-salles",
    },
  });

  return { planIdByCode, featureIdByKey };
}

async function seedTenant(tenant: TenantSeed, planIdByCode: Map<string, string>, featureIdByKey: Map<string, string>) {
  const planId = planIdByCode.get(tenant.planCode);
  if (!planId) throw new Error(`Plano desconhecido: ${tenant.planCode}`);

  await prisma.$transaction(
    async (tx) => {
    const tenantRow = await tx.tenant.upsert({
      where: { slug: tenant.slug },
      update: {
        category: tenant.category,
        taxDocument: tenant.taxDocument,
        timezone: tenant.timezone,
        planId,
        status: tenant.status,
        suspensionReason: tenant.suspensionReason,
        professionalCount: tenant.professionalCount,
      },
      create: {
        id: tenant.id,
        slug: tenant.slug,
        category: tenant.category,
        taxDocument: tenant.taxDocument,
        timezone: tenant.timezone,
        planId,
        status: tenant.status,
        suspensionReason: tenant.suspensionReason,
        professionalCount: tenant.professionalCount,
        createdAt: tenant.createdAt,
      },
    });
    const tenantId = tenantRow.id;

    await tx.brandIdentity.upsert({
      where: { tenantId },
      update: {
        name: tenant.brand.name,
        shortName: tenant.brand.shortName,
        logoInitials: tenant.brand.logoInitials,
        primaryColor: tenant.brand.primaryColor,
        secondaryColor: tenant.brand.secondaryColor,
        accentColor: tenant.brand.accentColor,
        style: tenant.brand.style,
        template: tenant.brand.template,
        address: tenant.brand.address,
        phone: tenant.brand.phone,
        instagram: tenant.brand.instagram,
        presentationText: tenant.brand.presentationText,
      },
      create: {
        tenantId,
        name: tenant.brand.name,
        shortName: tenant.brand.shortName,
        logoInitials: tenant.brand.logoInitials,
        primaryColor: tenant.brand.primaryColor,
        secondaryColor: tenant.brand.secondaryColor,
        accentColor: tenant.brand.accentColor,
        style: tenant.brand.style,
        template: tenant.brand.template,
        address: tenant.brand.address,
        phone: tenant.brand.phone,
        instagram: tenant.brand.instagram,
        presentationText: tenant.brand.presentationText,
        photos: [],
        sectionOrder: [],
      },
    });

    await tx.bookingPolicy.upsert({
      where: { tenantId },
      update: { ...tenant.bookingPolicy },
      create: { tenantId, ...tenant.bookingPolicy },
    });

    await tx.publicSettings.upsert({
      where: { tenantId },
      update: {
        operatingDays: tenant.operatingDays,
        openTime: tenant.openTime,
        closeTime: tenant.closeTime,
        isPublished: tenant.status !== "SUSPENDED",
      },
      create: {
        tenantId,
        operatingDays: tenant.operatingDays,
        openTime: tenant.openTime,
        closeTime: tenant.closeTime,
        isPublished: tenant.status !== "SUSPENDED",
      },
    });

    for (const featureKey of tenant.disabledFeatureKeys) {
      const featureId = featureIdByKey.get(featureKey)!;
      await tx.tenantFeatureOverride.upsert({
        where: { tenantId_featureId: { tenantId, featureId } },
        update: { enabled: false },
        create: { tenantId, featureId, enabled: false },
      });
    }

    if (tenant.unit) {
      await tx.unit.upsert({
        where: { id: tenant.unit.id },
        update: { name: tenant.unit.name, address: tenant.unit.address, timezone: tenant.timezone, isPrimary: true },
        create: { id: tenant.unit.id, tenantId, name: tenant.unit.name, address: tenant.unit.address, timezone: tenant.timezone, isPrimary: true },
      });
    }

    for (const service of tenant.services) {
      await tx.service.upsert({
        where: { id: service.id },
        update: {
          name: service.name,
          shortDescription: service.shortDescription,
          priceCents: service.priceCents,
          priceVisible: service.priceVisible,
          durationMinutes: service.durationMinutes,
          bufferAfterMinutes: service.bufferAfterMinutes,
          modality: service.modality,
          activeInPublicBooking: service.activeInPublicBooking,
          requiresManualConfirmation: service.requiresManualConfirmation,
        },
        create: {
          id: service.id,
          tenantId,
          name: service.name,
          shortDescription: service.shortDescription,
          priceCents: service.priceCents,
          priceVisible: service.priceVisible,
          durationMinutes: service.durationMinutes,
          bufferAfterMinutes: service.bufferAfterMinutes,
          modality: service.modality,
          activeInPublicBooking: service.activeInPublicBooking,
          requiresManualConfirmation: service.requiresManualConfirmation,
        },
      });
    }

    for (const professional of tenant.professionals) {
      await tx.professional.upsert({
        where: { id: professional.id },
        update: {
          name: professional.name,
          avatarInitials: professional.avatarInitials,
          avatarColor: professional.avatarColor,
          unitId: tenant.unit?.id,
        },
        create: {
          id: professional.id,
          tenantId,
          unitId: tenant.unit?.id,
          name: professional.name,
          avatarInitials: professional.avatarInitials,
          avatarColor: professional.avatarColor,
        },
      });

      for (const s of professional.schedules) {
        await tx.professionalSchedule.upsert({
          where: { professionalId_weekday: { professionalId: professional.id, weekday: s.weekday } },
          update: { startTime: s.startTime, endTime: s.endTime, lunchStart: s.lunchStart, lunchEnd: s.lunchEnd },
          create: { professionalId: professional.id, weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, lunchStart: s.lunchStart, lunchEnd: s.lunchEnd },
        });
      }

      for (const serviceId of professional.serviceIds) {
        await tx.professionalService.upsert({
          where: { professionalId_serviceId: { professionalId: professional.id, serviceId } },
          update: {},
          create: { professionalId: professional.id, serviceId },
        });
      }
    }

    for (const resource of tenant.resources) {
      await tx.resource.upsert({
        where: { id: resource.id },
        update: { name: resource.name, type: resource.type },
        create: { id: resource.id, tenantId, name: resource.name, type: resource.type },
      });
    }

    // Consumidores: derivados dos rascunhos de agendamento (mesmo id determinístico
    // de seed-data.ts: `cons-${tenantId}-${slug(nome)}`), com estatísticas agregadas.
    const consumerStatsById = new Map<
      string,
      { name: string; whatsapp: string; totalVisits: number; totalNoShows: number; lastServedAt?: Date; nextAppointmentAt?: Date }
    >();
    for (const appt of tenant.appointments) {
      if (!appt.day) continue;
      const consumerId = `cons-${tenantId}-${slugify(appt.consumerName)}`;
      const start = horaDate(appt.day, appt.time);
      const isPastOrToday = start.getTime() <= REFERENCE_DATE.getTime();
      const stats = consumerStatsById.get(consumerId) ?? {
        name: appt.consumerName,
        whatsapp: appt.consumerWhatsapp,
        totalVisits: 0,
        totalNoShows: 0,
      };
      if (appt.status === "COMPLETED") {
        stats.totalVisits += 1;
        if (!stats.lastServedAt || start > stats.lastServedAt) stats.lastServedAt = start;
      }
      if (appt.status === "NO_SHOW") stats.totalNoShows += 1;
      if (!isPastOrToday && (appt.status === "CONFIRMED" || appt.status === "PENDING")) {
        if (!stats.nextAppointmentAt || start < stats.nextAppointmentAt) stats.nextAppointmentAt = start;
      }
      consumerStatsById.set(consumerId, stats);
    }

    for (const [consumerId, stats] of consumerStatsById) {
      const whatsappNormalized = digitsOnly(stats.whatsapp);
      await tx.consumer.upsert({
        where: { tenantId_whatsappNormalized: { tenantId, whatsappNormalized } },
        update: {
          name: stats.name,
          whatsapp: stats.whatsapp,
          totalVisits: stats.totalVisits,
          totalNoShows: stats.totalNoShows,
          lastServedAt: stats.lastServedAt,
          nextAppointmentAt: stats.nextAppointmentAt,
        },
        create: {
          id: consumerId,
          tenantId,
          name: stats.name,
          whatsapp: stats.whatsapp,
          whatsappNormalized,
          totalVisits: stats.totalVisits,
          totalNoShows: stats.totalNoShows,
          lastServedAt: stats.lastServedAt,
          nextAppointmentAt: stats.nextAppointmentAt,
        },
      });
    }

    const serviceById = new Map(tenant.services.map((s) => [s.id, s]));

    for (const appt of tenant.appointments) {
      if (!appt.day || !tenant.unit) continue;
      const service = serviceById.get(appt.serviceId);
      if (!service) throw new Error(`Serviço desconhecido no agendamento ${appt.id}: ${appt.serviceId}`);
      const consumerId = `cons-${tenantId}-${slugify(appt.consumerName)}`;
      const start = horaDate(appt.day, appt.time);
      const end = addMinutesTo(start, service.durationMinutes);
      const createdAt = addDaysTo(start, -3);

      await tx.appointment.upsert({
        where: { id: appt.id },
        update: {
          consumerId,
          consumerNameSnapshot: appt.consumerName,
          consumerWhatsappSnapshot: appt.consumerWhatsapp,
          professionalId: appt.professionalId,
          startAt: start,
          endAt: end,
          status: appt.status,
        },
        create: {
          id: appt.id,
          tenantId,
          unitId: tenant.unit.id,
          consumerId,
          consumerNameSnapshot: appt.consumerName,
          consumerWhatsappSnapshot: appt.consumerWhatsapp,
          professionalId: appt.professionalId,
          startAt: start,
          endAt: end,
          status: appt.status,
          createdAt,
        },
      });

      await tx.appointmentItem.upsert({
        where: { id: `${appt.id}-item-1` },
        update: {
          serviceId: service.id,
          priceCentsSnapshot: service.priceCents,
          durationMinutesSnapshot: service.durationMinutes,
        },
        create: {
          id: `${appt.id}-item-1`,
          appointmentId: appt.id,
          serviceId: service.id,
          priceCentsSnapshot: service.priceCents,
          durationMinutesSnapshot: service.durationMinutes,
          position: 0,
        },
      });

      await tx.appointmentStatusChange.upsert({
        where: { id: `${appt.id}-status-1` },
        update: { toStatus: appt.status, occurredAt: createdAt },
        create: {
          id: `${appt.id}-status-1`,
          appointmentId: appt.id,
          occurredAt: createdAt,
          fromStatus: null,
          toStatus: appt.status,
          changedBy: "consumidor",
        },
      });
    }

    for (const block of tenant.timeBlocks) {
      await tx.timeBlock.upsert({
        where: { id: block.id },
        update: { startAt: block.start, endAt: block.end, reason: block.reason },
        create: { id: block.id, tenantId, professionalId: block.professionalId, startAt: block.start, endAt: block.end, reason: block.reason },
      });
    }

    for (const membership of tenant.memberships) {
      const row = await tx.membership.upsert({
        where: { userId_tenantId: { userId: membership.userId, tenantId } },
        update: { role: membership.role, professionalId: membership.professionalId },
        create: {
          id: membership.id,
          userId: membership.userId,
          tenantId,
          role: membership.role,
          professionalId: membership.professionalId,
          createdAt: membership.createdAt,
        },
      });
      for (const override of membership.permissionOverrides ?? []) {
        await tx.membershipPermissionOverride.upsert({
          where: { membershipId_permission: { membershipId: row.id, permission: override.permission as never } },
          update: { mode: override.mode },
          create: { membershipId: row.id, permission: override.permission as never, mode: override.mode },
        });
      }
    }

    for (const invite of tenant.invites) {
      const tokenHash = fakeTokenHash(invite.id);
      await tx.invite.upsert({
        where: { tokenHash },
        update: {
          status: invite.status,
          acceptedAt: invite.acceptedAt,
          generatedUserId: invite.generatedUserId,
        },
        create: {
          id: invite.id,
          type: "ESTABLISHMENT",
          targetName: invite.targetName,
          targetEmail: invite.targetEmail,
          tenantId,
          establishmentRole: invite.establishmentRole,
          status: invite.status,
          tokenHash,
          createdByUserId: invite.createdByUserId,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
          acceptedAt: invite.acceptedAt,
          generatedUserId: invite.generatedUserId,
        },
      });
    }

    for (const log of tenant.auditLogs) {
      await tx.auditLog.upsert({
        where: { id: log.id },
        update: {
          summary: log.summary,
          previousData: log.previousData as never,
          newData: log.newData as never,
        },
        create: {
          id: log.id,
          occurredAt: log.occurredAt,
          action: log.action,
          actorUserId: log.actorUserId,
          actorName: log.actorName,
          tenantId,
          summary: log.summary,
          previousData: log.previousData as never,
          newData: log.newData as never,
        },
      });
    }
    },
    { timeout: 30_000 }
  );
}

async function main() {
  console.log(`Seed Agenda Cloud — ancorado em ${REFERENCE_DATE.toISOString()}`);

  const { planIdByCode, featureIdByKey } = await seedGlobal();
  console.log("Planos, features e usuários globais: ok.");

  const tenants = [
    buildDomNavalha(),
    buildCorteCerto(),
    buildBarbeariaVintage(),
    buildClinicaSorrisoLeve(),
    buildBarbeariaJR(),
    buildBarbeiroBastiao(),
  ];

  for (const tenant of tenants) {
    await seedTenant(tenant, planIdByCode, featureIdByKey);
    console.log(`Tenant ${tenant.slug}: ok.`);
  }

  const counts = {
    tenants: await prisma.tenant.count(),
    users: await prisma.user.count(),
    professionals: await prisma.professional.count(),
    services: await prisma.service.count(),
    consumers: await prisma.consumer.count(),
    appointments: await prisma.appointment.count(),
    invites: await prisma.invite.count(),
    auditLogs: await prisma.auditLog.count(),
  };
  console.log("Resumo:", counts);
}

main()
  .catch((error) => {
    console.error("Seed falhou:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
