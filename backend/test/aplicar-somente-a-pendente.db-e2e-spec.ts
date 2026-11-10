// `aplicarSomenteAPendente` (scripts/operacao-piloto.mjs) de verdade, com o
// runtime compilado (`dist-migrations`, o mesmo dos procedimentos do piloto),
// num banco TEMPORÁRIO criado e apagado aqui no PostgreSQL descartável. Prova
// a seleção das etapas de PlatformPortal1793318400000 e
// AppointmentServiceSnapshots1793404800000: cada etapa aplica só a sua
// migration, pelo nome e na ordem; repetição, ordem errada, histórico com
// migration desconhecida e lista de posteriores divergente param ANTES de
// qualquer comando da migration (`aoIniciar` não é chamado e o histórico não
// muda); sem `posteriores`, o comportamento dos kits anteriores continua (com
// duas pendentes compiladas, recusa em vez de aplicar as duas).
//
// Migrations criadas DEPOIS deste kit (ProfessionalCommissions em diante)
// também estão no `dist-migrations`. O kit recusaria a lista por elas, de
// propósito; aqui elas entram no fim de `posteriores` de cada chamada que
// passa a lista, para provar as etapas do kit com o runtime atual.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { Parada } from '../scripts/entrada-oculta.mjs';
import { aplicarSomenteAPendente, type Destino } from '../scripts/operacao-piloto.mjs';
import {
  MIGRATIONS_ATE_COMERCIAL,
  MIGRATIONS_ATE_NOMES_CONGELADOS,
  MIGRATIONS_ATE_PORTAL,
  falhasDepoisDoPortal,
  falhasDepoisDosNomesCongelados,
  lerEstadoPortalMultisservicos,
} from '../scripts/lib/portal-multisservicos-schema.js';
import type { PgClientLike } from '../scripts/lib/pg-client.js';
import { ETAPAS } from '../scripts/portal-multisservicos-piloto.mjs';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const FONTE_COMPILADA = new URL('../dist-migrations/database/migrations-data-source.js', import.meta.url);
const { portal, multisservicos } = ETAPAS;

describe.skipIf(!url)('aplicarSomenteAPendente nas etapas do portal e dos nomes congelados (banco temporário)', () => {
  const banco = `aplicacao_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const urlDoBanco = () => {
    const u = new URL(url!);
    u.pathname = `/${banco}`;
    return u.toString();
  };

  async function comCliente<T>(alvo: string, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: alvo, ssl: { rejectUnauthorized: true } });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }
  const historico = () =>
    comCliente(urlDoBanco(), async (c) => (await c.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id')).rows.map((r) => r.name));
  const estado = () => comCliente(urlDoBanco(), (c) => lerEstadoPortalMultisservicos(c as unknown as PgClientLike));

  const destino = (): Destino => {
    const u = new URL(url!);
    return {
      url: urlDoBanco(),
      host: u.hostname,
      // O certificado descartável é emitido para localhost (CN/SAN).
      servidorTls: 'localhost',
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: banco,
      channelBinding: false,
    };
  };

  let posterioresAoKit: string[] = [];
  async function aplicar(args: { esperadasAntes: readonly string[]; pendente: string; posteriores?: readonly string[] }) {
    const linhas: string[] = [];
    let iniciou = false;
    try {
      const aplicadas = await aplicarSomenteAPendente(destino(), {
        esperadasAntes: [...args.esperadasAntes],
        pendente: args.pendente,
        ...(args.posteriores ? { posteriores: [...args.posteriores, ...posterioresAoKit] } : {}),
        aplicacao: 'agenda-cloud-migration-teste',
        log: (l) => linhas.push(l),
        aoIniciar: () => {
          iniciou = true;
        },
      });
      return { aplicadas, codigo: null, iniciou, linhas };
    } catch (erro) {
      if (!(erro instanceof Parada)) throw erro;
      return { aplicadas: null, codigo: erro.message, iniciou, linhas };
    }
  }

  beforeAll(async () => {
    if (!existsSync(FONTE_COMPILADA)) throw new Error('Rode `npm run build:migrations-runtime` antes deste teste.');
    await comCliente(url!, (c) => c.query(`CREATE DATABASE "${banco}"`));
    // As doze primeiras, com o mesmo runtime compilado.
    const { buildMigrationsDataSourceOptions } = (await import(FONTE_COMPILADA.href)) as {
      buildMigrationsDataSourceOptions: (u: string) => ConstructorParameters<typeof DataSource>[0];
    };
    const ds = new DataSource({ ...buildMigrationsDataSourceOptions(urlDoBanco()), logging: false });
    await ds.initialize();
    try {
      const compiladas = ds.migrations.map((m) => m.name ?? m.constructor.name);
      expect(compiladas.slice(0, MIGRATIONS_ATE_NOMES_CONGELADOS.length)).toEqual([...MIGRATIONS_ATE_NOMES_CONGELADOS]);
      posterioresAoKit = compiladas.slice(MIGRATIONS_ATE_NOMES_CONGELADOS.length);
      // Lista explícita: uma migration nova só entra aqui de propósito.
      expect(posterioresAoKit).toEqual(['ProfessionalCommissions1793491200000', 'ProfessionalCommissionSettings1793577600000', 'TenantTestFlag1793664000000']);
      ds.migrations.splice(MIGRATIONS_ATE_COMERCIAL.length);
      await ds.runMigrations({ transaction: 'all' });
    } finally {
      await ds.destroy();
    }
  }, 180_000);

  afterAll(async () => {
    await comCliente(url!, (c) => c.query(`DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`));
  });

  it('a configuração das etapas: portal deixa só a seguinte de fora; multisservicos não deixa nada', () => {
    expect(portal.migration).toBe('PlatformPortal1793318400000');
    expect(portal.posteriores).toEqual(['AppointmentServiceSnapshots1793404800000']);
    expect(multisservicos.migration).toBe('AppointmentServiceSnapshots1793404800000');
    expect(multisservicos.posteriores).toEqual([]);
  });

  it('no estado antes (12): recusas sem gravar nada; depois a etapa portal aplica SÓ PlatformPortal', async () => {
    expect(await historico()).toEqual([...MIGRATIONS_ATE_COMERCIAL]);

    // Sem `posteriores` (como os kits anteriores): duas pendentes compiladas
    // continuam recusadas, nunca aplicadas juntas.
    const semPosteriores = await aplicar({ esperadasAntes: MIGRATIONS_ATE_COMERCIAL, pendente: portal.migration });
    expect(semPosteriores).toMatchObject({ codigo: 'ERR_MIGRATIONS_COMPILADAS_INESPERADAS', iniciou: false });

    // Lista de posteriores com nome desconhecido, a mais ou fora de ordem.
    for (const posteriores of [['Desconhecida1793404800000'], [...portal.posteriores, 'Extra1799999999999'], []]) {
      const r = await aplicar({ esperadasAntes: MIGRATIONS_ATE_COMERCIAL, pendente: portal.migration, posteriores });
      expect(r).toMatchObject({ codigo: 'ERR_MIGRATIONS_COMPILADAS_INESPERADAS', iniciou: false });
    }
    // Pendente trocada pela seguinte (ordem errada dentro do mesmo histórico).
    const trocada = await aplicar({ esperadasAntes: MIGRATIONS_ATE_COMERCIAL, pendente: multisservicos.migration, posteriores: [portal.migration] });
    expect(trocada).toMatchObject({ codigo: 'ERR_MIGRATIONS_COMPILADAS_INESPERADAS', iniciou: false });

    // Etapa multisservicos antes da portal.
    const foraDeOrdem = await aplicar({ esperadasAntes: MIGRATIONS_ATE_PORTAL, pendente: multisservicos.migration, posteriores: multisservicos.posteriores });
    expect(foraDeOrdem).toMatchObject({ codigo: 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO', iniciou: false });

    // Histórico com uma migration desconhecida: as exclusões não a escondem.
    await comCliente(urlDoBanco(), (c) => c.query("INSERT INTO typeorm_migrations (timestamp, name) VALUES (1793300000000, 'Desconhecida1793300000000')"));
    try {
      const desconhecida = await aplicar({ esperadasAntes: MIGRATIONS_ATE_COMERCIAL, pendente: portal.migration, posteriores: portal.posteriores });
      expect(desconhecida).toMatchObject({ codigo: 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO', iniciou: false });
    } finally {
      await comCliente(urlDoBanco(), (c) => c.query("DELETE FROM typeorm_migrations WHERE name = 'Desconhecida1793300000000'"));
    }
    expect(await historico()).toEqual([...MIGRATIONS_ATE_COMERCIAL]);
    expect((await estado()).tabelas).toEqual({});

    const r = await aplicar({ esperadasAntes: MIGRATIONS_ATE_COMERCIAL, pendente: portal.migration, posteriores: portal.posteriores });
    expect(r).toMatchObject({ codigo: null, iniciou: true, aplicadas: ['PlatformPortal1793318400000'] });
    expect(r.linhas).toEqual(
      expect.arrayContaining([
        'MIGRATIONS_NO_HISTORICO: 12',
        `MIGRATIONS_COMPILADAS: ${MIGRATIONS_ATE_NOMES_CONGELADOS.length + posterioresAoKit.length}`,
        'PENDENTE: PlatformPortal1793318400000',
        `FORA_DESTA_ETAPA: ${['AppointmentServiceSnapshots1793404800000', ...posterioresAoKit].join(',')}`,
        'APLICADAS: PlatformPortal1793318400000',
        'SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s',
      ]),
    );
    expect(r.linhas).toContainEqual(expect.stringMatching(/^TLS_MIGRATION: TLSv1\.[23] hostname=ok$/));
    expect(await historico()).toEqual([...MIGRATIONS_ATE_PORTAL]);
    // Estado intermediário completo: objetos do portal, sem o nome congelado.
    expect(falhasDepoisDoPortal(await estado())).toEqual([]);
  });

  it('no estado intermediário (13): portal repetida é recusada; multisservicos aplica SÓ AppointmentServiceSnapshots; depois nada se repete', async () => {
    expect(await historico()).toEqual([...MIGRATIONS_ATE_PORTAL]);
    const repetida = await aplicar({ esperadasAntes: MIGRATIONS_ATE_COMERCIAL, pendente: portal.migration, posteriores: portal.posteriores });
    expect(repetida).toMatchObject({ codigo: 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO', iniciou: false });
    expect(await historico()).toEqual([...MIGRATIONS_ATE_PORTAL]);

    const r = await aplicar({ esperadasAntes: MIGRATIONS_ATE_PORTAL, pendente: multisservicos.migration, posteriores: multisservicos.posteriores });
    expect(r).toMatchObject({ codigo: null, iniciou: true, aplicadas: ['AppointmentServiceSnapshots1793404800000'] });
    expect(r.linhas).toEqual(expect.arrayContaining(['MIGRATIONS_NO_HISTORICO: 13', 'APLICADAS: AppointmentServiceSnapshots1793404800000']));
    // Do kit, nenhuma fica de fora; só as criadas depois dele.
    expect(r.linhas.filter((l) => l.startsWith('FORA_DESTA_ETAPA'))).toEqual([`FORA_DESTA_ETAPA: ${posterioresAoKit.join(',')}`]);
    expect(await historico()).toEqual([...MIGRATIONS_ATE_NOMES_CONGELADOS]);
    expect(falhasDepoisDosNomesCongelados(await estado())).toEqual([]);

    for (const [esperadasAntes, etapa] of [
      [MIGRATIONS_ATE_COMERCIAL, portal],
      [MIGRATIONS_ATE_PORTAL, multisservicos],
    ] as const) {
      const deNovo = await aplicar({ esperadasAntes, pendente: etapa.migration, posteriores: etapa.posteriores });
      expect(deNovo).toMatchObject({ codigo: 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO', iniciou: false });
    }
    expect(await historico()).toEqual([...MIGRATIONS_ATE_NOMES_CONGELADOS]);
  });
});
