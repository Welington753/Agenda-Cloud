// Integração real do Lote 6D.1 contra um PostgreSQL DESCARTÁVEL (nunca Neon,
// nunca banco existente, nunca `.env` local). Prova o que um fake em memória
// não consegue provar: que as CONSULTAS e as CONSTRAINTS reais se comportam
// como o isolamento entre estabelecimentos exige.
//
// Só roda quando `DB_E2E_DIRECT_URL` está definida — mesmo padrão de
// `scripts/lote6b2-migration.migration-e2e-spec.ts` (nunca localmente por
// acidente). O schema é o real, aplicado pelas migrations versionadas pelo
// passo anterior do workflow de CI; este arquivo nunca cria nem altera tabela.
// `rejectUnauthorized: true` nunca é enfraquecido: o certificado autoassinado
// do container é confiado via `NODE_EXTRA_CA_CERTS`.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
import { ServicesService } from '../src/services/services.service.js';

const DIRECT_URL = process.env.DB_E2E_DIRECT_URL;

const testDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Carrega TODAS as classes de entidade a partir do mesmo padrão de arquivos
 * que `runtime-data-source.ts` usa em `entities:` — nunca um registro
 * paralelo. O `import()` dinâmico é o ponto: ele passa pelo transform do
 * Vitest, enquanto o glob resolvido pelo próprio TypeORM leria o `.ts` cru
 * com o loader do Node.
 *
 * O conjunto precisa ser completo: as entidades se referenciam entre si por
 * nome, então uma lista parcial quebraria o metadata de quem ficou de fora.
 */
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

/** Dados mínimos de um estabelecimento com um dono — criados direto pelo
 * DataSource porque são FIXTURE (o que está sob teste é `ServicesService`,
 * não o cadastro, já coberto em outro lote). */
interface Cenario {
  tenantId: string;
  ownerUserId: string;
  membershipId: string;
}

describe.skipIf(!DIRECT_URL)('serviços contra PostgreSQL descartável (Lote 6D.1)', () => {
  let dataSource: DataSource;
  let servicos: ServicesService;
  let planId: string;
  // Sufixo por execução: o banco descartável é reaproveitado entre arquivos
  // de teste no mesmo job, então nada aqui pode colidir com outra suíte.
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  async function criarCenario(nome: string, status = TenantStatus.ACTIVE, role = EstablishmentRole.DONO): Promise<Cenario> {
    const manager = dataSource.manager;

    const tenant = await manager.save(
      manager.create(Tenant, {
        slug: `e2e-${nome}-${sufixo}`,
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
        email: `dono-${nome}-${sufixo}@example.test`,
        phone: `+5511900000000`,
        status: UserStatus.ACTIVE,
      }),
    );
    const membership = await manager.save(
      manager.create(Membership, { userId: user.id, tenantId: tenant.id, role }),
    );

    return { tenantId: tenant.id, ownerUserId: user.id, membershipId: membership.id };
  }

  beforeAll(async () => {
    // Reaproveita a MESMA construção de opções do runtime (naming strategy,
    // synchronize:false e `ssl.rejectUnauthorized: true`, que nunca é
    // enfraquecido aqui) — só a URL e a forma de carregar as entidades mudam.
    //
    // Por que `entities` é substituído: o runtime aponta para um GLOB de
    // arquivos, e o TypeORM resolve esse glob lendo os arquivos direto com o
    // loader do Node. Sob o Vitest isso alcançaria os `.ts` crus, sem passar
    // pelo transform, e quebraria com "SyntaxError: Invalid or unexpected
    // token". As classes são carregadas aqui pelo `import()` dinâmico (que
    // passa pelo pipeline do Vitest) a partir do MESMO glob — nunca uma lista
    // mantida à mão em paralelo, que poderia divergir das entidades reais.
    const entidades = await carregarEntidades();
    dataSource = new DataSource({
      ...buildRuntimeDataSourceOptions(DIRECT_URL as string),
      entities: entidades,
      logging: ['error'],
    });
    await dataSource.initialize();
    servicos = new ServicesService(dataSource);

    // O catálogo de planos vem da migration `InitialPlanCatalog` — nunca
    // criado aqui (o cadastro real também só consulta, nunca cria).
    const plan = await dataSource.manager.findOne(Plan, { where: { code: 'equipe' } });
    if (!plan) throw new Error('Catálogo de planos ausente — migrations não foram aplicadas.');
    planId = plan.id;
  }, 30_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('cria, persiste e relê o serviço com os valores exatos (centavos inteiros)', async () => {
    const cenario = await criarCenario('criar');

    const criado = await servicos.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'Atendimento padrão',
      shortDescription: 'Sessão inicial',
      priceCents: 12345,
      priceVisible: true,
      durationMinutes: 50,
      bufferAfterMinutes: 10,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });

    // Releitura direta do banco: prova persistência real, não só o retorno.
    const doBanco = await dataSource.manager.findOne(Service, { where: { id: criado.id } });
    expect(doBanco?.tenantId).toBe(cenario.tenantId);
    expect(doBanco?.priceCents).toBe(12345);
    expect(doBanco?.durationMinutes).toBe(50);
    expect(doBanco?.active).toBe(true);
  });

  it('preço nulo (sob consulta) persiste como NULL, distinto de zero', async () => {
    const cenario = await criarCenario('preco');

    const semPreco = await servicos.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'Sob consulta',
      shortDescription: '',
      priceCents: null,
      priceVisible: false,
      durationMinutes: 30,
      bufferAfterMinutes: 0,
      modality: ServiceModality.REMOTE,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });

    // Sempre conferido por SQL cru, nunca só pelo objeto devolvido: um
    // UPDATE que o TypeORM tivesse PULADO (o caso de `undefined`, ver
    // service.entity.ts) ainda devolveria o valor "certo" em memória e
    // passaria despercebido.
    const precoNoBanco = async (id: string): Promise<number | null> => {
      const linhas = await dataSource.query<{ price_cents: number | null }[]>(
        'SELECT price_cents FROM services WHERE id = $1',
        [id],
      );
      return linhas[0].price_cents;
    };

    expect(await precoNoBanco(semPreco.id)).toBeNull();

    const comZero = await servicos.update(cenario.ownerUserId, cenario.tenantId, semPreco.id, {
      priceCents: 0,
    });
    expect(comZero.priceCents).toBe(0);
    expect(await precoNoBanco(semPreco.id)).toBe(0);

    const comValor = await servicos.update(cenario.ownerUserId, cenario.tenantId, semPreco.id, {
      priceCents: 9900,
    });
    expect(comValor.priceCents).toBe(9900);
    expect(await precoNoBanco(semPreco.id)).toBe(9900);

    // Voltar para "sob consulta" precisa gravar NULL de verdade.
    const voltou = await servicos.update(cenario.ownerUserId, cenario.tenantId, semPreco.id, {
      priceCents: null,
    });
    expect(voltou.priceCents).toBeNull();
    expect(await precoNoBanco(semPreco.id)).toBeNull();
  });

  it('isolamento real: a listagem de um tenant nunca traz serviço do outro', async () => {
    const a = await criarCenario('iso-a');
    const b = await criarCenario('iso-b');

    await servicos.create(a.ownerUserId, a.tenantId, {
      name: 'Serviço do A',
      shortDescription: '',
      priceCents: 1000,
      priceVisible: true,
      durationMinutes: 30,
      bufferAfterMinutes: 0,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });
    await servicos.create(b.ownerUserId, b.tenantId, {
      name: 'Serviço do B',
      shortDescription: '',
      priceCents: 2000,
      priceVisible: true,
      durationMinutes: 30,
      bufferAfterMinutes: 0,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });

    const listaA = await servicos.list(a.ownerUserId, a.tenantId);
    const listaB = await servicos.list(b.ownerUserId, b.tenantId);

    expect(listaA.map((s) => s.name)).toEqual(['Serviço do A']);
    expect(listaB.map((s) => s.name)).toEqual(['Serviço do B']);
  });

  it('serviceId real de outro estabelecimento é 404 e o registro fica intacto', async () => {
    const a = await criarCenario('cross-a');
    const b = await criarCenario('cross-b');

    const doB = await servicos.create(b.ownerUserId, b.tenantId, {
      name: 'Serviço protegido',
      shortDescription: '',
      priceCents: 7000,
      priceVisible: true,
      durationMinutes: 40,
      bufferAfterMinutes: 0,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });

    // O dono do A conhece o id real do serviço do B e mesmo assim não alcança.
    await expect(
      servicos.update(a.ownerUserId, a.tenantId, doB.id, { name: 'Invadido' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      servicos.deactivate(a.ownerUserId, a.tenantId, doB.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    const intacto = await dataSource.manager.findOne(Service, { where: { id: doB.id } });
    expect(intacto?.name).toBe('Serviço protegido');
    expect(intacto?.active).toBe(true);
    expect(intacto?.tenantId).toBe(b.tenantId);
  });

  it('pedir o tenant do vizinho não autoriza nada, mesmo com sessão válida', async () => {
    const a = await criarCenario('vizinho-a');
    const b = await criarCenario('vizinho-b');

    await expect(servicos.list(a.ownerUserId, b.tenantId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tenant inativo bloqueia mesmo com membership de DONO', async () => {
    const suspenso = await criarCenario('suspenso', TenantStatus.SUSPENDED);

    await expect(
      servicos.list(suspenso.ownerUserId, suspenso.tenantId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('papel sem permissão recebe 403 mesmo com vínculo ativo', async () => {
    const gerente = await criarCenario('gerente', TenantStatus.ACTIVE, EstablishmentRole.GERENTE);

    await expect(
      servicos.list(gerente.ownerUserId, gerente.tenantId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('override DENIED gravado no banco tira a gestão do DONO', async () => {
    const cenario = await criarCenario('denied');
    await dataSource.manager.save(
      dataSource.manager.create(MembershipPermissionOverride, {
        tenantId: cenario.tenantId,
        membershipId: cenario.membershipId,
        permission: Permission.SERVICOS_GERENCIAR,
        mode: PermissionMode.DENIED,
      }),
    );

    await expect(
      servicos.create(cenario.ownerUserId, cenario.tenantId, {
        name: 'Não deveria entrar',
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

    // Leitura continua permitida (DENIED foi só em GERENCIAR).
    await expect(servicos.list(cenario.ownerUserId, cenario.tenantId)).resolves.toEqual([]);
  });

  it('desativação preserva a linha e as referências que apontam para ela', async () => {
    const cenario = await criarCenario('desativar');

    const servico = await servicos.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'Com histórico',
      shortDescription: '',
      priceCents: 5000,
      priceVisible: true,
      durationMinutes: 30,
      bufferAfterMinutes: 0,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });

    // Referência real via a FK composta (tenant_id, service_id) — é ela que
    // tornaria uma exclusão física destrutiva.
    const profissional = await dataSource.manager.save(
      dataSource.manager.create(Professional, {
        tenantId: cenario.tenantId,
        name: 'Profissional teste',
        // NOT NULL sem default no schema real — precisam vir preenchidos.
        avatarInitials: 'PT',
        avatarColor: '#334155',
        active: true,
      }),
    );
    const vinculo = await dataSource.manager.save(
      dataSource.manager.create(ProfessionalService, {
        tenantId: cenario.tenantId,
        professionalId: profissional.id,
        serviceId: servico.id,
      }),
    );

    const desativado = await servicos.deactivate(cenario.ownerUserId, cenario.tenantId, servico.id);
    expect(desativado.active).toBe(false);

    // A linha do serviço continua existindo, com todos os dados.
    const aindaExiste = await dataSource.manager.findOne(Service, { where: { id: servico.id } });
    expect(aindaExiste?.name).toBe('Com histórico');
    expect(aindaExiste?.priceCents).toBe(5000);

    // E a referência não foi levada junto (nenhum CASCADE disparou).
    const referencia = await dataSource.manager.findOne(ProfessionalService, {
      where: { id: vinculo.id },
    });
    expect(referencia?.serviceId).toBe(servico.id);

    // O inativo continua aparecendo na listagem, marcado como tal.
    const lista = await servicos.list(cenario.ownerUserId, cenario.tenantId);
    expect(lista).toHaveLength(1);
    expect(lista[0].active).toBe(false);
  });

  it('edição persiste de verdade e não toca nos campos não enviados', async () => {
    const cenario = await criarCenario('editar');

    const servico = await servicos.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'Original',
      shortDescription: 'Descrição original',
      priceCents: 3000,
      priceVisible: true,
      durationMinutes: 30,
      bufferAfterMinutes: 5,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });

    await servicos.update(cenario.ownerUserId, cenario.tenantId, servico.id, {
      name: 'Renomeado',
      durationMinutes: 75,
    });

    const doBanco = await dataSource.manager.findOne(Service, { where: { id: servico.id } });
    expect(doBanco?.name).toBe('Renomeado');
    expect(doBanco?.durationMinutes).toBe(75);
    expect(doBanco?.shortDescription).toBe('Descrição original');
    expect(doBanco?.priceCents).toBe(3000);
    expect(doBanco?.bufferAfterMinutes).toBe(5);
    expect(doBanco?.tenantId).toBe(cenario.tenantId);
  });
});
