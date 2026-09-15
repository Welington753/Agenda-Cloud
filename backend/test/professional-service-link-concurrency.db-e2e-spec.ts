// Concorrência entre "vincular serviço a profissional" e "desativar serviço"
// (revisão do Lote 6D.2), contra PostgreSQL DESCARTÁVEL. Só roda com
// `DB_E2E_DIRECT_URL` definida — nunca Neon, nunca banco existente.
//
// A PERGUNTA: `create`/`setServices` validam que todo vínculo NOVO aponta
// para um serviço ATIVO do mesmo tenant. Entre essa validação e a gravação
// existe uma janela. Uma desativação de serviço que commite dentro dessa
// janela faria um vínculo NOVO nascer apontando para serviço já inativo —
// violando a regra de admissão que o próprio endpoint documenta.
//
// POR QUE ISOLAMENTO NÃO RESOLVE: o banco roda em READ COMMITTED (nenhum
// nível é configurado, ver database/runtime-data-source.ts). Mover a
// consulta de validação para dentro da transação NÃO fecha a janela: em READ
// COMMITTED cada statement enxerga o que já commitou, e nada impede a
// desativação de commitar entre o SELECT e o INSERT da mesma transação. A FK
// composta também não ajuda: `INSERT` em `professional_services` pega
// `FOR KEY SHARE` na linha de `services`, que NÃO conflita com o
// `FOR NO KEY UPDATE` de um `UPDATE services SET active = false` (a coluna
// `active` não é chave). Só um lock explícito de leitura (`FOR SHARE`)
// conflita com esse UPDATE.
//
// COMO O TESTE É DETERMINÍSTICO (sem sleep, sem polling de tempo):
//  1. Um proxy de `DataSource` para a transação exatamente no ponto da
//     janela e avisa o teste que chegou lá (promise, não timer);
//  2. a desativação concorrente roda numa CONEXÃO SEPARADA com
//     `lock_timeout` — se ela ficar bloqueada por um lock, o próprio
//     Postgres devolve `55P03` (lock_not_available), que é um resultado
//     observável, não uma medida de tempo. Se não houver lock nenhum, ela
//     commita na hora.
// Assim cada cenário termina por um resultado do banco, nunca por espera
// arbitrária.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { BusinessCategory } from '../src/entities/enums/business-category.enum.js';
import { EstablishmentRole } from '../src/entities/enums/establishment-role.enum.js';
import { ServiceModality } from '../src/entities/enums/service-modality.enum.js';
import { TenantStatus } from '../src/entities/enums/tenant-status.enum.js';
import { UserStatus } from '../src/entities/enums/user-status.enum.js';
import { Membership } from '../src/entities/membership.entity.js';
import { Plan } from '../src/entities/plan.entity.js';
import { Professional } from '../src/entities/professional.entity.js';
import { ProfessionalService } from '../src/entities/professional-service.entity.js';
import { Service } from '../src/entities/service.entity.js';
import { Tenant } from '../src/entities/tenant.entity.js';
import { Unit } from '../src/entities/unit.entity.js';
import { User } from '../src/entities/user.entity.js';
import { ProfessionalsService } from '../src/professionals/professionals.service.js';
import { ServicesService } from '../src/services/services.service.js';

const DIRECT_URL = process.env.DB_E2E_DIRECT_URL;

const testDir = path.dirname(fileURLToPath(import.meta.url));

/** Mesma carga de entidades dos outros arquivos db-e2e (ver
 * services-postgres.db-e2e-spec.ts para a justificativa do `import()`
 * dinâmico a partir do mesmo glob do runtime). */
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

/** Onde a transação do serviço sob teste é congelada. */
type PontoDeParada =
  /** Antes de QUALQUER statement da transação — reproduz a janela de quem
   * valida FORA da transação: a desativação commita inteira antes. */
  | 'ao-abrir-transacao'
  /** Na primeira gravação DENTRO da transação — ou seja, depois da
   * validação. É aqui que se vê se a validação deixou lock para trás. */
  | 'na-primeira-gravacao';

interface TransacaoCongelada {
  /** `DataSource` para injetar no serviço sob teste. */
  dataSource: DataSource;
  /** Resolve quando a transação alcança o ponto de parada. */
  chegou: Promise<void>;
  liberar: () => void;
}

type FuncaoQualquer = (...args: never[]) => unknown;

function ligarMetodo(valor: unknown, alvo: object): unknown {
  return typeof valor === 'function' ? (valor as FuncaoQualquer).bind(alvo) : valor;
}

/** Congela a transação do serviço no ponto pedido, usando só promises — o
 * teste controla o entrelaçamento, nunca o relógio. */
function congelarTransacao(real: DataSource, ponto: PontoDeParada): TransacaoCongelada {
  let sinalizarChegada!: () => void;
  let liberar!: () => void;
  const chegou = new Promise<void>((resolver) => {
    sinalizarChegada = resolver;
  });
  const portao = new Promise<void>((resolver) => {
    liberar = resolver;
  });

  const congelarNaPrimeiraGravacao = (tx: EntityManager): EntityManager => {
    let jaCongelou = false;
    return new Proxy(tx, {
      get(alvo, prop) {
        const valor = Reflect.get(alvo, prop) as unknown;
        const ehGravacao = prop === 'save' || prop === 'remove';
        if (!ehGravacao || typeof valor !== 'function') return ligarMetodo(valor, alvo);

        return async (...args: never[]) => {
          if (!jaCongelou) {
            jaCongelou = true;
            sinalizarChegada();
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
        return async (callback: (tx: EntityManager) => Promise<unknown>) => {
          if (ponto === 'ao-abrir-transacao') {
            sinalizarChegada();
            await portao;
            return real.transaction((tx) => callback(tx));
          }
          return real.transaction((tx) => callback(congelarNaPrimeiraGravacao(tx)));
        };
      }
      const valor = Reflect.get(alvo, prop) as unknown;
      return ligarMetodo(valor, alvo);
    },
  }) as DataSource;

  return { dataSource, chegou, liberar };
}

/** `55P03` = lock_not_available: a operação ficou esperando um lock de linha
 * e o `lock_timeout` da sessão estourou. É a prova observável de que ALGUÉM
 * estava segurando a linha — nunca uma medição de tempo feita pelo teste. */
const LOCK_NAO_DISPONIVEL = '55P03';

function codigoDoErro(erro: unknown): string | undefined {
  if (typeof erro !== 'object' || erro === null) return undefined;
  const comCodigo = erro as { code?: string; driverError?: { code?: string } };
  return comCodigo.code ?? comCodigo.driverError?.code;
}

type ResultadoDesativacao = 'commitou' | 'bloqueada-por-lock';

async function observarDesativacao(
  executar: () => Promise<unknown>,
): Promise<ResultadoDesativacao> {
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
}

describe.skipIf(!DIRECT_URL)('corrida entre vincular serviço e desativar serviço (Lote 6D.2)', () => {
  let dataSource: DataSource;
  /** Conexão separada, com `lock_timeout`, usada SÓ pela desativação
   * concorrente — é ela que transforma "ficou bloqueada" em um erro
   * observável em vez de uma espera indefinida. */
  let dataSourceDaDesativacao: DataSource;
  let profissionais: ProfessionalsService;
  let servicosComLockTimeout: ServicesService;
  let planId: string;
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  async function criarCenario(nome: string): Promise<Cenario> {
    const manager = dataSource.manager;

    const tenant = await manager.save(
      manager.create(Tenant, {
        slug: `e2e-corrida-${nome}-${sufixo}`,
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
        email: `dono-corrida-${nome}-${sufixo}@example.test`,
        phone: '+5511900000000',
        status: UserStatus.ACTIVE,
      }),
    );
    await manager.save(
      manager.create(Membership, {
        userId: user.id,
        tenantId: tenant.id,
        role: EstablishmentRole.DONO,
      }),
    );

    return { tenantId: tenant.id, ownerUserId: user.id };
  }

  async function criarServico(tenantId: string, nome: string): Promise<Service> {
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
        active: true,
      }),
    );
  }

  async function vinculosDe(professionalId: string): Promise<ProfessionalService[]> {
    return dataSource.manager.find(ProfessionalService, { where: { professionalId } });
  }

  async function servicoEstaAtivo(serviceId: string): Promise<boolean> {
    const servico = await dataSource.manager.findOne(Service, { where: { id: serviceId } });
    return servico?.active ?? false;
  }

  beforeAll(async () => {
    const entidades = await carregarEntidades();
    const opcoesBase = buildRuntimeDataSourceOptions(DIRECT_URL as string);

    dataSource = new DataSource({ ...opcoesBase, entities: entidades, logging: ['error'] });
    await dataSource.initialize();

    // `poolSize: 1` + `options` de conexão: o `lock_timeout` precisa valer
    // para a MESMA conexão física que a desativação vai usar.
    dataSourceDaDesativacao = new DataSource({
      ...opcoesBase,
      entities: entidades,
      logging: ['error'],
      poolSize: 1,
      extra: { options: '-c lock_timeout=2000' },
    });
    await dataSourceDaDesativacao.initialize();

    // Auto-verificação: se o parâmetro não tivesse pegado, um teste de
    // bloqueio ficaria pendurado para sempre em vez de falhar.
    const [{ lock_timeout: lockTimeout }] = (await dataSourceDaDesativacao.query(
      'SHOW lock_timeout',
    )) as { lock_timeout: string }[];
    expect(lockTimeout).toBe('2s');

    profissionais = new ProfessionalsService(dataSource);
    servicosComLockTimeout = new ServicesService(dataSourceDaDesativacao);

    const plan = await dataSource.manager.findOne(Plan, { where: { code: 'equipe' } });
    if (!plan) throw new Error('Catálogo de planos ausente — migrations não foram aplicadas.');
    planId = plan.id;
  }, 30_000);

  afterAll(async () => {
    if (dataSourceDaDesativacao?.isInitialized) await dataSourceDaDesativacao.destroy();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('create: desativação que commita ANTES da gravação impede o vínculo novo', async () => {
    const cenario = await criarCenario('create-antes');
    const servico = await criarServico(cenario.tenantId, 'Corte');

    const congelada = congelarTransacao(dataSource, 'ao-abrir-transacao');
    const criacao = new ProfessionalsService(congelada.dataSource).create(
      cenario.ownerUserId,
      cenario.tenantId,
      { name: 'João Silva', serviceIds: [servico.id] },
    );

    await congelada.chegou;

    // Sem nenhum lock em jogo, esta desativação commita imediatamente.
    const desativacao = await observarDesativacao(() =>
      servicosComLockTimeout.deactivate(cenario.ownerUserId, cenario.tenantId, servico.id),
    );
    expect(desativacao).toBe('commitou');
    expect(await servicoEstaAtivo(servico.id)).toBe(false);

    congelada.liberar();

    // A regra de admissão do endpoint: vínculo NOVO exige serviço ativo.
    // Como a desativação já commitou, a criação precisa ser recusada.
    await expect(criacao).rejects.toBeInstanceOf(BadRequestException);

    const profissionaisDoTenant = await dataSource.manager.find(Professional, {
      where: { tenantId: cenario.tenantId },
    });
    expect(profissionaisDoTenant, 'nada pode ter sido gravado').toHaveLength(0);
    const vinculos = await dataSource.manager.find(ProfessionalService, {
      where: { tenantId: cenario.tenantId },
    });
    expect(vinculos).toHaveLength(0);
  });

  it('setServices: desativação que tenta commitar DEPOIS da validação fica bloqueada, e o vínculo novo é aceito', async () => {
    const cenario = await criarCenario('set-depois');
    const servico = await criarServico(cenario.tenantId, 'Corte');
    const profissional = await profissionais.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'João Silva',
      serviceIds: [],
    });

    const congelada = congelarTransacao(dataSource, 'na-primeira-gravacao');
    const vinculo = new ProfessionalsService(congelada.dataSource).setServices(
      cenario.ownerUserId,
      cenario.tenantId,
      profissional.id,
      { serviceIds: [servico.id] },
    );

    // A transação já validou (viu o serviço ATIVO) e está parada antes de
    // gravar — exatamente a janela sob investigação.
    await congelada.chegou;

    const desativacao = await observarDesativacao(() =>
      servicosComLockTimeout.deactivate(cenario.ownerUserId, cenario.tenantId, servico.id),
    );

    congelada.liberar();
    await expect(vinculo).resolves.toBeDefined();

    // Com a validação segurando `FOR SHARE` na linha do serviço, a
    // desativação NÃO consegue se intrometer no meio da transação.
    expect(desativacao).toBe('bloqueada-por-lock');
    expect(await servicoEstaAtivo(servico.id), 'desativação não commitou').toBe(true);

    const vinculos = await vinculosDe(profissional.id);
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0].serviceId).toBe(servico.id);

    // Depois que a transação do vínculo terminou, desativar volta a
    // funcionar — e o vínculo vira, legitimamente, um vínculo antigo
    // apontando para serviço inativo.
    const depois = await observarDesativacao(() =>
      servicosComLockTimeout.deactivate(cenario.ownerUserId, cenario.tenantId, servico.id),
    );
    expect(depois).toBe('commitou');
    expect(await vinculosDe(profissional.id)).toHaveLength(1);
  });

  it('setServices: manter vínculo ANTIGO não bloqueia desativação concorrente nem apaga o vínculo', async () => {
    const cenario = await criarCenario('set-antigo');
    const manter = await criarServico(cenario.tenantId, 'Serviço mantido');
    const remover = await criarServico(cenario.tenantId, 'Serviço removido');
    const profissional = await profissionais.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'João Silva',
      serviceIds: [manter.id, remover.id],
    });

    // Conjunto pedido só REMOVE um vínculo; nenhum vínculo novo entra, então
    // nada precisa ser travado — a desativação concorrente tem de passar.
    const congelada = congelarTransacao(dataSource, 'na-primeira-gravacao');
    const edicao = new ProfessionalsService(congelada.dataSource).setServices(
      cenario.ownerUserId,
      cenario.tenantId,
      profissional.id,
      { serviceIds: [manter.id] },
    );

    await congelada.chegou;

    const desativacao = await observarDesativacao(() =>
      servicosComLockTimeout.deactivate(cenario.ownerUserId, cenario.tenantId, manter.id),
    );
    expect(desativacao, 'manter vínculo antigo nunca trava a gestão de serviços').toBe('commitou');

    congelada.liberar();
    const resultado = await edicao;

    // O vínculo antigo sobrevive à desativação e aparece marcado como
    // inativo; o removido saiu. Nenhuma exclusão automática.
    expect(resultado.services).toHaveLength(1);
    expect(resultado.services[0].serviceId).toBe(manter.id);
    expect(resultado.services[0].serviceActive).toBe(false);

    const vinculos = await vinculosDe(profissional.id);
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0].serviceId).toBe(manter.id);
  });

  it('setServices: desativação que commita ANTES da transação impede o vínculo novo, sem tocar nos antigos', async () => {
    const cenario = await criarCenario('set-antes');
    const antigo = await criarServico(cenario.tenantId, 'Serviço antigo');
    const novo = await criarServico(cenario.tenantId, 'Serviço novo');
    const profissional = await profissionais.create(cenario.ownerUserId, cenario.tenantId, {
      name: 'João Silva',
      serviceIds: [antigo.id],
    });

    const congelada = congelarTransacao(dataSource, 'ao-abrir-transacao');
    const edicao = new ProfessionalsService(congelada.dataSource).setServices(
      cenario.ownerUserId,
      cenario.tenantId,
      profissional.id,
      { serviceIds: [antigo.id, novo.id] },
    );

    await congelada.chegou;
    const desativacao = await observarDesativacao(() =>
      servicosComLockTimeout.deactivate(cenario.ownerUserId, cenario.tenantId, novo.id),
    );
    expect(desativacao).toBe('commitou');

    congelada.liberar();
    await expect(edicao).rejects.toBeInstanceOf(BadRequestException);

    // Recusa total: o vínculo novo não entrou e o antigo continua intacto.
    const vinculos = await vinculosDe(profissional.id);
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0].serviceId).toBe(antigo.id);
  });
});
