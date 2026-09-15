// Testes de autorização, isolamento e regras de vínculo do
// `ProfessionalsService` contra um `DataSource` falso, em memória — mesmo
// padrão de services/services.service.spec.ts. O ponto NÃO é o SQL (isso é
// coberto contra Postgres descartável em
// test/professionals-postgres.db-e2e-spec.ts) e sim a decisão: quem pode, o
// que é alcançável, e que nenhuma gravação parcial acontece quando a seleção
// de serviços tem algo inválido.
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { FindOperator } from 'typeorm';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { Membership } from '../entities/membership.entity.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import { Professional } from '../entities/professional.entity.js';
import { ProfessionalService } from '../entities/professional-service.entity.js';
import { Service } from '../entities/service.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { ProfessionalsService } from './professionals.service.js';

interface Registro {
  [campo: string]: unknown;
}

let contadorId = 0;
function proximoId(prefixo: string): string {
  contadorId += 1;
  return `${prefixo}_gerado_${contadorId}`;
}

class FakeManager {
  constructor(
    public tenants: Registro[],
    public memberships: Registro[],
    public overrides: Registro[],
    public services: Registro[],
    public professionals: Registro[],
    public links: Registro[],
  ) {}

  private colecaoDe(entity: unknown): Registro[] {
    if (entity === Tenant) return this.tenants;
    if (entity === Membership) return this.memberships;
    if (entity === MembershipPermissionOverride) return this.overrides;
    if (entity === Service) return this.services;
    if (entity === Professional) return this.professionals;
    if (entity === ProfessionalService) return this.links;
    throw new Error('Entidade inesperada no teste');
  }

  private casaValor(valor: unknown, esperado: unknown): boolean {
    if (esperado instanceof FindOperator) {
      if (esperado.type === 'in') return (esperado.value as unknown[]).includes(valor);
      throw new Error(`Operador não suportado no fake: ${esperado.type}`);
    }
    return valor === esperado;
  }

  private casa(linha: Registro, where: Registro): boolean {
    return Object.entries(where).every(([campo, esperado]) => this.casaValor(linha[campo], esperado));
  }

  findOne(entity: unknown, options: { where: Registro }): Promise<Registro | null> {
    return Promise.resolve(this.colecaoDe(entity).find((l) => this.casa(l, options.where)) ?? null);
  }

  find(entity: unknown, options: { where: Registro }): Promise<Registro[]> {
    return Promise.resolve(this.colecaoDe(entity).filter((l) => this.casa(l, options.where)));
  }

  create(entity: unknown, dados: Registro): Registro {
    void entity;
    return { ...dados };
  }

  private salvarUm(entity: unknown, linha: Registro): Registro {
    const colecao = this.colecaoDe(entity);
    const alvo = linha.id ? colecao.find((l) => l.id === linha.id) : undefined;
    if (alvo) {
      Object.assign(alvo, linha);
      return alvo;
    }
    const prefixo = entity === Professional ? 'professional' : 'link';
    const criado = { ...linha, id: linha.id ?? proximoId(prefixo), createdAt: new Date() };
    colecao.push(criado);
    return criado;
  }

  /** `manager.save` real aceita `save(objeto)`, `save(arrayDeObjetos)` e
   * `save(Entity, dados)` — o código de produção só usa os dois primeiros
   * (sempre via `tx.create(Entity, dados)` antes), então a classe nunca
   * chega aqui: este fake infere a coleção pelo formato do objeto
   * (`professionalId`+`serviceId` sem `name` = vínculo; senão, profissional). */
  save(entityOuDados: unknown, dadosSeDuasArgs?: Registro | Registro[]): Promise<unknown> {
    if (dadosSeDuasArgs !== undefined) {
      if (Array.isArray(dadosSeDuasArgs)) {
        return Promise.resolve(dadosSeDuasArgs.map((l) => this.salvarUm(entityOuDados, l)));
      }
      return Promise.resolve(this.salvarUm(entityOuDados, dadosSeDuasArgs));
    }
    if (Array.isArray(entityOuDados)) {
      return Promise.resolve(
        (entityOuDados as Registro[]).map((l) => this.salvarUm(this.inferirEntidade(l), l)),
      );
    }
    const objeto = entityOuDados as Registro;
    return Promise.resolve(this.salvarUm(this.inferirEntidade(objeto), objeto));
  }

  private inferirEntidade(objeto: Registro): unknown {
    if ('professionalId' in objeto && 'serviceId' in objeto && !('name' in objeto)) {
      return ProfessionalService;
    }
    return Professional;
  }

  remove(linhas: Registro[]): Promise<Registro[]> {
    for (const linha of linhas) {
      const indice = this.links.findIndex((l) => l.id === linha.id);
      if (indice >= 0) this.links.splice(indice, 1);
    }
    return Promise.resolve(linhas);
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
    active: true,
    ...extra,
  };
}

function profissional(id: string, tenantId: string, extra: Registro = {}): Registro {
  return {
    id,
    tenantId,
    name: `Profissional ${id}`,
    avatarInitials: 'PX',
    avatarColor: '#000000',
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
  professionaisExtra?: Registro[];
  servicosExtra?: Registro[];
  linksExtra?: Registro[];
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
    [
      servico('service_a1', TENANT_A),
      servico('service_a2', TENANT_A),
      servico('service_a_inativo', TENANT_A, { active: false }),
      servico('service_b1', TENANT_B),
      ...(opcoes.servicosExtra ?? []),
    ],
    [profissional('prof_a1', TENANT_A), ...(opcoes.professionaisExtra ?? [])],
    opcoes.linksExtra ?? [],
  );

  const fakeDataSource = {
    manager,
    transaction: (cb: (manager: FakeManager) => Promise<unknown>) => cb(manager),
  } as unknown as DataSource;

  return { manager, profissionais: new ProfessionalsService(fakeDataSource) };
}

beforeEach(() => {
  contadorId = 0;
});

describe('autorização por requisição', () => {
  it('sem vínculo com o estabelecimento: 404, nunca 403', async () => {
    const { profissionais } = montar({ semMembership: true });
    await expect(profissionais.list(USUARIO_DONO, TENANT_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('vínculo em outro estabelecimento não autoriza o pedido', async () => {
    const { profissionais } = montar();
    await expect(profissionais.list(USUARIO_DONO, TENANT_B)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([TenantStatus.SUSPENDED, TenantStatus.PAST_DUE, TenantStatus.CANCELED])(
    'tenant %s é inutilizável mesmo com vínculo válido',
    async (status) => {
      const { profissionais } = montar({ statusTenantA: status });
      await expect(profissionais.list(USUARIO_DONO, TENANT_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it.each([
    EstablishmentRole.GERENTE,
    EstablishmentRole.RECEPCIONISTA,
    EstablishmentRole.PROFISSIONAL,
  ])('%s com vínculo ativo recebe 403 — vínculo não é permissão', async (role) => {
    const { profissionais } = montar({ role });
    await expect(profissionais.list(USUARIO_DONO, TENANT_A)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('DONO com DENIED em PROFISSIONAIS_GERENCIAR lê, mas não cria', async () => {
    const { profissionais } = montar({
      overrides: [
        {
          tenantId: TENANT_A,
          membershipId: 'membership_a',
          permission: Permission.PROFISSIONAIS_GERENCIAR,
          mode: PermissionMode.DENIED,
        },
      ],
    });

    await expect(profissionais.list(USUARIO_DONO, TENANT_A)).resolves.toHaveLength(1);
    await expect(
      profissionais.create(USUARIO_DONO, TENANT_A, { name: 'Novo', serviceIds: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('isolamento entre estabelecimentos', () => {
  it('a listagem só devolve profissionais do tenant autorizado', async () => {
    const { profissionais } = montar();
    const lista = await profissionais.list(USUARIO_DONO, TENANT_A);
    expect(lista.map((p) => p.id)).toEqual(['prof_a1']);
  });

  it('um professionalId de outro estabelecimento é 404, nunca editável', async () => {
    const { profissionais } = montar({
      professionaisExtra: [profissional('prof_b1', TENANT_B)],
    });
    await expect(
      profissionais.update(USUARIO_DONO, TENANT_A, 'prof_b1', { name: 'Invadido' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      profissionais.deactivate(USUARIO_DONO, TENANT_A, 'prof_b1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      profissionais.setServices(USUARIO_DONO, TENANT_A, 'prof_b1', { serviceIds: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('não é possível vincular serviço de outro tenant', async () => {
    const { profissionais, manager } = montar();
    await expect(
      profissionais.setServices(USUARIO_DONO, TENANT_A, 'prof_a1', {
        serviceIds: ['service_b1'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.links).toHaveLength(0);
  });
});

describe('criação com serviços', () => {
  it('cria o profissional e os vínculos juntos, iniciais/cor derivadas do nome', async () => {
    const { profissionais } = montar();
    const criado = await profissionais.create(USUARIO_DONO, TENANT_A, {
      name: 'João Silva',
      serviceIds: ['service_a1', 'service_a2'],
    });

    expect(criado.name).toBe('João Silva');
    expect(criado.avatarInitials).toBe('JS');
    expect(criado.active).toBe(true);
    expect(criado.services.map((s) => s.serviceId).sort()).toEqual(['service_a1', 'service_a2']);
  });

  it('serviço inexistente, inativo ou de outro tenant rejeita a criação inteira — nada é gravado', async () => {
    const { profissionais, manager } = montar();

    await expect(
      profissionais.create(USUARIO_DONO, TENANT_A, {
        name: 'Rejeitado',
        serviceIds: ['service_a1', 'service_inexistente'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      profissionais.create(USUARIO_DONO, TENANT_A, {
        name: 'Rejeitado',
        serviceIds: ['service_a_inativo'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      profissionais.create(USUARIO_DONO, TENANT_A, {
        name: 'Rejeitado',
        serviceIds: ['service_b1'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(manager.professionals).toHaveLength(1); // só o `prof_a1` da fixture
    expect(manager.links).toHaveLength(0);
  });

  it('cadastro sem serviço nenhum é permitido', async () => {
    const { profissionais } = montar();
    const criado = await profissionais.create(USUARIO_DONO, TENANT_A, {
      name: 'Sem serviços',
      serviceIds: [],
    });
    expect(criado.services).toEqual([]);
  });
});

describe('vínculos de serviço (setServices)', () => {
  it('adiciona vínculos novos elegíveis', async () => {
    const { profissionais } = montar();
    const resultado = await profissionais.setServices(USUARIO_DONO, TENANT_A, 'prof_a1', {
      serviceIds: ['service_a1', 'service_a2'],
    });
    expect(resultado.services.map((s) => s.serviceId).sort()).toEqual(['service_a1', 'service_a2']);
  });

  it('remove vínculos que saem do conjunto pedido', async () => {
    const { profissionais } = montar({
      linksExtra: [{ id: 'link_1', tenantId: TENANT_A, professionalId: 'prof_a1', serviceId: 'service_a1' }],
    });
    const resultado = await profissionais.setServices(USUARIO_DONO, TENANT_A, 'prof_a1', {
      serviceIds: [],
    });
    expect(resultado.services).toEqual([]);
  });

  it('vínculo existente com serviço agora inativo continua visível, marcado como inativo, se mantido na seleção', async () => {
    const { profissionais } = montar({
      linksExtra: [
        { id: 'link_1', tenantId: TENANT_A, professionalId: 'prof_a1', serviceId: 'service_a_inativo' },
      ],
    });
    // Mantém o vínculo existente (não é um vínculo NOVO) e ainda adiciona um novo ativo.
    const resultado = await profissionais.setServices(USUARIO_DONO, TENANT_A, 'prof_a1', {
      serviceIds: ['service_a_inativo', 'service_a1'],
    });

    const inativo = resultado.services.find((s) => s.serviceId === 'service_a_inativo');
    expect(inativo).toBeDefined();
    expect(inativo?.serviceActive).toBe(false);
    expect(resultado.services.some((s) => s.serviceId === 'service_a1')).toBe(true);
  });

  it('não permite vincular um serviço NOVO que está inativo', async () => {
    const { profissionais, manager } = montar();
    await expect(
      profissionais.setServices(USUARIO_DONO, TENANT_A, 'prof_a1', {
        serviceIds: ['service_a_inativo'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.links).toHaveLength(0);
  });

  it('ids duplicados no pedido nunca geram vínculo duplicado', async () => {
    const { profissionais, manager } = montar();
    await profissionais.setServices(USUARIO_DONO, TENANT_A, 'prof_a1', {
      serviceIds: ['service_a1', 'service_a1', 'service_a1'],
    });
    expect(manager.links.filter((l) => l.serviceId === 'service_a1')).toHaveLength(1);
  });

  it('pedir de novo o mesmo conjunto já vinculado não duplica nem recria linhas', async () => {
    const { profissionais, manager } = montar();
    await profissionais.setServices(USUARIO_DONO, TENANT_A, 'prof_a1', {
      serviceIds: ['service_a1'],
    });
    const linkOriginal = manager.links.find((l) => l.serviceId === 'service_a1');

    await profissionais.setServices(USUARIO_DONO, TENANT_A, 'prof_a1', {
      serviceIds: ['service_a1'],
    });

    expect(manager.links.filter((l) => l.serviceId === 'service_a1')).toHaveLength(1);
    expect(manager.links.find((l) => l.serviceId === 'service_a1')?.id).toBe(linkOriginal?.id);
  });
});

describe('desativação e reativação preservam vínculos', () => {
  it('desativar o profissional não remove os vínculos de serviço', async () => {
    const { profissionais, manager } = montar({
      linksExtra: [{ id: 'link_1', tenantId: TENANT_A, professionalId: 'prof_a1', serviceId: 'service_a1' }],
    });

    const desativado = await profissionais.deactivate(USUARIO_DONO, TENANT_A, 'prof_a1');
    expect(desativado.active).toBe(false);
    expect(manager.links).toHaveLength(1);
    expect(desativado.services.map((s) => s.serviceId)).toEqual(['service_a1']);
  });

  it('reativar devolve o mesmo profissional com os mesmos vínculos, sem recriar nada', async () => {
    const { profissionais, manager } = montar({
      linksExtra: [{ id: 'link_1', tenantId: TENANT_A, professionalId: 'prof_a1', serviceId: 'service_a1' }],
    });

    await profissionais.deactivate(USUARIO_DONO, TENANT_A, 'prof_a1');
    const reativado = await profissionais.reactivate(USUARIO_DONO, TENANT_A, 'prof_a1');

    expect(reativado.active).toBe(true);
    expect(reativado.id).toBe('prof_a1');
    expect(manager.links).toHaveLength(1);
    expect(manager.professionals).toHaveLength(1);
  });

  it('desativar/reativar são idempotentes', async () => {
    const { profissionais } = montar();
    await profissionais.deactivate(USUARIO_DONO, TENANT_A, 'prof_a1');
    const segunda = await profissionais.deactivate(USUARIO_DONO, TENANT_A, 'prof_a1');
    expect(segunda.active).toBe(false);

    await profissionais.reactivate(USUARIO_DONO, TENANT_A, 'prof_a1');
    const segundaReativacao = await profissionais.reactivate(USUARIO_DONO, TENANT_A, 'prof_a1');
    expect(segundaReativacao.active).toBe(true);
  });
});

describe('edição', () => {
  it('editar o nome recalcula iniciais e cor do avatar', async () => {
    const { profissionais } = montar();
    const editado = await profissionais.update(USUARIO_DONO, TENANT_A, 'prof_a1', {
      name: 'Maria Eduarda Costa',
    });
    expect(editado.name).toBe('Maria Eduarda Costa');
    expect(editado.avatarInitials).toBe('MC');
  });
});
