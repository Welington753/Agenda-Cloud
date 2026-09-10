// Utilidades compartilhadas pela suíte de testes de banco (*.db.test.ts).
// Fala direto com o PrismaClient (src/lib/db/prisma.ts) — sem repositórios
// (fora de escopo nesta etapa, ver docs/plans/fundacao-postgresql.md).
//
// Regra de ouro desta suíte: cada teste cria seus próprios registros com IDs
// únicos (prefixo `test-<timestamp>-<random>`) e limpa só o que criou. Nunca
// TRUNCATE, nunca deleteMany sem filtro, nunca `migrate reset`.

import { prisma } from "../src/lib/db/prisma";

export { prisma };

/** Gera um prefixo curto e único por teste, para todos os IDs que ele criar. */
export function testId(label: string): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${label}`;
}

/** Garante que o Plano "essencial" e a Feature "AGENDA" existem — upsert
 * idempotente, nunca sobrescreve com dado de teste. Testes usam isso só para
 * satisfazer a FK obrigatória de Tenant.planId / TenantFeatureOverride.featureId,
 * sem depender de o seed já ter rodado antes na mesma execução.
 *
 * `priceCents` abaixo é dado histórico de fixture do Prisma legado (congelado
 * desde o Lote 6B.2, ver docs/plans/fundacao-postgresql.md) — nunca preço
 * comercial aprovado. O catálogo real (TypeORM + src/lib/planos.ts) usa
 * `null` porque o preço ainda não foi definido comercialmente; este valor
 * fixo só existe para satisfazer a coluna NOT NULL do schema.prisma atual. */
export async function ensureCatalog() {
  const plan = await prisma.plan.upsert({
    where: { code: "essencial" },
    update: {},
    create: {
      code: "essencial",
      name: "Essencial",
      priceCents: 7900,
      shortDescription: "Agenda, agendamento público e serviços para um profissional só ou uma equipe pequena.",
      maxProfessionals: 2,
      maxUnits: 1,
    },
  });
  const feature = await prisma.feature.upsert({
    where: { key: "AGENDA" },
    update: {},
    create: { key: "AGENDA", label: "Agenda" },
  });
  const relatoriosFeature = await prisma.feature.upsert({
    where: { key: "RELATORIOS" },
    update: {},
    create: { key: "RELATORIOS", label: "Relatórios" },
  });
  return { plan, feature, relatoriosFeature };
}

/** Cria um tenant mínimo (Tenant + BrandIdentity + BookingPolicy +
 * PublicSettings + Unit), tudo com IDs prefixados por `prefix`, pronto para o
 * teste popular com Professional/Service/Consumer/Appointment. Retorna os IDs
 * para o teste limpar no afterEach/afterAll. */
export async function createMinimalTenant(prefix: string, planId: string, overrides?: { slug?: string }) {
  const slug = overrides?.slug ?? `${prefix}-slug`;
  const tenant = await prisma.tenant.create({
    data: {
      id: `${prefix}-tenant`,
      slug,
      category: "BARBERSHOP",
      timezone: "America/Sao_Paulo",
      planId,
      status: "ACTIVE",
    },
  });
  await prisma.brandIdentity.create({
    data: {
      tenantId: tenant.id,
      name: "Tenant de teste",
      shortName: "Teste",
      logoInitials: "TT",
      primaryColor: "#000000",
      secondaryColor: "#FFFFFF",
      accentColor: "#FF0000",
      style: "teste",
      address: "Rua de teste, 0",
      phone: "(11) 90000-0000",
      presentationText: "Tenant criado por teste automatizado.",
    },
  });
  await prisma.bookingPolicy.create({
    data: {
      tenantId: tenant.id,
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
    },
  });
  await prisma.publicSettings.create({
    data: {
      tenantId: tenant.id,
      operatingDays: [1, 2, 3, 4, 5],
      openTime: "09:00",
      closeTime: "18:00",
    },
  });
  const unit = await prisma.unit.create({
    data: {
      id: `${prefix}-unit`,
      tenantId: tenant.id,
      name: "Unidade de teste",
      address: "Rua de teste, 0",
      timezone: "America/Sao_Paulo",
      isPrimary: true,
    },
  });
  return { tenant, unit };
}

/** Apaga (na ordem certa, respeitando FKs) tudo que `createMinimalTenant` e um
 * teste específico tenham criado para um dado prefixo de tenant. Usa
 * deleteMany sempre filtrado por tenantId — nunca global. */
export async function cleanupTenant(tenantId: string) {
  await prisma.appointmentStatusChange.deleteMany({ where: { appointment: { tenantId } } });
  await prisma.appointmentItem.deleteMany({ where: { appointment: { tenantId } } });
  await prisma.appointmentResource.deleteMany({ where: { appointment: { tenantId } } });
  await prisma.appointment.deleteMany({ where: { tenantId } });
  await prisma.timeBlock.deleteMany({ where: { tenantId } });
  await prisma.professionalService.deleteMany({ where: { professional: { tenantId } } });
  await prisma.professionalSchedule.deleteMany({ where: { professional: { tenantId } } });
  await prisma.membershipPermissionOverride.deleteMany({ where: { membership: { tenantId } } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.professional.deleteMany({ where: { tenantId } });
  await prisma.consumer.deleteMany({ where: { tenantId } });
  await prisma.service.deleteMany({ where: { tenantId } });
  await prisma.resource.deleteMany({ where: { tenantId } });
  await prisma.invite.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.tenantFeatureOverride.deleteMany({ where: { tenantId } });
  await prisma.unit.deleteMany({ where: { tenantId } });
  await prisma.publicSettings.deleteMany({ where: { tenantId } });
  await prisma.bookingPolicy.deleteMany({ where: { tenantId } });
  await prisma.brandIdentity.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}
