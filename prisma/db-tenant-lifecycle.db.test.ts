import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTenant, ensureCatalog, prisma, testId } from "./db-test-helpers";

describe("ciclo de vida do tenant", () => {
  let planId: string;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const { plan } = await ensureCatalog();
    planId = plan.id;
  });

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await cleanupTenant(id);
    }
  });

  it("rejeita slug duplicado (unique constraint)", async () => {
    const prefix = testId("dup-slug");
    const tenantId = `${prefix}-tenant`;
    createdTenantIds.push(tenantId);
    const slug = `${prefix}-slug`;

    await prisma.tenant.create({
      data: { id: tenantId, slug, category: "BARBERSHOP", timezone: "America/Sao_Paulo", planId, status: "ACTIVE" },
    });

    await expect(
      prisma.tenant.create({
        data: { id: `${tenantId}-2`, slug, category: "BARBERSHOP", timezone: "America/Sao_Paulo", planId, status: "ACTIVE" },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("slug duplicado é rejeitado mesmo com capitalização diferente (citext)", async () => {
    const prefix = testId("dup-slug-case");
    const tenantId = `${prefix}-tenant`;
    createdTenantIds.push(tenantId);
    const slug = `${prefix}-Slug`;

    await prisma.tenant.create({
      data: { id: tenantId, slug, category: "BARBERSHOP", timezone: "America/Sao_Paulo", planId, status: "ACTIVE" },
    });

    await expect(
      prisma.tenant.create({
        data: {
          id: `${tenantId}-2`,
          slug: slug.toUpperCase(),
          category: "BARBERSHOP",
          timezone: "America/Sao_Paulo",
          planId,
          status: "ACTIVE",
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("cria um tenant transacionalmente (Tenant + BrandIdentity + BookingPolicy + PublicSettings + Unit + Membership)", async () => {
    const prefix = testId("tx-ok");
    const tenantId = `${prefix}-tenant`;
    createdTenantIds.push(tenantId);
    const slug = `${prefix}-slug`;

    const userEmail = `${prefix}@example.test`;
    const user = await prisma.user.create({ data: { id: `${prefix}-user`, name: "Dono de Teste", email: userEmail } });

    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { id: tenantId, slug, category: "BARBERSHOP", timezone: "America/Sao_Paulo", planId, status: "TRIAL" },
      });
      await tx.brandIdentity.create({
        data: {
          tenantId: tenant.id,
          name: "Tenant Transacional",
          shortName: "TX",
          logoInitials: "TX",
          primaryColor: "#000",
          secondaryColor: "#FFF",
          accentColor: "#F00",
          style: "teste",
          address: "Rua X, 1",
          phone: "(11) 90000-0001",
          presentationText: "Criado em transação.",
        },
      });
      await tx.bookingPolicy.create({
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
      await tx.publicSettings.create({
        data: { tenantId: tenant.id, operatingDays: [1, 2, 3, 4, 5], openTime: "09:00", closeTime: "18:00" },
      });
      const unit = await tx.unit.create({
        data: { id: `${prefix}-unit`, tenantId: tenant.id, name: "Unidade", address: "Rua X, 1", timezone: "America/Sao_Paulo", isPrimary: true },
      });
      await tx.membership.create({
        data: { id: `${prefix}-membership`, userId: user.id, tenantId: tenant.id, role: "DONO" },
      });
      return unit;
    });

    const [tenant, brand, policy, settings, unit, membership] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.brandIdentity.findUnique({ where: { tenantId } }),
      prisma.bookingPolicy.findUnique({ where: { tenantId } }),
      prisma.publicSettings.findUnique({ where: { tenantId } }),
      prisma.unit.findUnique({ where: { id: `${prefix}-unit` } }),
      prisma.membership.findUnique({ where: { userId_tenantId: { userId: user.id, tenantId } } }),
    ]);

    expect(tenant).not.toBeNull();
    expect(brand).not.toBeNull();
    expect(policy).not.toBeNull();
    expect(settings).not.toBeNull();
    expect(unit).not.toBeNull();
    expect(membership?.role).toBe("DONO");

    await prisma.membership.delete({ where: { id: `${prefix}-membership` } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("falha no meio de uma transação de criação não deixa nada gravado (rollback)", async () => {
    const prefix = testId("tx-rollback");
    const tenantId = `${prefix}-tenant`;
    const slug = `${prefix}-slug`;

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.tenant.create({
          data: { id: tenantId, slug, category: "BARBERSHOP", timezone: "America/Sao_Paulo", planId, status: "TRIAL" },
        });
        await tx.brandIdentity.create({
          data: {
            tenantId,
            name: "Tenant Rollback",
            shortName: "RB",
            logoInitials: "RB",
            primaryColor: "#000",
            secondaryColor: "#FFF",
            accentColor: "#F00",
            style: "teste",
            address: "Rua Y, 1",
            phone: "(11) 90000-0002",
            presentationText: "Não deve sobreviver.",
          },
        });
        // Etapa forçada a falhar: FK inexistente (planId referenciando um plano
        // que não existe) — nunca deveria acontecer no fluxo real, mas serve
        // para provar que o rollback desfaz TUDO que veio antes dela na mesma
        // transação, inclusive o Tenant e a BrandIdentity já criados acima.
        await tx.unit.create({
          data: {
            id: `${prefix}-unit`,
            tenantId,
            name: "Unidade",
            address: "Rua Y, 1",
            timezone: "America/Sao_Paulo",
            isPrimary: true,
          },
        });
        await tx.tenant.update({ where: { id: tenantId }, data: { planId: "plano-que-nao-existe" } });
      })
    ).rejects.toBeTruthy();

    const [tenant, brand, unit] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.brandIdentity.findUnique({ where: { tenantId } }),
      prisma.unit.findUnique({ where: { id: `${prefix}-unit` } }),
    ]);
    expect(tenant).toBeNull();
    expect(brand).toBeNull();
    expect(unit).toBeNull();
  });
});
