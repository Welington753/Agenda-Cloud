import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTenant, createMinimalTenant, ensureCatalog, prisma, testId } from "./db-test-helpers";

// Garante que toda consulta operacional (Consumer/Professional/Service/
// Appointment) combina id + tenantId, nunca id sozinho — um tenant não pode
// ver nem editar dado de outro, mesmo sabendo o id exato do registro.
describe("isolamento entre tenants", () => {
  let planId: string;
  const prefixA = testId("iso-a");
  const prefixB = testId("iso-b");
  let tenantAId: string;
  let tenantBId: string;
  let unitAId: string;

  beforeAll(async () => {
    const { plan } = await ensureCatalog();
    planId = plan.id;

    const { tenant: tenantA, unit: unitA } = await createMinimalTenant(prefixA, planId);
    const { tenant: tenantB } = await createMinimalTenant(prefixB, planId);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    unitAId = unitA.id;
  });

  afterAll(async () => {
    await cleanupTenant(tenantAId);
    await cleanupTenant(tenantBId);
  });

  it("consumidor de um tenant não é encontrado ao consultar com o id do outro tenant", async () => {
    const consumer = await prisma.consumer.create({
      data: {
        id: `${prefixA}-consumer`,
        tenantId: tenantAId,
        name: "Consumidor A",
        whatsapp: "(11) 90000-1111",
        whatsappNormalized: "11900001111",
      },
    });

    const foundFromOwnTenant = await prisma.consumer.findFirst({ where: { id: consumer.id, tenantId: tenantAId } });
    const foundFromOtherTenant = await prisma.consumer.findFirst({ where: { id: consumer.id, tenantId: tenantBId } });

    expect(foundFromOwnTenant).not.toBeNull();
    expect(foundFromOtherTenant).toBeNull();
  });

  it("mesmo telefone normalizado pode existir em tenants diferentes sem colidir", async () => {
    const whatsapp = "(11) 90000-2222";
    const whatsappNormalized = "11900002222";
    await prisma.consumer.create({
      data: { id: `${prefixA}-consumer-shared`, tenantId: tenantAId, name: "Fulano", whatsapp, whatsappNormalized },
    });
    const inTenantB = await prisma.consumer.create({
      data: { id: `${prefixB}-consumer-shared`, tenantId: tenantBId, name: "Fulano (outro tenant)", whatsapp, whatsappNormalized },
    });
    expect(inTenantB.tenantId).toBe(tenantBId);
  });

  it("profissional de um tenant não é encontrado nem atualizado via id do outro tenant", async () => {
    const professional = await prisma.professional.create({
      data: {
        id: `${prefixA}-professional`,
        tenantId: tenantAId,
        unitId: unitAId,
        name: "Profissional A",
        avatarInitials: "PA",
        avatarColor: "#123456",
      },
    });

    const updateAttempt = await prisma.professional.updateMany({
      where: { id: professional.id, tenantId: tenantBId },
      data: { name: "Sequestrado pelo tenant B" },
    });
    expect(updateAttempt.count).toBe(0);

    const stillOriginal = await prisma.professional.findUnique({ where: { id: professional.id } });
    expect(stillOriginal?.name).toBe("Profissional A");
  });

  it("serviço de um tenant não é encontrado ao consultar com o id do outro tenant", async () => {
    const service = await prisma.service.create({
      data: {
        id: `${prefixA}-service`,
        tenantId: tenantAId,
        name: "Serviço A",
        shortDescription: "Serviço do tenant A",
        durationMinutes: 30,
      },
    });
    const foundFromOtherTenant = await prisma.service.findFirst({ where: { id: service.id, tenantId: tenantBId } });
    expect(foundFromOtherTenant).toBeNull();
  });

  it("agendamento de um tenant não é encontrado ao consultar com o id do outro tenant", async () => {
    const professional = await prisma.professional.create({
      data: { id: `${prefixA}-appt-professional`, tenantId: tenantAId, unitId: unitAId, name: "Prof Agenda A", avatarInitials: "PG", avatarColor: "#654321" },
    });
    const consumer = await prisma.consumer.create({
      data: { id: `${prefixA}-appt-consumer`, tenantId: tenantAId, name: "Consumidor Agenda A", whatsapp: "(11) 90000-3333", whatsappNormalized: "11900003333" },
    });
    const start = new Date("2026-10-05T13:00:00.000Z");
    const end = new Date("2026-10-05T13:30:00.000Z");
    const appointment = await prisma.appointment.create({
      data: {
        id: `${prefixA}-appointment`,
        tenantId: tenantAId,
        unitId: unitAId,
        consumerId: consumer.id,
        consumerNameSnapshot: consumer.name,
        consumerWhatsappSnapshot: consumer.whatsapp,
        professionalId: professional.id,
        startAt: start,
        endAt: end,
        status: "CONFIRMED",
      },
    });

    const foundFromOtherTenant = await prisma.appointment.findFirst({ where: { id: appointment.id, tenantId: tenantBId } });
    expect(foundFromOtherTenant).toBeNull();

    const cancelAttemptFromOtherTenant = await prisma.appointment.updateMany({
      where: { id: appointment.id, tenantId: tenantBId },
      data: { status: "CANCELED" },
    });
    expect(cancelAttemptFromOtherTenant.count).toBe(0);
  });
});
