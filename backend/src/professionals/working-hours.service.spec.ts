// Autorização, isolamento e semântica de substituição do
// `ProfessionalWorkingHoursService` contra um `DataSource` falso, em memória
// — mesmo padrão de professionals.service.spec.ts. Persistência real,
// constraints e concorrência ficam em
// test/professional-working-hours-postgres.db-e2e-spec.ts.
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { Membership } from '../entities/membership.entity.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import { Professional } from '../entities/professional.entity.js';
import { ProfessionalSchedule } from '../entities/professional-schedule.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { ProfessionalWorkingHoursService } from './working-hours.service.js';

interface Registro {
  [campo: string]: unknown;
}

const USUARIO_DONO = 'user_dono';
const TENANT_A = 'tenant_a';
const TENANT_B = 'tenant_b';
const FUSO_A = 'America/Sao_Paulo';
const PROF_A = 'prof_a1';

let contador = 0;

class FakeManager {
  constructor(
    public tenants: Registro[],
    public memberships: Registro[],
    public overrides: Registro[],
    public professionals: Registro[],
    public schedules: Registro[],
  ) {}

  private colecaoDe(entity: unknown): Registro[] {
    if (entity === Tenant) return this.tenants;
    if (entity === Membership) return this.memberships;
    if (entity === MembershipPermissionOverride) return this.overrides;
    if (entity === Professional) return this.professionals;
    if (entity === ProfessionalSchedule) return this.schedules;
    throw new Error('Entidade inesperada no teste');
  }

  private casa(linha: Registro, where: Registro): boolean {
    return Object.entries(where).every(([campo, valor]) => linha[campo] === valor);
  }

  findOne(entity: unknown, options: { where: Registro }): Promise<Registro | null> {
    return Promise.resolve(this.colecaoDe(entity).find((l) => this.casa(l, options.where)) ?? null);
  }

  find(entity: unknown, options: { where: Registro }): Promise<Registro[]> {
    return Promise.resolve(this.colecaoDe(entity).filter((l) => this.casa(l, options.where)));
  }

  create(_entity: unknown, dados: Registro): Registro {
    return { ...dados };
  }

  save(linhas: Registro | Registro[]): Promise<unknown> {
    const lista = Array.isArray(linhas) ? linhas : [linhas];
    const salvos = lista.map((linha) => {
      contador += 1;
      const criado = { ...linha, id: linha.id ?? `schedule_${contador}` };
      this.schedules.push(criado);
      return criado;
    });
    return Promise.resolve(Array.isArray(linhas) ? salvos : salvos[0]);
  }

  delete(entity: unknown, criterio: Registro): Promise<unknown> {
    const colecao = this.colecaoDe(entity);
    for (let i = colecao.length - 1; i >= 0; i -= 1) {
      if (this.casa(colecao[i], criterio)) colecao.splice(i, 1);
    }
    return Promise.resolve({ affected: 0 });
  }
}

function linhaDeHorario(weekday: number, extra: Registro = {}): Registro {
  return {
    id: `schedule_fixo_${weekday}`,
    tenantId: TENANT_A,
    professionalId: PROF_A,
    weekday,
    active: true,
    startTime: '09:00',
    endTime: '18:00',
    lunchStart: undefined,
    lunchEnd: undefined,
    ...extra,
  };
}

function montar(
  opcoes: {
    role?: EstablishmentRole;
    statusTenantA?: TenantStatus;
    semMembership?: boolean;
    overrides?: Registro[];
    professionaisExtra?: Registro[];
    horarios?: Registro[];
  } = {},
) {
  const manager = new FakeManager(
    [
      { id: TENANT_A, status: opcoes.statusTenantA ?? TenantStatus.ACTIVE, timezone: FUSO_A },
      { id: TENANT_B, status: TenantStatus.ACTIVE, timezone: 'Europe/Lisbon' },
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
      { id: PROF_A, tenantId: TENANT_A, name: 'Ana', active: true },
      ...(opcoes.professionaisExtra ?? []),
    ],
    opcoes.horarios ?? [],
  );

  const dataSource = {
    manager,
    transaction: (cb: (m: FakeManager) => Promise<unknown>) => cb(manager),
  } as unknown as DataSource;

  return { manager, horarios: new ProfessionalWorkingHoursService(dataSource) };
}

beforeEach(() => {
  contador = 0;
});

describe('autorização por requisição', () => {
  it('sem vínculo com o estabelecimento: 404, nunca 403', async () => {
    const { horarios } = montar({ semMembership: true });
    await expect(horarios.get(USUARIO_DONO, TENANT_A, PROF_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('pedir o tenant do vizinho não autoriza nada', async () => {
    const { horarios } = montar();
    await expect(horarios.get(USUARIO_DONO, TENANT_B, PROF_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([TenantStatus.SUSPENDED, TenantStatus.PAST_DUE, TenantStatus.CANCELED])(
    'tenant %s é inutilizável mesmo com vínculo de DONO',
    async (status) => {
      const { horarios } = montar({ statusTenantA: status });
      await expect(horarios.get(USUARIO_DONO, TENANT_A, PROF_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it.each([
    EstablishmentRole.GERENTE,
    EstablishmentRole.RECEPCIONISTA,
    EstablishmentRole.PROFISSIONAL,
  ])('%s com vínculo ativo recebe 403 — vínculo não é permissão', async (role) => {
    const { horarios } = montar({ role });
    await expect(horarios.get(USUARIO_DONO, TENANT_A, PROF_A)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('DENIED em PROFISSIONAIS_GERENCIAR lê, mas não grava', async () => {
    const { horarios } = montar({
      overrides: [
        {
          tenantId: TENANT_A,
          membershipId: 'membership_a',
          permission: Permission.PROFISSIONAIS_GERENCIAR,
          mode: PermissionMode.DENIED,
        },
      ],
    });

    await expect(horarios.get(USUARIO_DONO, TENANT_A, PROF_A)).resolves.toMatchObject({ days: [] });
    await expect(
      horarios.replace(USUARIO_DONO, TENANT_A, PROF_A, {
        days: [{ weekday: 1, intervals: [{ start: '09:00', end: '18:00' }] }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('DENIED em PROFISSIONAIS_VISUALIZAR fecha as duas pontas', async () => {
    const { horarios } = montar({
      overrides: [
        {
          tenantId: TENANT_A,
          membershipId: 'membership_a',
          permission: Permission.PROFISSIONAIS_VISUALIZAR,
          mode: PermissionMode.DENIED,
        },
      ],
    });

    await expect(horarios.get(USUARIO_DONO, TENANT_A, PROF_A)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('profissional de outro estabelecimento é 404, nunca editável', async () => {
    const { horarios, manager } = montar({
      professionaisExtra: [{ id: 'prof_b1', tenantId: TENANT_B, name: 'De B', active: true }],
    });

    await expect(horarios.get(USUARIO_DONO, TENANT_A, 'prof_b1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      horarios.replace(USUARIO_DONO, TENANT_A, 'prof_b1', {
        days: [{ weekday: 1, intervals: [{ start: '09:00', end: '18:00' }] }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.schedules).toHaveLength(0);
  });
});

describe('leitura', () => {
  it('devolve o fuso do estabelecimento, lido do tenant — nunca um padrão inventado', async () => {
    const { horarios } = montar();
    await expect(horarios.get(USUARIO_DONO, TENANT_A, PROF_A)).resolves.toMatchObject({
      timezone: FUSO_A,
    });
  });

  it('sem configuração nenhuma devolve semana vazia (não atende), nunca "sempre disponível"', async () => {
    const { horarios } = montar();
    const semana = await horarios.get(USUARIO_DONO, TENANT_A, PROF_A);
    expect(semana.days).toEqual([]);
  });

  it('linha inativa conta como dia sem atendimento', async () => {
    const { horarios } = montar({ horarios: [linhaDeHorario(1, { active: false })] });
    const semana = await horarios.get(USUARIO_DONO, TENANT_A, PROF_A);
    expect(semana.days).toEqual([]);
  });

  it('linha com pausa vira dois intervalos, em ordem', async () => {
    const { horarios } = montar({
      horarios: [linhaDeHorario(3, { lunchStart: '12:00', lunchEnd: '13:00' })],
    });

    const semana = await horarios.get(USUARIO_DONO, TENANT_A, PROF_A);
    expect(semana.days).toEqual([
      {
        weekday: 3,
        intervals: [
          { start: '09:00', end: '12:00' },
          { start: '13:00', end: '18:00' },
        ],
      },
    ]);
  });

  it('dias saem ordenados de forma determinística', async () => {
    const { horarios } = montar({
      horarios: [linhaDeHorario(5), linhaDeHorario(1), linhaDeHorario(3)],
    });

    const semana = await horarios.get(USUARIO_DONO, TENANT_A, PROF_A);
    expect(semana.days.map((d) => d.weekday)).toEqual([1, 3, 5]);
  });
});

describe('gravação substitui a semana inteira', () => {
  it('grava manhã e tarde como uma linha com pausa', async () => {
    const { horarios, manager } = montar();

    const semana = await horarios.replace(USUARIO_DONO, TENANT_A, PROF_A, {
      days: [
        {
          weekday: 1,
          intervals: [
            { start: '09:00', end: '12:00' },
            { start: '13:00', end: '18:00' },
          ],
        },
      ],
    });

    expect(manager.schedules).toHaveLength(1);
    expect(manager.schedules[0]).toMatchObject({
      weekday: 1,
      startTime: '09:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
      endTime: '18:00',
      active: true,
      tenantId: TENANT_A,
    });
    expect(semana.days[0].intervals).toHaveLength(2);
  });

  it('dia que sai do corpo deixa de existir — substituição, não mesclagem', async () => {
    const { horarios, manager } = montar({ horarios: [linhaDeHorario(1), linhaDeHorario(2)] });

    await horarios.replace(USUARIO_DONO, TENANT_A, PROF_A, {
      days: [{ weekday: 2, intervals: [{ start: '10:00', end: '16:00' }] }],
    });

    expect(manager.schedules).toHaveLength(1);
    expect(manager.schedules[0]).toMatchObject({ weekday: 2, startTime: '10:00' });
  });

  it('semana vazia apaga tudo: não atende em nenhum dia', async () => {
    const { horarios, manager } = montar({ horarios: [linhaDeHorario(1), linhaDeHorario(4)] });

    const semana = await horarios.replace(USUARIO_DONO, TENANT_A, PROF_A, { days: [] });

    expect(manager.schedules).toHaveLength(0);
    expect(semana.days).toEqual([]);
  });

  it('dia com lista vazia de intervalos é dia sem atendimento', async () => {
    const { horarios, manager } = montar({ horarios: [linhaDeHorario(1)] });

    await horarios.replace(USUARIO_DONO, TENANT_A, PROF_A, {
      days: [{ weekday: 1, intervals: [] }],
    });

    expect(manager.schedules).toHaveLength(0);
  });

  it('entrada inválida recusa o pedido inteiro, sem alterar a semana atual', async () => {
    const { horarios, manager } = montar({ horarios: [linhaDeHorario(1)] });

    await expect(
      horarios.replace(USUARIO_DONO, TENANT_A, PROF_A, {
        days: [
          { weekday: 2, intervals: [{ start: '09:00', end: '18:00' }] },
          { weekday: 3, intervals: [{ start: '18:00', end: '09:00' }] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A semana anterior continua exatamente como estava.
    expect(manager.schedules).toHaveLength(1);
    expect(manager.schedules[0]).toMatchObject({ weekday: 1, startTime: '09:00' });
  });

  it('sobreposição recusa com mensagem que nomeia o dia', async () => {
    const { horarios } = montar();

    await expect(
      horarios.replace(USUARIO_DONO, TENANT_A, PROF_A, {
        days: [
          {
            weekday: 2,
            intervals: [
              { start: '09:00', end: '13:00' },
              { start: '12:00', end: '18:00' },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/terça-feira/);
  });

  it('intervalos adjacentes são aceitos e gravados como período contínuo', async () => {
    const { horarios, manager } = montar();

    await horarios.replace(USUARIO_DONO, TENANT_A, PROF_A, {
      days: [
        {
          weekday: 1,
          intervals: [
            { start: '09:00', end: '12:00' },
            { start: '12:00', end: '18:00' },
          ],
        },
      ],
    });

    expect(manager.schedules).toHaveLength(1);
    expect(manager.schedules[0]).toMatchObject({
      startTime: '09:00',
      endTime: '18:00',
      lunchStart: undefined,
      lunchEnd: undefined,
    });
  });
});
