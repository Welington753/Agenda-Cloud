// Integração real dos horários semanais (Lote 6D.3) contra PostgreSQL
// DESCARTÁVEL — nunca Neon, nunca banco existente, nunca `.env` local. Só
// roda com `DB_E2E_DIRECT_URL` definida; o schema é o real, aplicado pelas
// migrations versionadas, e este arquivo nunca cria nem altera tabela.
// `rejectUnauthorized: true` nunca é enfraquecido (o certificado do container
// é confiado via NODE_EXTRA_CA_CERTS).
//
// Prova o que fake em memória não prova: persistência das colunas reais,
// substituição sem sobra, rollback de pedido inválido, isolamento entre
// estabelecimentos e — principalmente — que duas gravações simultâneas do
// mesmo profissional não se misturam.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { BusinessCategory } from '../src/entities/enums/business-category.enum.js';
import { EstablishmentRole } from '../src/entities/enums/establishment-role.enum.js';
import { TenantStatus } from '../src/entities/enums/tenant-status.enum.js';
import { UserStatus } from '../src/entities/enums/user-status.enum.js';
import { Membership } from '../src/entities/membership.entity.js';
import { Plan } from '../src/entities/plan.entity.js';
import { Professional } from '../src/entities/professional.entity.js';
import { ProfessionalSchedule } from '../src/entities/professional-schedule.entity.js';
import { Tenant } from '../src/entities/tenant.entity.js';
import { Unit } from '../src/entities/unit.entity.js';
import { User } from '../src/entities/user.entity.js';
import { ProfessionalsService } from '../src/professionals/professionals.service.js';
import { ProfessionalWorkingHoursService } from '../src/professionals/working-hours.service.js';

const DIRECT_URL = process.env.DB_E2E_DIRECT_URL;

const testDir = path.dirname(fileURLToPath(import.meta.url));

async function carregarEntidades(): Promise<(new () => object)[]> {
  const arquivos = globSync(
    path.join(testDir, '../src/entities/**/*.entity.ts').replaceAll('\\', '/'),
  );
  if (arquivos.length === 0) {
    throw new Error('Nenhuma entidade encontrada — o padrão de arquivos saiu do lugar.');
  }

  const classes: (new () => object)[] = [];
  for (const arquivo of arquivos) {
    const modulo = (await import(pathToFileURL(arquivo).href)) as Record<string, unknown>;
    for (const exportado of Object.values(modulo)) {
      if (typeof exportado === 'function') classes.push(exportado as new () => object);
    }
  }
  return classes;
}

type FuncaoQualquer = (...args: never[]) => unknown;

function ligarMetodo(valor: unknown, alvo: object): unknown {
  return typeof valor === 'function' ? (valor as FuncaoQualquer).bind(alvo) : valor;
}

interface TransacaoCongelada {
  dataSource: DataSource;
  /** Resolve quando a transação já pegou o lock do profissional e está na
   * primeira escrita — ou seja, dentro da janela sob teste. */
  chegou: Promise<void>;
  liberar: () => void;
}

/** Congela a gravação logo DEPOIS do `SELECT ... FOR UPDATE` do profissional
 * e ANTES de apagar/inserir a semana, usando só promises: o teste controla o
 * entrelaçamento, nunca o relógio. */
function congelarNaPrimeiraEscrita(real: DataSource): TransacaoCongelada {
  let sinalizar!: () => void;
  let liberar!: () => void;
  const chegou = new Promise<void>((resolver) => {
    sinalizar = resolver;
  });
  const portao = new Promise<void>((resolver) => {
    liberar = resolver;
  });

  const envolver = (tx: EntityManager): EntityManager => {
    let jaCongelou = false;
    return new Proxy(tx, {
      get(alvo, prop) {
        const valor = Reflect.get(alvo, prop) as unknown;
        const ehEscrita = prop === 'delete' || prop === 'save' || prop === 'remove';
        if (!ehEscrita || typeof valor !== 'function') return ligarMetodo(valor, alvo);

        return async (...args: never[]) => {
          if (!jaCongelou) {
            jaCongelou = true;
            sinalizar();
            await portao;
          }
          return (valor as FuncaoQualquer).apply(alvo, args);
        };
      },
    }) as EntityManager;
  };

  const dataSource = new Proxy(real, {
    get(alvo, prop) {
      if (prop === 'transaction') {
        return (callback: (tx: EntityManager) => Promise<unknown>) =>
          real.transaction((tx) => callback(envolver(tx)));
      }
      return ligarMetodo(Reflect.get(alvo, prop) as unknown, alvo);
    },
  }) as DataSource;

  return { dataSource, chegou, liberar };
}

/** `55P03` = lock_not_available. Resultado observável de "ficou esperando um
 * lock", em vez de medir tempo. */
const LOCK_NAO_DISPONIVEL = '55P03';

function codigoDoErro(erro: unknown): string | undefined {
  if (typeof erro !== 'object' || erro === null) return undefined;
  const comCodigo = erro as { code?: string; driverError?: { code?: string } };
  return comCodigo.code ?? comCodigo.driverError?.code;
}

async function observar(executar: () => Promise<unknown>): Promise<'commitou' | 'bloqueada-por-lock'> {
  try {
    await executar();
    return 'commitou';
  } catch (erro) {
    if (codigoDoErro(erro) === LOCK_NAO_DISPONIVEL) return 'bloqueada-por-lock';
    throw erro;
  }
}

interface Cenario {
  tenantId: string;
  ownerUserId: string;
  professionalId: string;
}

describe.skipIf(!DIRECT_URL)('horários semanais contra PostgreSQL descartável (Lote 6D.3)', () => {
  let dataSource: DataSource;
  /** Conexão separada com `lock_timeout`, só para observar bloqueio. */
  let dataSourceComLockTimeout: DataSource;
  let horarios: ProfessionalWorkingHoursService;
  let horariosComLockTimeout: ProfessionalWorkingHoursService;
  let profissionais: ProfessionalsService;
  let planId: string;
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  async function criarCenario(nome: string, role = EstablishmentRole.DONO): Promise<Cenario> {
    const manager = dataSource.manager;

    const tenant = await manager.save(
      manager.create(Tenant, {
        slug: `e2e-horarios-${nome}-${sufixo}`,
        category: BusinessCategory.OTHER,
        timezone: 'America/Sao_Paulo',
        planId,
        status: TenantStatus.ACTIVE,
      }),
    );
    await manager.save(
      manager.create(Unit, {
        tenantId: tenant.id,
        name: `Unidade ${nome}`,
        address: '',
        timezone: 'America/Sao_Paulo',
        isPrimary: true,
      }),
    );
    const user = await manager.save(
      manager.create(User, {
        name: `Dono ${nome}`,
        email: `dono-horarios-${nome}-${sufixo}@example.test`,
        phone: '+5511900000000',
        status: UserStatus.ACTIVE,
      }),
    );
    await manager.save(
      manager.create(Membership, { userId: user.id, tenantId: tenant.id, role }),
    );

    const profissional = await profissionais.create(user.id, tenant.id, {
      name: `Profissional ${nome}`,
      serviceIds: [],
    });

    return { tenantId: tenant.id, ownerUserId: user.id, professionalId: profissional.id };
  }

  async function linhasDe(professionalId: string): Promise<ProfessionalSchedule[]> {
    return dataSource.manager.find(ProfessionalSchedule, {
      where: { professionalId },
      order: { weekday: 'ASC' },
    });
  }

  beforeAll(async () => {
    const entidades = await carregarEntidades();
    const opcoesBase = buildRuntimeDataSourceOptions(DIRECT_URL as string);

    dataSource = new DataSource({ ...opcoesBase, entities: entidades, logging: ['error'] });
    await dataSource.initialize();

    dataSourceComLockTimeout = new DataSource({
      ...opcoesBase,
      entities: entidades,
      logging: ['error'],
      poolSize: 1,
      extra: { options: '-c lock_timeout=2000' },
    });
    await dataSourceComLockTimeout.initialize();
    const [{ lock_timeout: lockTimeout }] = (await dataSourceComLockTimeout.query(
      'SHOW lock_timeout',
    )) as { lock_timeout: string }[];
    expect(lockTimeout).toBe('2s');

    horarios = new ProfessionalWorkingHoursService(dataSource);
    horariosComLockTimeout = new ProfessionalWorkingHoursService(dataSourceComLockTimeout);
    profissionais = new ProfessionalsService(dataSource);

    const plan = await dataSource.manager.findOne(Plan, { where: { code: 'equipe' } });
    if (!plan) throw new Error('Catálogo de planos ausente — migrations não foram aplicadas.');
    planId = plan.id;
  }, 30_000);

  afterAll(async () => {
    if (dataSourceComLockTimeout?.isInitialized) await dataSourceComLockTimeout.destroy();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('salva a semana e relê com os valores exatos, incluindo a pausa', async () => {
    const cenario = await criarCenario('salvar');

    await horarios.replace(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
      days: [
        {
          weekday: 1,
          intervals: [
            { start: '09:00', end: '12:00' },
            { start: '13:00', end: '18:00' },
          ],
        },
        { weekday: 3, intervals: [{ start: '10:00', end: '16:00' }] },
      ],
    });

    // Releitura pelas COLUNAS reais, não só pelo objeto devolvido.
    const linhas = await linhasDe(cenario.professionalId);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({
      weekday: 1,
      startTime: '09:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
      endTime: '18:00',
      active: true,
      tenantId: cenario.tenantId,
    });
    expect(linhas[1]).toMatchObject({ weekday: 3, startTime: '10:00', endTime: '16:00' });
    expect(linhas[1].lunchStart).toBeNull();

    const semana = await horarios.get(cenario.ownerUserId, cenario.tenantId, cenario.professionalId);
    expect(semana.timezone).toBe('America/Sao_Paulo');
    expect(semana.days).toEqual([
      {
        weekday: 1,
        intervals: [
          { start: '09:00', end: '12:00' },
          { start: '13:00', end: '18:00' },
        ],
      },
      { weekday: 3, intervals: [{ start: '10:00', end: '16:00' }] },
    ]);
  });

  it('sem configuração, a semana vem vazia — nunca "disponível sem restrição"', async () => {
    const cenario = await criarCenario('vazia');
    const semana = await horarios.get(cenario.ownerUserId, cenario.tenantId, cenario.professionalId);

    expect(semana.days).toEqual([]);
    expect(await linhasDe(cenario.professionalId)).toHaveLength(0);
  });

  it('substituir não deixa sobra: dia que saiu do corpo some do banco', async () => {
    const cenario = await criarCenario('substituir');

    await horarios.replace(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
      days: [
        { weekday: 1, intervals: [{ start: '09:00', end: '18:00' }] },
        { weekday: 2, intervals: [{ start: '09:00', end: '18:00' }] },
        { weekday: 5, intervals: [{ start: '09:00', end: '18:00' }] },
      ],
    });
    expect(await linhasDe(cenario.professionalId)).toHaveLength(3);

    await horarios.replace(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
      days: [{ weekday: 2, intervals: [{ start: '08:00', end: '14:00' }] }],
    });

    const linhas = await linhasDe(cenario.professionalId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ weekday: 2, startTime: '08:00', endTime: '14:00' });

    // Semana vazia apaga tudo.
    await horarios.replace(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
      days: [],
    });
    expect(await linhasDe(cenario.professionalId)).toHaveLength(0);
  });

  it('pedido inválido não altera nada: rollback completo, nunca meia semana', async () => {
    const cenario = await criarCenario('rollback');

    await horarios.replace(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
      days: [{ weekday: 1, intervals: [{ start: '09:00', end: '18:00' }] }],
    });

    await expect(
      horarios.replace(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
        days: [
          { weekday: 2, intervals: [{ start: '09:00', end: '12:00' }] },
          { weekday: 3, intervals: [{ start: '18:00', end: '09:00' }] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const linhas = await linhasDe(cenario.professionalId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ weekday: 1, startTime: '09:00', endTime: '18:00' });
  });

  it('isolamento real: profissional de outro estabelecimento é 404 e a semana dele fica intacta', async () => {
    const a = await criarCenario('iso-a');
    const b = await criarCenario('iso-b');

    await horarios.replace(b.ownerUserId, b.tenantId, b.professionalId, {
      days: [{ weekday: 4, intervals: [{ start: '07:00', end: '11:00' }] }],
    });

    await expect(
      horarios.get(a.ownerUserId, a.tenantId, b.professionalId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      horarios.replace(a.ownerUserId, a.tenantId, b.professionalId, { days: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      horarios.get(a.ownerUserId, b.tenantId, b.professionalId),
    ).rejects.toBeInstanceOf(NotFoundException);

    const linhas = await linhasDe(b.professionalId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ weekday: 4, startTime: '07:00', tenantId: b.tenantId });
  });

  it('gravação concorrente do mesmo profissional é serializada pelo lock', async () => {
    const cenario = await criarCenario('lock');

    const congelada = congelarNaPrimeiraEscrita(dataSource);
    const primeira = new ProfessionalWorkingHoursService(congelada.dataSource).replace(
      cenario.ownerUserId,
      cenario.tenantId,
      cenario.professionalId,
      { days: [{ weekday: 1, intervals: [{ start: '09:00', end: '18:00' }] }] },
    );

    // A primeira já pegou `FOR UPDATE` no profissional e está prestes a
    // reescrever a semana.
    await congelada.chegou;

    const segunda = await observar(() =>
      horariosComLockTimeout.replace(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
        days: [{ weekday: 5, intervals: [{ start: '08:00', end: '12:00' }] }],
      }),
    );
    expect(segunda).toBe('bloqueada-por-lock');

    congelada.liberar();
    await primeira;

    // Nada da segunda entrou: a semana é inteira da primeira.
    const linhas = await linhasDe(cenario.professionalId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ weekday: 1, startTime: '09:00', endTime: '18:00' });
  });

  it('duas semanas gravadas em paralelo: o resultado é uma delas inteira, nunca uma mistura', async () => {
    const cenario = await criarCenario('sem-mistura');

    const semanaA = [
      { weekday: 1, intervals: [{ start: '09:00', end: '12:00' }] },
      { weekday: 2, intervals: [{ start: '09:00', end: '12:00' }] },
      { weekday: 3, intervals: [{ start: '09:00', end: '12:00' }] },
    ];
    const semanaB = [
      { weekday: 4, intervals: [{ start: '14:00', end: '20:00' }] },
      { weekday: 5, intervals: [{ start: '14:00', end: '20:00' }] },
    ];

    const congelada = congelarNaPrimeiraEscrita(dataSource);
    const gravacaoA = new ProfessionalWorkingHoursService(congelada.dataSource).replace(
      cenario.ownerUserId,
      cenario.tenantId,
      cenario.professionalId,
      { days: semanaA },
    );

    await congelada.chegou;

    // B entra enquanto A está congelada segurando o lock; B fica esperando
    // (conexão sem lock_timeout), então só avança depois que A commita.
    const gravacaoB = horarios.replace(
      cenario.ownerUserId,
      cenario.tenantId,
      cenario.professionalId,
      { days: semanaB },
    );

    congelada.liberar();
    await gravacaoA;
    await gravacaoB;

    const linhas = await linhasDe(cenario.professionalId);
    const dias = linhas.map((l) => l.weekday);

    // O ponto do teste: nada de "1,2,4" ou "3,5". Ou é exatamente a semana de
    // A, ou exatamente a de B — e como B commitou por último, é a de B
    // ("última gravação vence", sem detecção de formulário desatualizado).
    expect(dias).toEqual([4, 5]);
    expect(linhas.every((l) => l.startTime === '14:00' && l.endTime === '20:00')).toBe(true);
  });

  it('configurar horários não cria nem apaga nada fora de professional_schedules', async () => {
    const cenario = await criarCenario('escopo');

    const profissionaisAntes = await dataSource.manager.count(Professional, {
      where: { tenantId: cenario.tenantId },
    });

    await horarios.replace(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
      days: [{ weekday: 6, intervals: [{ start: '09:00', end: '13:00' }] }],
    });

    expect(
      await dataSource.manager.count(Professional, { where: { tenantId: cenario.tenantId } }),
    ).toBe(profissionaisAntes);
    const profissional = await dataSource.manager.findOne(Professional, {
      where: { id: cenario.professionalId },
    });
    expect(profissional?.active).toBe(true);
  });

  it('papel sem permissão não lê nem grava horário, mesmo com vínculo ativo', async () => {
    const gerente = await criarCenario('gerente', EstablishmentRole.DONO);
    // Rebaixa o papel depois de criar o profissional (a criação exige DONO).
    await dataSource.manager.update(
      Membership,
      { userId: gerente.ownerUserId, tenantId: gerente.tenantId },
      { role: EstablishmentRole.GERENTE },
    );

    await expect(
      horarios.get(gerente.ownerUserId, gerente.tenantId, gerente.professionalId),
    ).rejects.toThrow();
    await expect(
      horarios.replace(gerente.ownerUserId, gerente.tenantId, gerente.professionalId, { days: [] }),
    ).rejects.toThrow();
  });
});
