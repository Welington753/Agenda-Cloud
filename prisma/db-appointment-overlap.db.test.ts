import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTenant, createMinimalTenant, ensureCatalog, prisma, testId } from "./db-test-helpers";

// Cobre a EXCLUDE constraint (appointments_no_overlap_excl): mesmo
// profissional + período conflitante com status ≠ CANCELED deve estourar erro.
// CANCELED libera a agenda (WHERE status <> 'CANCELED'), então cancelar um
// agendamento permite criar outro sobreposto no lugar.
describe("sobreposição de agendamentos (exclusion constraint)", () => {
  let planId: string;
  const prefix = testId("overlap");
  let tenantId: string;
  let unitId: string;
  let professionalId: string;
  let consumerId: string;

  beforeAll(async () => {
    const { plan } = await ensureCatalog();
    planId = plan.id;
    const { tenant, unit } = await createMinimalTenant(prefix, planId);
    tenantId = tenant.id;
    unitId = unit.id;

    const professional = await prisma.professional.create({
      data: { id: `${prefix}-professional`, tenantId, unitId, name: "Profissional Overlap", avatarInitials: "PO", avatarColor: "#222222" },
    });
    professionalId = professional.id;

    const consumer = await prisma.consumer.create({
      data: { id: `${prefix}-consumer`, tenantId, name: "Consumidor Overlap", whatsapp: "(11) 90000-4444", whatsappNormalized: "11900004444" },
    });
    consumerId = consumer.id;
  });

  afterAll(async () => {
    await cleanupTenant(tenantId);
  });

  function apptData(id: string, startIso: string, endIso: string, status: string) {
    return {
      id: `${prefix}-${id}`,
      tenantId,
      unitId,
      consumerId,
      consumerNameSnapshot: "Consumidor Overlap",
      consumerWhatsappSnapshot: "(11) 90000-4444",
      professionalId,
      startAt: new Date(startIso),
      endAt: new Date(endIso),
      status: status as never,
    };
  }

  it("bloqueia sobreposição para o mesmo profissional quando o agendamento existente está ativo", async () => {
    await prisma.appointment.create({ data: apptData("base", "2026-10-06T13:00:00.000Z", "2026-10-06T13:30:00.000Z", "CONFIRMED") });

    await expect(
      prisma.appointment.create({ data: apptData("overlap", "2026-10-06T13:15:00.000Z", "2026-10-06T13:45:00.000Z", "PENDING") })
    ).rejects.toBeTruthy();
  });

  const activeStatuses: [string, number][] = ["CONFIRMED", "PENDING", "IN_PROGRESS", "COMPLETED", "NO_SHOW"].map((s, i) => [s, i]);

  it.each(activeStatuses)(
    "status %s conta para a constraint e bloqueia sobreposição",
    async (status, index) => {
      // Cada status usa um horário próprio (offset por índice) para não colidir
      // com o agendamento criado pela iteração anterior do próprio it.each.
      const hour = 9 + index;
      const id = `status-${status.toLowerCase()}`;
      await prisma.appointment.create({
        data: apptData(id, `2026-10-07T${String(hour).padStart(2, "0")}:00:00.000Z`, `2026-10-07T${String(hour).padStart(2, "0")}:30:00.000Z`, status),
      });

      await expect(
        prisma.appointment.create({
          data: apptData(
            `${id}-conflict`,
            `2026-10-07T${String(hour).padStart(2, "0")}:10:00.000Z`,
            `2026-10-07T${String(hour).padStart(2, "0")}:20:00.000Z`,
            "PENDING"
          ),
        })
      ).rejects.toBeTruthy();
    }
  );

  it("cancelar um agendamento libera o horário para outro sobreposto", async () => {
    const original = await prisma.appointment.create({
      data: apptData("to-cancel", "2026-10-08T10:00:00.000Z", "2026-10-08T10:30:00.000Z", "CONFIRMED"),
    });

    await prisma.appointment.update({ where: { id: original.id }, data: { status: "CANCELED" } });

    const rebooked = await prisma.appointment.create({
      data: apptData("rebooked", "2026-10-08T10:10:00.000Z", "2026-10-08T10:40:00.000Z", "CONFIRMED"),
    });
    expect(rebooked.status).toBe("CONFIRMED");
    expect(rebooked.id).toBe(`${prefix}-rebooked`);
  });

  it("CHECK constraint rejeita endAt <= startAt", async () => {
    await expect(
      prisma.appointment.create({ data: apptData("invalid-duration", "2026-10-09T10:00:00.000Z", "2026-10-09T09:00:00.000Z", "PENDING") })
    ).rejects.toBeTruthy();
  });
});
