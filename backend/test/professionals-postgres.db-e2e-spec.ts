// Integração real do Lote 6D.2 contra um PostgreSQL DESCARTÁVEL (nunca Neon,
// nunca banco existente, nunca `.env` local) — mesmo padrão de
// test/services-postgres.db-e2e-spec.ts. Prova o que um fake em memória não
// consegue provar: que a constraint única
// `uq_professional_services_tenant_professional_service` e as FKs compostas
// se comportam como o isolamento e a proteção contra duplicata exigem.
//
// Só roda quando `DB_E2E_DIRECT_URL` está definida. O schema é o real,
// aplicado pelas migrations versionadas; este arquivo nunca cria nem altera
// tabela.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { BusinessCategory } from '../src/entities/enums/business-category.enum.js';
import { EstablishmentRole } from '../src/entities/enums/establishment-role.enum.js';
import { Permission } from '../src/entities/enums/permission.enum.js';
import { PermissionMode } from '../src/entities/enums/permission-mode.enum.js';
import { ServiceModality } from '../src/entities/enums/service-modality.enum.js';
import { TenantStatus } from '../src/entities/enums/tenant-status.enum.js';
import { UserStatus } from '../src/entities/enums/user-status.enum.js';
import { Membership } from '../src/entities/membership.entity.js';
import { MembershipPermissionOverride } from '../src/entities/membership-permission-override.entity.js';
import { Plan } from '../src/entities/plan.entity.js';
import { Professional } from '../src/entities/professional.entity.js';
import { ProfessionalService } from '../src/entities/professional-service.entity.js';
import { Service } from '../src/entities/service.entity.js';
import { Tenant } from '../src/entities/tenant.entity.js';
import { Unit } from '../src/entities/unit.entity.js';
import { User } from '../src/entities/user.entity.js';
import { ProfessionalsService } from '../src/professionals/professionals.service.js';

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

interface Cenario {
  tenantId: string;
  ownerUserId: string;
  membershipId: string;
}

describe.skipIf(!DIRECT_URL)('profissionais contra PostgreSQL descartável (Lote 6D.2)', () => {
  let dataSource: DataSource;
  let profissionais: ProfessionalsService;
  let planId: string;
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  async function criarCenario(
    nome: string,
    status = TenantStatus.ACTIVE,
    role = EstablishmentRole.DONO,
  ): Promise<Cenario> {
    const manager = dataSource.manager;

    const tenant = await manager.save(
      manager.create(Tenant, {
        slug: `e2e-prof-${nome}-${sufixo}`,
        category: BusinessCategory.OTHER,
        timezone: 'America/Sao_Paulo',
        planId,
        status,
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
        email: `dono-prof-${nome}-${sufixo}@example.test`,
        phone: `+5511900000000`,
        status: UserStatus.ACTIVE,
      }),
    );
    const membership = await manager.save(
      manager.create(Membership, { userId: user.id, tenantId: tenant.id, role }),
    );

    return { tenantId: tenant.id, ownerUserId: user.id, membershipId: membership.id };
  }

  async function criarServico(tenantId: string, nome: string, ativo = true) {
    return dataSource.manager.save(
      dataSource.manager.create(Service, {
        tenantId,
        name: nome,
        shortDescription: '',
        priceCents: null,
        priceVisible: true,
        durationMinutes: 30,
        bufferAfterMinutes: 0,
        modality: ServiceModality.IN_PERSON,
        activeInPublicBooking: true,
        requiresManualConfirmation: false,
        active: ativo,
      }),
    );
  }

  beforeAll(async () => {
    const entidades = await carregarEntidades();
    dataSource = new DataSource({
      ...buildRuntimeDataSourceOptions(DIRECT_URL as string),
      entities: entidades,
      logging: ['error'],
    });
    await dataSource.initialize();
    profissionais = new ProfessionalsService(dataSource);

    const plan = await dataSource.manager.findOne(Plan, { where: { code: 'equipe' } });
    if (!plan) throw new Error('Catálogo de planos ausente — migrations não foram aplicadas.');
    planId = plan.id;
  }, 30_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('cria o profissional e os vínculos de serviço na mesma transação, persistidos de verdade', async () => {
    const cenario = await criarCenario('criar');
    const servico1 = await criarServico(cenario.tenantId, 'Corte');
    const servico2 = await criarServico(cenario.tenantId, 'Barba');

    const criado = await profissionais.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'João Silva',
      serviceIds: [servico1.id, servico2.id],
    });

    const doBanco = await dataSource.manager.findOne(Professional, { where: { id: criado.id } });
    expect(doBanco?.tenantId).toBe(cenario.tenantId);
    expect(doBanco?.name).toBe('João Silva');
    expect(doBanco?.avatarInitials).toBe('JS');
    expect(doBanco?.active).toBe(true);

    const linksNoBanco = await dataSource.manager.find(ProfessionalService, {
      where: { professionalId: criado.id },
    });
    expect(linksNoBanco.map((l) => l.serviceId).sort()).toEqual([servico1.id, servico2.id].sort());
  });

  it('serviço inexistente, inativo ou de outro tenant rejeita a criação inteira — nenhuma linha gravada', async () => {
    const a = await criarCenario('rejeitar-a');
    const b = await criarCenario('rejeitar-b');
    const servicoAtivoA = await criarServico(a.tenantId, 'Ativo A');
    const servicoInativoA = await criarServico(a.tenantId, 'Inativo A', false);
    const servicoDeB = await criarServico(b.tenantId, 'Serviço de B');

    await expect(
      profissionais.create(a.ownerUserId, a.tenantId, {
        name: 'Rejeitado 1',
        serviceIds: [servicoAtivoA.id, servicoInativoA.id],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      profissionais.create(a.ownerUserId, a.tenantId, {
        name: 'Rejeitado 2',
        serviceIds: [servicoDeB.id],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Nada foi gravado: nem profissional, nem vínculo.
    const profissionaisNoBanco = await dataSource.manager.find(Professional, {
      where: { tenantId: a.tenantId },
    });
    expect(profissionaisNoBanco.some((p) => p.name.startsWith('Rejeitado'))).toBe(false);
    const linksNoBanco = await dataSource.manager.find(ProfessionalService, {
      where: { tenantId: a.tenantId },
    });
    expect(linksNoBanco).toHaveLength(0);
  });

  it('a constraint única do banco protege contra vínculo duplicado mesmo burlando o diff do serviço', async () => {
    const cenario = await criarCenario('duplicata');
    const servico = await criarServico(cenario.tenantId, 'Corte');
    const criado = await profissionais.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'Profissional duplicata',
      serviceIds: [servico.id],
    });

    // Insere um vínculo duplicado DIRETO no banco, ignorando a camada de
    // serviço — prova que é a CONSTRAINT (não a lógica em memória) que
    // barra, exatamente como o requisito pede ("não dependa apenas de uma
    // consulta prévia").
    await expect(
      dataSource.manager.save(
        dataSource.manager.create(ProfessionalService, {
          tenantId: cenario.tenantId,
          professionalId: criado.id,
          serviceId: servico.id,
        }),
      ),
    ).rejects.toThrow();

    const links = await dataSource.manager.find(ProfessionalService, {
      where: { professionalId: criado.id },
    });
    expect(links).toHaveLength(1);
  });

  it('setServices real: adiciona, remove e preserva vínculo com serviço desativado', async () => {
    const cenario = await criarCenario('set-services');
    const servicoA = await criarServico(cenario.tenantId, 'Serviço A');
    const servicoB = await criarServico(cenario.tenantId, 'Serviço B');
    const criado = await profissionais.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'Profissional set',
      serviceIds: [servicoA.id],
    });

    // Desativa o serviço A DEPOIS de vinculado — o vínculo precisa
    // continuar existindo e aparecer marcado como inativo.
    await dataSource.manager.update(Service, { id: servicoA.id }, { active: false });

    const atualizado = await profissionais.setServices(
      cenario.ownerUserId,
      cenario.tenantId,
      criado.id,
      { serviceIds: [servicoA.id, servicoB.id] },
    );

    const vinculoA = atualizado.services.find((s) => s.serviceId === servicoA.id);
    expect(vinculoA).toBeDefined();
    expect(vinculoA?.serviceActive).toBe(false);
    expect(atualizado.services.some((s) => s.serviceId === servicoB.id)).toBe(true);

    // Remove os dois em seguida.
    const semVinculos = await profissionais.setServices(
      cenario.ownerUserId,
      cenario.tenantId,
      criado.id,
      { serviceIds: [] },
    );
    expect(semVinculos.services).toEqual([]);
    const linksNoBanco = await dataSource.manager.find(ProfessionalService, {
      where: { professionalId: criado.id },
    });
    expect(linksNoBanco).toHaveLength(0);

    // O profissional e o serviço continuam intactos — só os vínculos saíram.
    const profissionalNoBanco = await dataSource.manager.findOne(Professional, {
      where: { id: criado.id },
    });
    expect(profissionalNoBanco?.name).toBe('Profissional set');
    const servicoNoBanco = await dataSource.manager.findOne(Service, { where: { id: servicoA.id } });
    expect(servicoNoBanco?.active).toBe(false);
  });

  it('não é possível vincular serviço NOVO de outro tenant, mesmo conhecendo o id real', async () => {
    const a = await criarCenario('cross-a');
    const b = await criarCenario('cross-b');
    const servicoDeB = await criarServico(b.tenantId, 'Serviço de B');
    const profissionalDeA = await profissionais.create(a.ownerUserId, a.tenantId, {
      name: 'Profissional de A',
      serviceIds: [],
    });

    await expect(
      profissionais.setServices(a.ownerUserId, a.tenantId, profissionalDeA.id, {
        serviceIds: [servicoDeB.id],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const links = await dataSource.manager.find(ProfessionalService, {
      where: { professionalId: profissionalDeA.id },
    });
    expect(links).toHaveLength(0);
  });

  it('professionalId real de outro estabelecimento é 404, o registro fica intacto', async () => {
    const a = await criarCenario('prof-cross-a');
    const b = await criarCenario('prof-cross-b');
    const profissionalDeB = await profissionais.create(b.ownerUserId, b.tenantId, {
      name: 'Profissional protegido',
      serviceIds: [],
    });

    await expect(
      profissionais.update(a.ownerUserId, a.tenantId, profissionalDeB.id, { name: 'Invadido' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      profissionais.deactivate(a.ownerUserId, a.tenantId, profissionalDeB.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      profissionais.setServices(a.ownerUserId, a.tenantId, profissionalDeB.id, { serviceIds: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const intacto = await dataSource.manager.findOne(Professional, {
      where: { id: profissionalDeB.id },
    });
    expect(intacto?.name).toBe('Profissional protegido');
    expect(intacto?.active).toBe(true);
    expect(intacto?.tenantId).toBe(b.tenantId);
  });

  it('desativação e reativação preservam o profissional e todos os vínculos de serviço', async () => {
    const cenario = await criarCenario('desativar-reativar');
    const servico = await criarServico(cenario.tenantId, 'Com histórico');
    const criado = await profissionais.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'Profissional histórico',
      serviceIds: [servico.id],
    });

    const desativado = await profissionais.deactivate(cenario.ownerUserId, cenario.tenantId, criado.id);
    expect(desativado.active).toBe(false);

    const linksAposDesativar = await dataSource.manager.find(ProfessionalService, {
      where: { professionalId: criado.id },
    });
    expect(linksAposDesativar).toHaveLength(1);

    const reativado = await profissionais.reactivate(cenario.ownerUserId, cenario.tenantId, criado.id);
    expect(reativado.active).toBe(true);
    expect(reativado.id).toBe(criado.id);

    const reativadoNoBanco = await dataSource.manager.findOne(Professional, {
      where: { id: criado.id },
    });
    expect(reativadoNoBanco?.active).toBe(true);
    expect(reativadoNoBanco?.name).toBe('Profissional histórico');

    const linksFinais = await dataSource.manager.find(ProfessionalService, {
      where: { professionalId: criado.id },
    });
    expect(linksFinais).toHaveLength(1);
    expect(linksFinais[0].serviceId).toBe(servico.id);
  });

  it('reativação é idempotente: reativar duas vezes não gera erro nem segunda linha', async () => {
    const cenario = await criarCenario('reativar-idempotente');
    const criado = await profissionais.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'Idempotência',
      serviceIds: [],
    });

    await profissionais.deactivate(cenario.ownerUserId, cenario.tenantId, criado.id);
    await profissionais.reactivate(cenario.ownerUserId, cenario.tenantId, criado.id);
    const segunda = await profissionais.reactivate(cenario.ownerUserId, cenario.tenantId, criado.id);

    expect(segunda.active).toBe(true);
    const todos = await dataSource.manager.find(Professional, { where: { tenantId: cenario.tenantId } });
    expect(todos.filter((p) => p.id === criado.id)).toHaveLength(1);
  });

  it('tenant inativo bloqueia mesmo com membership de DONO', async () => {
    const suspenso = await criarCenario('suspenso', TenantStatus.SUSPENDED);
    await expect(
      profissionais.list(suspenso.ownerUserId, suspenso.tenantId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('papel sem permissão recebe 403 mesmo com vínculo ativo', async () => {
    const gerente = await criarCenario('gerente', TenantStatus.ACTIVE, EstablishmentRole.GERENTE);
    await expect(
      profissionais.list(gerente.ownerUserId, gerente.tenantId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('override DENIED gravado no banco tira a gestão do DONO', async () => {
    const cenario = await criarCenario('denied');
    await dataSource.manager.save(
      dataSource.manager.create(MembershipPermissionOverride, {
        tenantId: cenario.tenantId,
        membershipId: cenario.membershipId,
        permission: Permission.PROFISSIONAIS_GERENCIAR,
        mode: PermissionMode.DENIED,
      }),
    );

    await expect(
      profissionais.create(cenario.ownerUserId, cenario.tenantId, {
        name: 'Não deveria entrar',
        serviceIds: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(profissionais.list(cenario.ownerUserId, cenario.tenantId)).resolves.toEqual([]);
  });

  it('isolamento real: a listagem de um tenant nunca traz profissional do outro', async () => {
    const a = await criarCenario('iso-a');
    const b = await criarCenario('iso-b');

    await profissionais.create(a.ownerUserId, a.tenantId, { name: 'Profissional do A', serviceIds: [] });
    await profissionais.create(b.ownerUserId, b.tenantId, { name: 'Profissional do B', serviceIds: [] });

    const listaA = await profissionais.list(a.ownerUserId, a.tenantId);
    const listaB = await profissionais.list(b.ownerUserId, b.tenantId);

    expect(listaA.map((p) => p.name)).toEqual(['Profissional do A']);
    expect(listaB.map((p) => p.name)).toEqual(['Profissional do B']);
  });
});
