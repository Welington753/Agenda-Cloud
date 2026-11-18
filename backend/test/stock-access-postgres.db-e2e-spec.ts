// Acesso ao estoque contra PostgreSQL DESCARTÁVEL, com dados fictícios:
// - isolamento: id de um estabelecimento usado em outro responde 404, e o
//   vínculo num estabelecimento não serve para outro;
// - papéis: dono e gerente com concessão operam; gerente só com "Ver" só
//   consulta; gerente sem concessão, sem confirmação, recepcionista e
//   profissional recusados; papel de plataforma sem vínculo, 404;
// - adicional: sem ele, 403 `RECURSO_NAO_CONTRATADO` para todos, a área
//   sai da sessão, e a concessão ao gerente é recusada;
// - assinatura real (platform/subscription.service.ts): contratar liga,
//   retirar bloqueia preservando produtos, histórico e concessão,
//   recontratar devolve os mesmos dados.
// Não deixa vínculo GERENTE no banco compartilhado ao terminar (o check do
// piloto de gerentes lê o mesmo banco).
import type { DataSource } from 'typeorm';
import { AccountsAdminService } from '../src/accounts/accounts-admin.service.js';
import { hashPassword } from '../src/auth/password-hasher.js';
import { sessionAreas } from '../src/auth/session-areas.js';
import { EstablishmentRole } from '../src/entities/enums/establishment-role.enum.js';
import { SubscriptionService } from '../src/platform/subscription.service.js';
import { StockCategoriesService } from '../src/stock/stock-categories.service.js';
import { StockCountsService } from '../src/stock/stock-counts.service.js';
import { StockMovementsService } from '../src/stock/stock-movements.service.js';
import { StockProductsService } from '../src/stock/stock-products.service.js';
import { TeamService } from '../src/team/team.service.js';
import { garantirPrecoBase } from './support/assinatura.js';
import {
  abrirBanco,
  codigoDe,
  novaChave,
  novoId,
  semeador,
  statusDe,
  urlDoBancoDescartavel,
  type Estabelecimento,
  type Pessoa,
} from './support/estoque.js';

const url = urlDoBancoDescartavel();
const SENHA = 'senha-de-teste-forte-1';

describe.skipIf(!url)('estoque contra PostgreSQL descartável: acesso, isolamento e assinatura', () => {
  let db: DataSource;
  let dados: ReturnType<typeof semeador>;
  let categorias: StockCategoriesService;
  let produtos: StockProductsService;
  let movimentos: StockMovementsService;
  let conferencias: StockCountsService;
  let equipe: TeamService;
  let assinaturas: SubscriptionService;
  let admin: AccountsAdminService;

  const corpoDoProduto = (categoryId: string) => ({
    requestKey: novaChave(),
    name: `Produto ${novoId().slice(0, 6)}`,
    description: null,
    internalCode: null,
    categoryId,
    subcategoryId: null,
    purpose: 'AMBOS' as const,
    unit: 'UN' as const,
    minQuantityMilli: 0,
    initialQuantityMilli: 5000,
  });

  async function preparar(est: Estabelecimento) {
    const categoria = await categorias.create(est.dono.userId, est.tenantId, { name: `Geral ${novoId().slice(0, 4)}` });
    const { product } = await produtos.create(est.dono.userId, est.tenantId, corpoDoProduto(categoria.id));
    const { movement } = await movimentos.create(est.dono.userId, est.tenantId, {
      requestKey: novaChave(),
      productId: product.id,
      kind: 'SAIDA_VENDA',
      quantityMilli: 1000,
      expectedUnit: 'UN',
      reason: null,
    });
    const { count } = await conferencias.create(est.dono.userId, est.tenantId, {
      requestKey: novaChave(),
      note: null,
      items: [{ productId: product.id, expectedBalanceVersion: 2, expectedUnit: 'UN', countedMilli: 4000 }],
    });
    return { categoria, product, movement, count };
  }

  /** Todas as rotas do estoque com os ids dados, para quem age em `tenantId`. */
  function todasAsRotas(userId: string, tenantId: string, ids: Awaited<ReturnType<typeof preparar>>) {
    return {
      'listar categorias': () => categorias.list(userId, tenantId, { status: 'ALL' }),
      'criar categoria': () => categorias.create(userId, tenantId, { name: `Nova ${novoId().slice(0, 4)}` }),
      'renomear categoria': () => categorias.rename(userId, tenantId, ids.categoria.id, { name: `Renomeada ${novoId().slice(0, 4)}` }),
      'criar subcategoria': () => categorias.createSubcategory(userId, tenantId, ids.categoria.id, { name: `Sub ${novoId().slice(0, 4)}` }),
      'listar produtos': () => produtos.list(userId, tenantId, { status: 'ALL' } as never),
      'detalhar produto': () => produtos.get(userId, tenantId, ids.product.id),
      'criar produto': () => produtos.create(userId, tenantId, corpoDoProduto(ids.categoria.id)),
      'arquivar produto': () => produtos.archive(userId, tenantId, ids.product.id),
      'listar movimentações': () => movimentos.list(userId, tenantId, {} as never),
      'registrar movimentação': () =>
        movimentos.create(userId, tenantId, { requestKey: novaChave(), productId: ids.product.id, kind: 'ENTRADA_COMPRA', quantityMilli: 1000, expectedUnit: 'UN', reason: null }),
      'estornar': () => movimentos.reverse(userId, tenantId, ids.movement.id, { requestKey: novaChave(), reason: 'Teste de acesso' }),
      'listar conferências': () => conferencias.list(userId, tenantId, {}),
      'detalhar conferência': () => conferencias.get(userId, tenantId, ids.count.id),
      'conferir': () =>
        conferencias.create(userId, tenantId, {
          requestKey: novaChave(),
          note: null,
          items: [{ productId: ids.product.id, expectedBalanceVersion: 0, expectedUnit: 'UN', countedMilli: 0 }],
        }),
    };
  }

  const CONSULTAS = ['listar categorias', 'listar produtos', 'detalhar produto', 'listar movimentações', 'listar conferências', 'detalhar conferência'];

  async function contarDados(tenantId: string) {
    const [l] = await dados.q<{ produtos: number; movimentos: number; conferencias: number; categorias: number }>(
      `SELECT (SELECT count(*)::int FROM stock_products WHERE tenant_id = $1) AS produtos,
              (SELECT count(*)::int FROM stock_movements WHERE tenant_id = $1) AS movimentos,
              (SELECT count(*)::int FROM stock_counts WHERE tenant_id = $1) AS conferencias,
              (SELECT count(*)::int FROM stock_categories WHERE tenant_id = $1) AS categorias`,
      [tenantId],
    );
    return l;
  }

  beforeAll(async () => {
    db = await abrirBanco(url!);
    dados = semeador(db, `estoque-acesso-${novoId()}`);
    categorias = new StockCategoriesService(db);
    produtos = new StockProductsService(db);
    movimentos = new StockMovementsService(db);
    conferencias = new StockCountsService(db);
    equipe = new TeamService(db);
    assinaturas = new SubscriptionService(db);
    admin = new AccountsAdminService(db);
  }, 120_000);

  afterAll(async () => {
    await dados?.limparGerentes();
    await db?.destroy();
  });

  it('isolamento: ids de A usados em B respondem 404; o vínculo em A não serve para B', async () => {
    const a = await dados.estabelecimento('iso-a');
    const b = await dados.estabelecimento('iso-b');
    const idsDeA = await preparar(a);
    await preparar(b);
    const antesA = await contarDados(a.tenantId);
    // Dono de B, no estabelecimento B, com ids de A: nada de A aparece nem muda.
    for (const [nome, rota] of Object.entries(todasAsRotas(b.dono.userId, b.tenantId, idsDeA))) {
      if (['listar categorias', 'listar produtos', 'listar movimentações', 'listar conferências', 'criar categoria'].includes(nome)) continue;
      const status = await statusDe(rota());
      expect([404, 409], nome).toContain(status);
    }
    const listados = await produtos.list(b.dono.userId, b.tenantId, { status: 'ALL' } as never);
    expect(listados.products.some((p) => p.id === idsDeA.product.id)).toBe(false);
    // Dono de B pedindo o estabelecimento A: sem vínculo, 404 em todas.
    for (const [nome, rota] of Object.entries(todasAsRotas(b.dono.userId, a.tenantId, idsDeA))) {
      expect(await statusDe(rota()), nome).toBe(404);
    }
    expect(await contarDados(a.tenantId)).toEqual(antesA);
  });

  it('papel de plataforma sem vínculo não opera o estoque de nenhum estabelecimento (404)', async () => {
    const est = await dados.estabelecimento('plataforma');
    const ids = await preparar(est);
    const master = await dados.conta('master-estoque', { platformRole: 'MASTER_OWNER' });
    for (const [nome, rota] of Object.entries(todasAsRotas(master.userId, est.tenantId, ids))) {
      expect(await statusDe(rota()), nome).toBe(404);
    }
  });

  it('dono e gerente com "Operar" operam; gerente só com "Ver" só consulta', async () => {
    const est = await dados.estabelecimento('papeis');
    const ids = await preparar(est);
    const operador = await dados.vinculo(est, 'ger-op', 'GERENTE', ['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR']);
    const leitor = await dados.vinculo(est, 'ger-ver', 'GERENTE', ['ESTOQUE_VISUALIZAR']);
    await produtos.create(operador.userId, est.tenantId, corpoDoProduto(ids.categoria.id));
    await movimentos.create(operador.userId, est.tenantId, {
      requestKey: novaChave(),
      productId: ids.product.id,
      kind: 'ENTRADA_COMPRA',
      quantityMilli: 1000,
      expectedUnit: 'UN',
      reason: null,
    });
    for (const [nome, rota] of Object.entries(todasAsRotas(leitor.userId, est.tenantId, ids))) {
      if (CONSULTAS.includes(nome)) await rota();
      else expect(await statusDe(rota()), nome).toBe(403);
    }
  });

  it('gerente sem concessão ou sem confirmação, recepcionista e profissional: 403 em tudo', async () => {
    const est = await dados.estabelecimento('recusas');
    const ids = await preparar(est);
    const semConfirmacao = await dados.vinculo(est, 'ger-pend', 'GERENTE', ['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR']);
    await dados.q(`UPDATE memberships SET permissions_confirmed_at = NULL WHERE id = $1`, [semConfirmacao.membershipId]);
    const pessoas: Pessoa[] = [
      await dados.vinculo(est, 'ger-nada', 'GERENTE'),
      semConfirmacao,
      await dados.vinculo(est, 'recep', 'RECEPCIONISTA', ['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR']),
      await dados.vinculo(est, 'prof', 'PROFISSIONAL', ['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR']),
    ];
    for (const pessoa of pessoas) {
      for (const [nome, rota] of Object.entries(todasAsRotas(pessoa.userId, est.tenantId, ids))) {
        expect(await statusDe(rota()), nome).toBe(403);
      }
    }
  });

  it('sem o adicional: 403 RECURSO_NAO_CONTRATADO para dono e gerente; área fora da sessão', async () => {
    const est = await dados.estabelecimento('sem-adicional');
    const ids = await preparar(est);
    const gerente = await dados.vinculo(est, 'ger', 'GERENTE', ['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR']);
    const areasDoDono = () => sessionAreas(db.manager, { id: est.dono.membershipId, tenantId: est.tenantId, role: EstablishmentRole.DONO });
    const areasDoGerente = () => sessionAreas(db.manager, { id: gerente.membershipId, tenantId: est.tenantId, role: EstablishmentRole.GERENTE });
    expect(await areasDoDono()).toEqual(expect.arrayContaining(['ESTOQUE_VER', 'ESTOQUE_GERENCIAR']));
    expect(await areasDoGerente()).toEqual(expect.arrayContaining(['ESTOQUE_VER', 'ESTOQUE_GERENCIAR']));
    await dados.desligarEstoque(est.tenantId);
    for (const quem of [est.dono, gerente]) {
      for (const [nome, rota] of Object.entries(todasAsRotas(quem.userId, est.tenantId, ids))) {
        expect(await codigoDe(rota()), nome).toBe('RECURSO_NAO_CONTRATADO');
      }
    }
    expect((await areasDoDono()).filter((a) => a.startsWith('ESTOQUE_'))).toEqual([]);
    expect((await areasDoGerente()).filter((a) => a.startsWith('ESTOQUE_'))).toEqual([]);
  });

  it('concessão ao gerente: sem adicional, não concedível e recusada; com ele, "Operar" exige "Ver"', async () => {
    const est = await dados.estabelecimento('concessao', false);
    const gerente = await dados.vinculo(est, 'ger', 'GERENTE', ['CONSUMIDORES_VISUALIZAR']);
    const catalogo = async () =>
      (await equipe.overview(est.dono.userId, est.tenantId)).managerPermissions!.filter((p) => p.area === 'ESTOQUE');
    expect(await catalogo()).toEqual([
      expect.objectContaining({ permission: 'ESTOQUE_VISUALIZAR', grantable: false, areaLabel: 'Estoque' }),
      expect.objectContaining({ permission: 'ESTOQUE_GERENCIAR', grantable: false, requires: ['ESTOQUE_VISUALIZAR'] }),
    ]);
    const conceder = (granted: string[], expectedGranted: string[]) =>
      equipe.setPermissions(est.dono.userId, est.dono.sessionId, est.tenantId, gerente.membershipId, { expectedGranted, granted } as never);
    expect(await codigoDe(conceder(['CONSUMIDORES_VISUALIZAR', 'ESTOQUE_VISUALIZAR'], ['CONSUMIDORES_VISUALIZAR']))).toBe('RECURSO_NAO_CONTRATADO');
    await dados.ligarEstoque(est.tenantId);
    expect((await catalogo()).every((p) => p.grantable)).toBe(true);
    expect(await codigoDe(conceder(['CONSUMIDORES_VISUALIZAR', 'ESTOQUE_GERENCIAR'], ['CONSUMIDORES_VISUALIZAR']))).toBe('PERMISSOES_INCOMPLETAS');
    await conceder(['CONSUMIDORES_VISUALIZAR', 'ESTOQUE_GERENCIAR', 'ESTOQUE_VISUALIZAR'], ['CONSUMIDORES_VISUALIZAR']);
    const categoria = await categorias.create(gerente.userId, est.tenantId, { name: 'Do gerente' });
    expect(categoria.name).toBe('Do gerente');
    // Retirar continua possível mesmo sem o adicional.
    await dados.desligarEstoque(est.tenantId);
    await conceder(['CONSUMIDORES_VISUALIZAR'], ['CONSUMIDORES_VISUALIZAR', 'ESTOQUE_GERENCIAR', 'ESTOQUE_VISUALIZAR']);
  });

  it('assinatura real: contratar liga, retirar bloqueia e preserva tudo, recontratar devolve os mesmos dados', async () => {
    const master = await dados.conta('master-assinatura', { platformRole: 'MASTER_OWNER' });
    await dados.q(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [
      novoId(),
      master.userId,
      await hashPassword(SENHA),
    ]);
    await admin.reauthenticate(master.userId, master.sessionId, SENHA);
    await garantirPrecoBase(db, master.userId);
    const catalogo = await assinaturas.catalog(master.userId);
    const estoque = catalogo.addons.find((a) => a.code === 'ESTOQUE')!;
    expect(estoque).toMatchObject({ availability: 'AVAILABLE', featureKey: 'ESTOQUE' });
    if (estoque.priceCents === null) {
      await assinaturas.setAddonPrice(master.userId, master.sessionId, 'ESTOQUE', {
        requestKey: novaChave(),
        expectedCurrentCents: null,
        amountCents: 1990,
      } as never);
    }
    const est = await dados.estabelecimento('assinatura', false);
    const versao = async () =>
      ((await dados.q<{ updated_at: Date }>('SELECT updated_at FROM tenants WHERE id = $1', [est.tenantId]))[0].updated_at as Date).toISOString();
    const mudar = async (addons: string[], extra: Record<string, unknown> = {}) =>
      assinaturas.change(master.userId, master.sessionId, est.tenantId, {
        expectedUpdatedAt: await versao(),
        requestKey: novaChave(),
        addons,
        teamUserLimit: 5,
        ...extra,
      } as never);

    expect(await codigoDe(categorias.list(est.dono.userId, est.tenantId, { status: 'ALL' }))).toBe('RECURSO_NAO_CONTRATADO');
    // A conversão do plano de teste (com todos os recursos) retira os outros adicionais.
    await mudar(['ESTOQUE'], { confirmRemoval: true });
    const ids = await preparar(est);
    const gerente = await dados.vinculo(est, 'ger', 'GERENTE', ['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR']);
    const antes = await contarDados(est.tenantId);

    expect(await codigoDe(mudar([]))).toBe('RECURSO_SERIA_RETIRADO');
    await mudar([], { confirmRemoval: true });
    for (const quem of [est.dono, gerente]) {
      expect(await codigoDe(produtos.list(quem.userId, est.tenantId, { status: 'ALL' } as never))).toBe('RECURSO_NAO_CONTRATADO');
    }
    expect(await contarDados(est.tenantId)).toEqual(antes);
    const [concessoes] = await dados.q<{ n: number }>(
      `SELECT count(*)::int AS n FROM membership_permission_overrides WHERE membership_id = $1 AND permission::text LIKE 'ESTOQUE_%'`,
      [gerente.membershipId],
    );
    expect(concessoes.n).toBe(2);

    await mudar(['ESTOQUE']);
    expect(await produtos.get(est.dono.userId, est.tenantId, ids.product.id)).toMatchObject({ id: ids.product.id, balanceMilli: 4000 });
    expect((await produtos.list(gerente.userId, est.tenantId, { status: 'ALL' } as never)).products.map((p) => p.id)).toContain(ids.product.id);
    expect((await movimentos.list(gerente.userId, est.tenantId, {} as never)).movements).toHaveLength(antes.movimentos);
  });
});
