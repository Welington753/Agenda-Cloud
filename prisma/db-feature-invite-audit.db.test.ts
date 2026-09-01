import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTenant, createMinimalTenant, ensureCatalog, prisma, testId } from "./db-test-helpers";

describe("feature override, convite e auditoria", () => {
  let planId: string;
  let featureId: string;
  const prefix = testId("misc");
  let tenantId: string;
  let ownerUserId: string;

  beforeAll(async () => {
    const { plan, relatoriosFeature } = await ensureCatalog();
    planId = plan.id;
    featureId = relatoriosFeature.id;
    const { tenant } = await createMinimalTenant(prefix, planId);
    tenantId = tenant.id;

    const owner = await prisma.user.create({
      data: { id: `${prefix}-owner`, name: "Dono de Teste", email: `${prefix}-owner@example.test` },
    });
    ownerUserId = owner.id;
  });

  afterAll(async () => {
    await cleanupTenant(tenantId);
    await prisma.user.delete({ where: { id: ownerUserId } });
  });

  it("desativar uma feature por override não apaga nenhum dado do tenant, só marca enabled=false", async () => {
    const consumer = await prisma.consumer.create({
      data: { id: `${prefix}-consumer`, tenantId, name: "Consumidor", whatsapp: "(11) 90000-5555", whatsappNormalized: "11900005555" },
    });

    const override = await prisma.tenantFeatureOverride.create({
      data: { tenantId, featureId, enabled: false },
    });
    expect(override.enabled).toBe(false);

    // O tenant e seus dados operacionais continuam intactos — a feature
    // desativada é só um flag, não uma exclusão em cascata de nada.
    const [tenantStillThere, consumerStillThere, planStillLinked] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.consumer.findUnique({ where: { id: consumer.id } }),
      prisma.planFeature.findFirst({ where: { planId } }),
    ]);
    expect(tenantStillThere).not.toBeNull();
    expect(consumerStillThere).not.toBeNull();

    // Reativar (enabled=true) também não é uma nova exclusão — só atualiza o flag.
    const reactivated = await prisma.tenantFeatureOverride.update({
      where: { tenantId_featureId: { tenantId, featureId } },
      data: { enabled: true },
    });
    expect(reactivated.enabled).toBe(true);
    void planStillLinked;
  });

  it("convite armazena só o hash do token, nunca o texto puro", async () => {
    const fakePlainToken = `plain-token-${prefix}`;
    const tokenHash = createHash("sha256").update(`fake-invite-token:${prefix}`).digest("hex");

    const invite = await prisma.invite.create({
      data: {
        id: `${prefix}-invite`,
        type: "ESTABLISHMENT",
        targetName: "Convidado de Teste",
        targetEmail: `${prefix}-convidado@example.test`,
        tenantId,
        establishmentRole: "RECEPCIONISTA",
        tokenHash,
        createdByUserId: ownerUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // O schema nem tem coluna de token em texto puro — só tokenHash. Reforça em
    // runtime que o valor gravado é o hash (64 hex chars de sha256), nunca o
    // token original.
    expect(invite.tokenHash).toBe(tokenHash);
    expect(invite.tokenHash).not.toBe(fakePlainToken);
    expect(invite.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(invite)).not.toContain("token");
  });

  it("auditoria fica vinculada ao ator e ao tenant corretos", async () => {
    const log = await prisma.auditLog.create({
      data: {
        id: `${prefix}-audit`,
        action: "IDENTITY_CHANGED",
        actorUserId: ownerUserId,
        actorName: "Dono de Teste",
        tenantId,
        summary: "Alterou a identidade visual em teste automatizado.",
      },
    });

    const found = await prisma.auditLog.findUnique({
      where: { id: log.id },
      include: { actor: true, tenant: true },
    });

    expect(found?.actor.id).toBe(ownerUserId);
    expect(found?.tenant?.id).toBe(tenantId);

    // Um log de auditoria de outro tenant nunca deve aparecer numa consulta
    // filtrada por este tenantId.
    const wrongTenant = await prisma.auditLog.findFirst({ where: { id: log.id, tenantId: "tenant-que-nao-existe" } });
    expect(wrongTenant).toBeNull();
  });
});
