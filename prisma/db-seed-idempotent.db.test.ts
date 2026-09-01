import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "./db-test-helpers";

const SEED_SCRIPT = path.resolve(__dirname, "seed.ts");

function runSeed(): string {
  return execFileSync(process.execPath, [require.resolve("tsx/cli"), SEED_SCRIPT], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Roda o seed real duas vezes seguidas e compara as contagens: por construção
// (upsert por chave natural, nunca create cego), a segunda rodada não pode
// duplicar nenhuma linha. Cobre a exigência mínima "seed idempotente (rodar 2x,
// comparar contagens)" do plano.
describe("seed idempotente", () => {
  it("rodar o seed duas vezes produz exatamente as mesmas contagens", async () => {
    runSeed();
    const after1 = {
      plans: await prisma.plan.count(),
      features: await prisma.feature.count(),
      tenants: await prisma.tenant.count(),
      users: await prisma.user.count(),
      professionals: await prisma.professional.count(),
      services: await prisma.service.count(),
      consumers: await prisma.consumer.count(),
      appointments: await prisma.appointment.count(),
      appointmentItems: await prisma.appointmentItem.count(),
      appointmentStatusChanges: await prisma.appointmentStatusChange.count(),
      invites: await prisma.invite.count(),
      memberships: await prisma.membership.count(),
      auditLogs: await prisma.auditLog.count(),
    };

    runSeed();
    const after2 = {
      plans: await prisma.plan.count(),
      features: await prisma.feature.count(),
      tenants: await prisma.tenant.count(),
      users: await prisma.user.count(),
      professionals: await prisma.professional.count(),
      services: await prisma.service.count(),
      consumers: await prisma.consumer.count(),
      appointments: await prisma.appointment.count(),
      appointmentItems: await prisma.appointmentItem.count(),
      appointmentStatusChanges: await prisma.appointmentStatusChange.count(),
      invites: await prisma.invite.count(),
      memberships: await prisma.membership.count(),
      auditLogs: await prisma.auditLog.count(),
    };

    expect(after2).toEqual(after1);
    expect(after1.tenants).toBeGreaterThanOrEqual(6);
  }, 180_000);
});
