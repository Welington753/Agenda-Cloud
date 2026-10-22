import { globSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { PlatformService } from '../src/platform/platform.service.js';
import { TenantStatus } from '../src/entities/enums/tenant-status.enum.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (
  url &&
  !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)
) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);

describe.skipIf(!url)('administração contra PostgreSQL descartável', () => {
  let db: DataSource;
  let service: PlatformService;
  const master = id(),
    dono = id(),
    admin = id(),
    tenantA = id(),
    tenantB = id(),
    plan = id();
  const marker = `admin-${id()}`;
  beforeAll(async () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(
      path.join(directory, '../src/entities/**/*.entity.ts'),
    )) {
      const exports = (await import(pathToFileURL(file).href)) as Record<
        string,
        unknown
      >;
      for (const value of Object.values(exports))
        if (typeof value === 'function')
          entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities });
    await db.initialize();
    service = new PlatformService(db);
    await db.query(
      `INSERT INTO plans (id, code, name, price_cents, short_description, max_professionals, max_units)
      VALUES ($1,$2,'Plano Administrativo',NULL,'Teste',5,1)`,
      [plan, marker],
    );
    await db.query(
      `INSERT INTO users (id,name,email,platform_role) VALUES
      ($1,'Master de teste',$4,'MASTER_OWNER'),($2,'Dono teste',$5,NULL),($3,'Admin teste',$6,'MASTER_ADMIN')`,
      [
        master,
        dono,
        admin,
        `${master}@example.test`,
        `${dono}@example.test`,
        `${admin}@example.test`,
      ],
    );
    await db.query(
      `INSERT INTO tenants (id,slug,category,timezone,plan_id,status) VALUES
      ($1,$3,'OTHER','America/Sao_Paulo',$5,'ACTIVE'),($2,$4,'OTHER','America/Sao_Paulo',$5,'SUSPENDED')`,
      [tenantA, tenantB, `${marker}-a`, `${marker}-b`, plan],
    );
    await db.query(
      `INSERT INTO units (id,tenant_id,name,address,timezone,is_primary) VALUES
      ($1,$3,$5,'','America/Sao_Paulo',true),($2,$4,$6,'','America/Sao_Paulo',true)`,
      [id(), id(), tenantA, tenantB, `${marker} Alfa 100%`, `${marker} Beta`],
    );
    await db.query(
      `INSERT INTO memberships (id,user_id,tenant_id,role) VALUES ($1,$2,$3,'DONO')`,
      [id(), dono, tenantA],
    );
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('Master sem Membership consulta inclusive suspensos; DONO não consulta nenhum', async () => {
    const result = await service.list(master, {
      q: marker,
      page: 1,
      pageSize: 20,
    });
    expect(result.items.map((item) => item.id).sort()).toEqual(
      [tenantA, tenantB].sort(),
    );
    await expect(service.list(dono, { page: 1, pageSize: 20 })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.detail(dono, tenantA)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.detail(dono, tenantB)).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('página não perde nem duplica estabelecimentos; total não é tamanho da página', async () => {
    const first = await service.list(master, {
      q: marker,
      page: 1,
      pageSize: 1,
    });
    const second = await service.list(master, {
      q: marker,
      page: 2,
      pageSize: 1,
    });
    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(2);
    const [count] = await db.query(
      'SELECT count(*)::int AS total FROM tenants',
    );
    expect(first.summary.total).toBe(count.total);
  });
  it('busca literal, por responsável, situação e plano', async () => {
    expect(
      (
        await service.list(master, {
          q: '100%',
          planId: plan,
          page: 1,
          pageSize: 20,
        })
      ).items.map((t) => t.id),
    ).toEqual([tenantA]);
    expect(
      (
        await service.list(master, {
          q: `${dono}@example.test`,
          page: 1,
          pageSize: 20,
        })
      ).items.map((t) => t.id),
    ).toEqual([tenantA]);
    expect(
      (
        await service.list(master, {
          q: marker,
          status: TenantStatus.SUSPENDED,
          page: 1,
          pageSize: 20,
        })
      ).items.map((t) => t.id),
    ).toEqual([tenantB]);
    expect(
      (await service.list(master, { q: "' OR 1=1 --", page: 1, pageSize: 20 }))
        .total,
    ).toBe(0);
  });
  it('detalhe retorna responsável e dados reais, sem inventar valores financeiros', async () => {
    const detail = await service.detail(master, tenantA);
    expect(detail.owners.map((owner) => owner.id)).toEqual([dono]);
    expect(detail.units).toHaveLength(1);
    expect(detail.plan.catalogPriceCents).toBeNull();
    expect(detail.billing).toEqual({ available: false });
    expect(detail.usage).toEqual({
      professionals: 0,
      services: 0,
      consumers: 0,
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /tokenHash|passwordHash|platformPermissions/,
    );
    await expect(service.detail(master, id())).rejects.toThrow(
      NotFoundException,
    );
  });
  it('permissão explícita e sua revogação são relidas sem novo login', async () => {
    await expect(service.detail(admin, tenantB)).rejects.toThrow(
      ForbiddenException,
    );
    await db.query(
      "UPDATE users SET platform_permissions = ARRAY['ESTABLISHMENTS_MANAGE']::platform_permission[] WHERE id = $1",
      [admin],
    );
    expect((await service.detail(admin, tenantB)).id).toBe(tenantB);
    await db.query(
      "UPDATE users SET platform_permissions = '{}' WHERE id = $1",
      [admin],
    );
    await expect(service.detail(admin, tenantB)).rejects.toThrow(
      ForbiddenException,
    );
    await db.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [
      master,
    ]);
    await expect(service.detail(master, tenantB)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
