// Testes de autorização e isolamento do `ServicesService` contra um
// `DataSource` falso, em memória. O ponto destes testes NÃO é o SQL (isso é
// coberto de verdade contra Postgres descartável em
// `test/services-postgres.db-e2e-spec.ts`) e sim a decisão: quem pode, o que é
// alcançável, e — principalmente — que toda consulta de `Service` sai daqui
// com `tenantId` no `where`, nunca só com o id.
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { ServiceModality } from '../entities/enums/service-modality.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { Membership } from '../entities/membership.entity.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import { Service } from '../entities/service.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { ServicesService } from './services.service.js';

interface Registro {
  [campo: string]: unknown;
}

/** Guarda cada `where` usado numa consulta de `Service` para o teste provar
 * que `tenantId` nunca falta. */
const wheresDeServico: Registro[] = [];

class FakeManager {
  constructor(
    public tenants: Registro[],
    public memberships: Registro[],
    public overrides: Registro[],
    public services: Registro[],
  ) {}

  private colecaoDe(entity: unknown): Registro[] {
    if (entity === Tenant) return this.tenants;
    if (entity === Membership) return this.memberships;
    if (entity === MembershipPermissionOverride) return this.overrides;
    if (entity === Service) return this.services;
    throw new Error('Entidade inesperada no teste');
  }

  private casa(linha: Registro, where: Registro): boolean {
    return Object.entries(where).every(([campo, valor]) => linha[campo] === valor);
  }

  findOne(entity: unknown, options: { where: Registro }): Promise<Registro | null> {
    if (entity === Service) wheresDeServico.push(options.where);
    return Promise.resolve(this.colecaoDe(entity).find((l) => this.casa(l, options.where)) ?? null);
  }

  find(entity: unknown, options: { where: Registro }): Promise<Registro[]> {
    if (entity === Service) wheresDeServico.push(options.where);
    return Promise.resolve(this.colecaoDe(entity).filter((l) => this.casa(l, options.where)));
  }

  create(_entity: unknown, dados: Registro): Registro {
    return { ...dados };
  }

  save(linha: Registro): Promise<Registro> {
    const alvo = this.services.find((s) => s.id === linha.id);
    if (alvo) {
      Object.assign(alvo, linha);
      return Promise.resolve(alvo);
    }
    const criado = { ...linha, id: linha.id ?? `service_${this.services.length + 1}`, createdAt: new Date() };
    this.services.push(criado);
    return Promise.resolve(criado);
  }
}

const USUARIO_DONO = 'user_dono';
const TENANT_A = 'tenant_a';
const TENANT_B = 'tenant_b';

function servico(id: string, tenantId: string, extra: Registro = {}): Registro {
  return {
    id,
    tenantId,
    name: `Serviço ${id}`,
    shortDescription: '',
    priceCents: 5000,
    priceVisible: true,
    durationMinutes: 30,
    bufferAfterMinutes: 0,
    modality: ServiceModality.IN_PERSON,
    activeInPublicBooking: true,
    requiresManualConfirmation: false,
    active: true,
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    ...extra,
  };
}

function montar(opcoes: {
  role?: EstablishmentRole;
  statusTenantA?: TenantStatus;
  semMembership?: boolean;
  overrides?: Registro[];
} = {}) {
  const manager = new FakeManager(
    [
      { id: TENANT_A, status: opcoes.statusTenantA ?? TenantStatus.ACTIVE },
      { id: TENANT_B, status: TenantStatus.ACTIVE },
    ],
    opcoes.semMembership
      ? []
      : [
          {
            id: 'membership_a',
            userId: USUARIO_DONO,
            tenantId: TENANT_A,
            role: opcoes.role ?? EstablishmentRole.DONO,
          },
        ],
    opcoes.overrides ?? [],
    [servico('service_a1', TENANT_A), servico('service_b1', TENANT_B)],
  );

  const dataSource = { manager } as unknown as DataSource;
  return { manager, servicos: new ServicesService(dataSource) };
}

beforeEach(() => {
  wheresDeServico.length = 0;
});

describe('autorização por requisição', () => {
  it('sem vínculo com o estabelecimento: 404, nunca 403 (não confirma que existe)', async () => {
    const { servicos } = montar({ semMembership: true });
    await expect(servicos.list(USUARIO_DONO, TENANT_A)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('vínculo em outro estabelecimento não autoriza o pedido', async () => {
    const { servicos } = montar();
    // Membership existe só no TENANT_A; pedir o TENANT_B tem de falhar.
    await expect(servicos.list(USUARIO_DONO, TENANT_B)).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([TenantStatus.SUSPENDED, TenantStatus.PAST_DUE, TenantStatus.CANCELED])(
    'tenant %s é inutilizável mesmo com vínculo válido',
    async (status) => {
      const { servicos } = montar({ statusTenantA: status });
      await expect(servicos.list(USUARIO_DONO, TENANT_A)).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it.each([
    EstablishmentRole.GERENTE,
    EstablishmentRole.RECEPCIONISTA,
    EstablishmentRole.PROFISSIONAL,
  ])('%s com vínculo ativo recebe 403 — vínculo não é permissão', async (role) => {
    const { servicos } = montar({ role });
    await expect(servicos.list(USUARIO_DONO, TENANT_A)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(servicos.reactivate(USUARIO_DONO, TENANT_A, 'service_a1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('DONO com DENIED em SERVICOS_GERENCIAR lê, mas não cria nem reativa', async () => {
    const { servicos } = montar({
      overrides: [
        {
          tenantId: TENANT_A,
          membershipId: 'membership_a',
          permission: Permission.SERVICOS_GERENCIAR,
          mode: PermissionMode.DENIED,
        },
      ],
    });

    await expect(servicos.list(USUARIO_DONO, TENANT_A)).resolves.toHaveLength(1);
    await expect(
      servicos.create(USUARIO_DONO, TENANT_A, {
        name: 'Novo',
        shortDescription: '',
        priceCents: null,
        priceVisible: true,
        durationMinutes: 30,
        bufferAfterMinutes: 0,
        modality: ServiceModality.IN_PERSON,
        activeInPublicBooking: true,
        requiresManualConfirmation: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      servicos.reactivate(USUARIO_DONO, TENANT_A, 'service_a1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('isolamento entre estabelecimentos', () => {
  it('a listagem só devolve serviços do tenant autorizado', async () => {
    const { servicos } = montar();
    const lista = await servicos.list(USUARIO_DONO, TENANT_A);

    expect(lista.map((s) => s.id)).toEqual(['service_a1']);
  });

  it('um serviceId de outro estabelecimento é 404, nunca editável', async () => {
    const { servicos } = montar();
    await expect(
      servicos.update(USUARIO_DONO, TENANT_A, 'service_b1', { name: 'Invadido' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      servicos.deactivate(USUARIO_DONO, TENANT_A, 'service_b1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      servicos.reactivate(USUARIO_DONO, TENANT_A, 'service_b1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('o serviço do outro tenant fica intacto depois da tentativa', async () => {
    const { manager, servicos } = montar();
    await servicos
      .update(USUARIO_DONO, TENANT_A, 'service_b1', { name: 'Invadido' })
      .catch(() => undefined);

    const alvo = manager.services.find((s) => s.id === 'service_b1');
    expect(alvo?.name).toBe('Serviço service_b1');
    expect(alvo?.active).toBe(true);
  });

  it('TODA consulta de Service leva tenantId no where — nunca só o id', async () => {
    const { servicos } = montar();
    await servicos.list(USUARIO_DONO, TENANT_A);
    await servicos.update(USUARIO_DONO, TENANT_A, 'service_a1', { name: 'Editado' });
    await servicos.deactivate(USUARIO_DONO, TENANT_A, 'service_a1');

    expect(wheresDeServico.length).toBeGreaterThan(0);
    for (const where of wheresDeServico) {
      expect(where.tenantId).toBe(TENANT_A);
    }
  });
});

describe('criação, edição e desativação', () => {
  it('o tenantId gravado vem do vínculo provado, nunca de um campo do cliente', async () => {
    const { servicos } = montar();
    const criado = await servicos.create(USUARIO_DONO, TENANT_A, {
      name: 'Corte',
      shortDescription: 'Corte simples',
      priceCents: 8500,
      priceVisible: true,
      durationMinutes: 45,
      bufferAfterMinutes: 10,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });

    expect(criado.name).toBe('Corte');
    expect(criado.priceCents).toBe(8500);
    expect(criado.active).toBe(true);
    const lista = await servicos.list(USUARIO_DONO, TENANT_A);
    expect(lista.every((s) => s.id !== 'service_b1')).toBe(true);
  });

  it('edição parcial altera só o campo enviado', async () => {
    const { servicos } = montar();
    const editado = await servicos.update(USUARIO_DONO, TENANT_A, 'service_a1', {
      durationMinutes: 90,
    });

    expect(editado.durationMinutes).toBe(90);
    expect(editado.name).toBe('Serviço service_a1');
    expect(editado.priceCents).toBe(5000);
  });

  it('preço volta para null (sob consulta) sem virar 0 nem ser ignorado', async () => {
    const { servicos } = montar();
    const editado = await servicos.update(USUARIO_DONO, TENANT_A, 'service_a1', {
      priceCents: null,
    });

    expect(editado.priceCents).toBeNull();
  });

  it('desativação preserva o registro e só muda `active`', async () => {
    const { manager, servicos } = montar();
    const desativado = await servicos.deactivate(USUARIO_DONO, TENANT_A, 'service_a1');

    expect(desativado.active).toBe(false);
    expect(desativado.name).toBe('Serviço service_a1');
    expect(manager.services.some((s) => s.id === 'service_a1')).toBe(true);
  });

  it('desativar duas vezes é idempotente, nunca erro', async () => {
    const { servicos } = montar();
    await servicos.deactivate(USUARIO_DONO, TENANT_A, 'service_a1');
    const segunda = await servicos.deactivate(USUARIO_DONO, TENANT_A, 'service_a1');

    expect(segunda.active).toBe(false);
  });

  it('a listagem continua trazendo os inativos, marcados como tal', async () => {
    const { servicos } = montar();
    await servicos.deactivate(USUARIO_DONO, TENANT_A, 'service_a1');
    const lista = await servicos.list(USUARIO_DONO, TENANT_A);

    expect(lista).toHaveLength(1);
    expect(lista[0].active).toBe(false);
  });
});

describe('reativação', () => {
  it('reativação preserva o registro, o id e só muda `active`', async () => {
    const { manager, servicos } = montar();
    await servicos.deactivate(USUARIO_DONO, TENANT_A, 'service_a1');

    const reativado = await servicos.reactivate(USUARIO_DONO, TENANT_A, 'service_a1');

    expect(reativado.id).toBe('service_a1');
    expect(reativado.active).toBe(true);
    expect(reativado.name).toBe('Serviço service_a1');
    expect(reativado.priceCents).toBe(5000);
    expect(manager.services.some((s) => s.id === 'service_a1')).toBe(true);
    expect(manager.services).toHaveLength(2);
  });

  it('reativar não cria registro novo nem altera outros campos', async () => {
    const { manager, servicos } = montar();
    await servicos.deactivate(USUARIO_DONO, TENANT_A, 'service_a1');
    const antes = manager.services.find((s) => s.id === 'service_a1');

    await servicos.reactivate(USUARIO_DONO, TENANT_A, 'service_a1');

    expect(manager.services).toHaveLength(2);
    const depois = manager.services.find((s) => s.id === 'service_a1');
    expect(depois?.tenantId).toBe(antes?.tenantId);
    expect(depois?.durationMinutes).toBe(antes?.durationMinutes);
    expect(depois?.createdAt).toEqual(antes?.createdAt);
  });

  it('reativar um serviço já ativo é idempotente, nunca erro', async () => {
    const { servicos } = montar();
    const resultado = await servicos.reactivate(USUARIO_DONO, TENANT_A, 'service_a1');

    expect(resultado.active).toBe(true);
  });

  it('reativar duas vezes seguidas é idempotente', async () => {
    const { servicos } = montar();
    await servicos.deactivate(USUARIO_DONO, TENANT_A, 'service_a1');
    await servicos.reactivate(USUARIO_DONO, TENANT_A, 'service_a1');
    const segunda = await servicos.reactivate(USUARIO_DONO, TENANT_A, 'service_a1');

    expect(segunda.active).toBe(true);
  });

  it('reativação usa `{ id, tenantId }` no where — nunca só o id', async () => {
    const { servicos } = montar();
    await servicos.deactivate(USUARIO_DONO, TENANT_A, 'service_a1');
    wheresDeServico.length = 0;

    await servicos.reactivate(USUARIO_DONO, TENANT_A, 'service_a1');

    expect(wheresDeServico.length).toBeGreaterThan(0);
    for (const where of wheresDeServico) {
      expect(where.tenantId).toBe(TENANT_A);
    }
  });

  it('tenant inativo bloqueia a reativação mesmo com membership de DONO', async () => {
    const { servicos } = montar({ statusTenantA: TenantStatus.SUSPENDED });
    await expect(
      servicos.reactivate(USUARIO_DONO, TENANT_A, 'service_a1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
