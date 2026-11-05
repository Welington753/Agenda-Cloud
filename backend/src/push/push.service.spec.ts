// Decisões do `PushService` contra um banco falso em memória: quem pode
// desativar com o acesso comercial vencido, o que continua bloqueado e a
// recusa genérica quando o endpoint é de outra pessoa com outras chaves. O
// SQL (trava, conferência das chaves, concorrência) é provado contra
// PostgreSQL descartável em test/push-postgres.db-e2e-spec.ts.
import { createECDH, randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ACCESS_EXPIRED_CODE, ACCESS_LEGACY_SQL } from '../commercial/commercial-gate.js';
import { commercialQueryFake } from '../commercial/testing/commercial-fake.js';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { Membership } from '../entities/membership.entity.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import type { DisparadorDePush } from './push-dispatcher.js';
import { PUSH_INVALID_KEYS_MESSAGE, PushService } from './push.service.js';

type Registro = Record<string, unknown>;

const USUARIO = 'user_a';
const SESSAO = 'session_a';
const TENANT = 'tenant_a';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/aparelho-ficticio';

function chavesFicticias() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

class BancoFalso {
  vencido = false;
  /** A conferência das chaves acha linha de outro usuário com outras chaves. */
  chavesDivergentes = false;
  consultas: { sql: string; params: unknown[] }[] = [];
  memberships: Registro[] = [{ id: 'm_a', userId: USUARIO, tenantId: TENANT, role: EstablishmentRole.DONO, status: 'ACTIVE' }];
  tenants: Registro[] = [{ id: TENANT, status: TenantStatus.ACTIVE }];

  query(sql: string, params: unknown[] = []): Promise<unknown> {
    this.consultas.push({ sql, params });
    if (sql === ACCESS_LEGACY_SQL) return Promise.resolve([{ legacy: !this.vencido }]);
    const comercial = commercialQueryFake(sql);
    if (comercial) return Promise.resolve(comercial);
    if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
    if (sql.startsWith('SELECT 1 FROM push_subscriptions') && sql.includes('p256dh <>')) {
      return Promise.resolve(this.chavesDivergentes ? [{ '?column?': 1 }] : []);
    }
    if (sql.includes('UPDATE push_subscriptions')) return Promise.resolve([[{ id: 'sub_1' }], 1]);
    if (sql.includes('INSERT INTO push_subscriptions')) return Promise.resolve([{ id: 'sub_1' }]);
    if (sql.startsWith('SELECT 1 FROM push_subscriptions')) return Promise.resolve([{ '?column?': 1 }]);
    return Promise.reject(new Error(`Consulta inesperada no teste: ${sql}`));
  }

  private colecao(entity: unknown): Registro[] {
    if (entity === Membership) return this.memberships;
    if (entity === Tenant) return this.tenants;
    if (entity === MembershipPermissionOverride) return [];
    throw new Error('Entidade inesperada no teste');
  }

  findOne(entity: unknown, options: { where: Registro }): Promise<Registro | null> {
    const casa = (l: Registro) => Object.entries(options.where).every(([k, v]) => l[k] === v);
    return Promise.resolve(this.colecao(entity).find(casa) ?? null);
  }

  find(entity: unknown, options: { where: Registro }): Promise<Registro[]> {
    const casa = (l: Registro) => Object.entries(options.where).every(([k, v]) => l[k] === v);
    return Promise.resolve(this.colecao(entity).filter(casa));
  }

  gravacoes(): string[] {
    return this.consultas.map((c) => c.sql).filter((s) => /^\s*(UPDATE|INSERT)/.test(s));
  }
}

describe('PushService', () => {
  let banco: BancoFalso;
  let push: PushService;
  const identidade = { userId: USUARIO, sessionId: SESSAO };

  beforeEach(() => {
    banco = new BancoFalso();
    const dataSource = {
      manager: banco,
      transaction: <T>(fn: (tx: BancoFalso) => Promise<T>) => fn(banco),
    } as unknown as DataSource;
    const disparador = { habilitado: true, chavePublica: 'BChave' } as unknown as DisparadorDePush;
    push = new PushService(dataSource, disparador, () => new Date('2027-03-01T12:00:00.000Z'));
  });

  async function erroDe(promessa: Promise<unknown>): Promise<unknown> {
    try {
      await promessa;
    } catch (erro) {
      return erro;
    }
    throw new Error('esperava falha');
  }

  describe('desativar com o acesso comercial vencido', () => {
    beforeEach(() => {
      banco.vencido = true;
    });

    it('desativa, filtrando pelo próprio usuário, estabelecimento e endpoint', async () => {
      expect(await push.desativar(identidade, TENANT, ENDPOINT)).toEqual({ active: false });
      const [revogacao] = banco.consultas.filter((c) => c.sql.includes('UPDATE push_subscriptions'));
      expect(revogacao.sql).toMatch(/WHERE tenant_id = \$1 AND user_id = \$2 AND endpoint_hash = \$3/);
      expect(revogacao.params.slice(0, 2)).toEqual([TENANT, USUARIO]);
      // Nem consulta a validade: desligar não depende dela.
      expect(banco.consultas.some((c) => c.sql === ACCESS_LEGACY_SQL)).toBe(false);
    });

    it('sem vínculo continua 404, sem gravar nada', async () => {
      banco.memberships = [];
      expect(await erroDe(push.desativar(identidade, TENANT, ENDPOINT))).toBeInstanceOf(NotFoundException);
      expect(banco.gravacoes()).toEqual([]);
    });

    it('vínculo suspenso e estabelecimento inativo continuam recusados', async () => {
      banco.memberships[0].status = 'SUSPENDED';
      expect(await erroDe(push.desativar(identidade, TENANT, ENDPOINT))).toBeInstanceOf(ForbiddenException);
      banco.memberships[0].status = 'ACTIVE';
      banco.tenants[0].status = TenantStatus.SUSPENDED;
      expect(await erroDe(push.desativar(identidade, TENANT, ENDPOINT))).toBeInstanceOf(NotFoundException);
      expect(banco.gravacoes()).toEqual([]);
    });

    it('ativar e consultar continuam bloqueados por ACESSO_VENCIDO', async () => {
      for (const promessa of [
        push.ativar(identidade, TENANT, { endpoint: ENDPOINT, keys: chavesFicticias() }),
        push.estado(identidade, TENANT, ENDPOINT),
      ]) {
        const erro = await erroDe(promessa);
        expect(erro).toBeInstanceOf(ForbiddenException);
        expect((erro as ForbiddenException).getResponse()).toMatchObject({ code: ACCESS_EXPIRED_CODE });
      }
      expect(banco.gravacoes()).toEqual([]);
    });
  });

  describe('ativar', () => {
    it('trava o endpoint e confere as chaves antes de qualquer gravação', async () => {
      expect(await push.ativar(identidade, TENANT, { endpoint: ENDPOINT, keys: chavesFicticias() })).toEqual({ active: true });
      const ordem = banco.consultas.map((c) => c.sql);
      const trava = ordem.findIndex((s) => s.includes('pg_advisory_xact_lock'));
      const conferencia = ordem.findIndex((s) => s.includes('p256dh <>'));
      const primeiraGravacao = ordem.findIndex((s) => /^\s*(UPDATE|INSERT)/.test(s));
      expect(trava).toBeGreaterThanOrEqual(0);
      expect(trava).toBeLessThan(conferencia);
      expect(conferencia).toBeLessThan(primeiraGravacao);
    });

    it('endpoint de outra pessoa com outras chaves: recusa genérica, sem gravar nada', async () => {
      banco.chavesDivergentes = true;
      const erro = await erroDe(push.ativar(identidade, TENANT, { endpoint: ENDPOINT, keys: chavesFicticias() }));
      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as BadRequestException).message).toBe(PUSH_INVALID_KEYS_MESSAGE);
      expect(banco.gravacoes()).toEqual([]);
    });
  });
});
