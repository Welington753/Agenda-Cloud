// Regras do estoque contra PostgreSQL DESCARTÁVEL (migrations 21 e 22),
// com os serviços de verdade e dados fictícios:
// - categorias e subcategorias: nome único, vínculo inválido recusado pela
//   API e pelo banco, arquivamento bloqueado com produto ativo, filtros;
// - produtos: saldo inicial vira movimentação, edição não toca no saldo,
//   unidade travada depois da primeira movimentação, código único;
// - movimentações: entrada, as três saídas, finalidade, precisão, saldo
//   insuficiente, estorno único, histórico imutável (gatilho), invariante
//   saldo = soma das movimentações;
// - concorrência: saídas simultâneas acima do saldo, entradas simultâneas;
// - reenvio: mesma chave e mesmos dados devolvem o original; dados
//   diferentes, 409 sem gravar (inclusive simultâneo);
// - conferência: ajuste, desatualizada por saldo e por unidade, diferença
//   zero; arquivamento sem perda de histórico.
// Acesso, isolamento e assinatura: stock-access-postgres.db-e2e-spec.ts.
import type { DataSource } from 'typeorm';
import { StockCategoriesService } from '../src/stock/stock-categories.service.js';
import { StockCountsService } from '../src/stock/stock-counts.service.js';
import { StockMovementsService } from '../src/stock/stock-movements.service.js';
import { StockProductsService } from '../src/stock/stock-products.service.js';
import {
  abrirBanco,
  codigoDe,
  erroDe,
  novaChave,
  novoId,
  semeador,
  urlDoBancoDescartavel,
  type Estabelecimento,
} from './support/estoque.js';

const url = urlDoBancoDescartavel();

describe.skipIf(!url)('estoque contra PostgreSQL descartável: regras', () => {
  let db: DataSource;
  let dados: ReturnType<typeof semeador>;
  let categorias: StockCategoriesService;
  let produtos: StockProductsService;
  let movimentos: StockMovementsService;
  let conferencias: StockCountsService;
  let est: Estabelecimento;
  let outro: Estabelecimento;
  let cabelo: string;
  let pomadas: string;
  let barba: string;

  const dono = () => est.dono.userId;
  const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => dados.q<T>(sql, params);

  async function produto(nome: string, extra: Record<string, unknown> = {}) {
    const r = await produtos.create(dono(), est.tenantId, {
      requestKey: novaChave(),
      name: nome,
      description: null,
      internalCode: null,
      categoryId: cabelo,
      subcategoryId: null,
      purpose: 'AMBOS',
      unit: 'UN',
      minQuantityMilli: 0,
      initialQuantityMilli: null,
      ...extra,
    } as never);
    return r.product;
  }

  const mover = (productId: string, kind: string, quantityMilli: number, extra: Record<string, unknown> = {}) =>
    movimentos.create(dono(), est.tenantId, {
      requestKey: novaChave(),
      productId,
      kind,
      quantityMilli,
      expectedUnit: 'UN',
      reason: kind === 'SAIDA_PERDA' ? 'Embalagem danificada' : null,
      ...extra,
    } as never);

  /** Invariante: saldo = soma das movimentações; versão = quantidade. */
  async function conferirInvariante(productId: string) {
    const [l] = await q<{ saldo: string; versao: number; soma: string; total: number }>(
      `SELECT p.balance_milli::text AS saldo, p.balance_version AS versao,
              COALESCE((SELECT sum(delta_milli) FROM stock_movements m WHERE m.product_id = p.id), 0)::text AS soma,
              (SELECT count(*)::int FROM stock_movements m WHERE m.product_id = p.id) AS total
         FROM stock_products p WHERE p.id = $1`,
      [productId],
    );
    expect(l.saldo).toBe(l.soma);
    expect(Number(l.versao)).toBe(l.total);
    return Number(l.saldo);
  }

  beforeAll(async () => {
    db = await abrirBanco(url!);
    dados = semeador(db, `estoque-${novoId()}`);
    categorias = new StockCategoriesService(db);
    produtos = new StockProductsService(db);
    movimentos = new StockMovementsService(db);
    conferencias = new StockCountsService(db);
    est = await dados.estabelecimento('regras');
    outro = await dados.estabelecimento('vizinho');
    cabelo = (await categorias.create(dono(), est.tenantId, { name: 'Cabelo' })).id;
    barba = (await categorias.create(dono(), est.tenantId, { name: 'Barba' })).id;
    const comSub = await categorias.createSubcategory(dono(), est.tenantId, cabelo, { name: 'Pomadas' });
    pomadas = comSub.subcategories[0].id;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe('categorias e subcategorias', () => {
    it('nome único por estabelecimento (sem diferenciar maiúsculas) e por categoria', async () => {
      expect(await codigoDe(categorias.create(dono(), est.tenantId, { name: 'cabelo' }))).toBe('NOME_EM_USO');
      expect(await codigoDe(categorias.createSubcategory(dono(), est.tenantId, cabelo, { name: 'POMADAS' }))).toBe('NOME_EM_USO');
      // Mesmo nome em outra categoria e em outro estabelecimento: pode.
      await categorias.createSubcategory(dono(), est.tenantId, barba, { name: 'Pomadas' });
      await categorias.create(outro.dono.userId, outro.tenantId, { name: 'Cabelo' });
    });

    it('API recusa subcategoria de outra categoria e categoria de outro estabelecimento', async () => {
      const base = { requestKey: novaChave(), name: 'Gel', purpose: 'VENDA', unit: 'UN', minQuantityMilli: 0, description: null, internalCode: null, initialQuantityMilli: null };
      expect(await codigoDe(produtos.create(dono(), est.tenantId, { ...base, categoryId: barba, subcategoryId: pomadas } as never))).toBe(
        'SUBCATEGORIA_INCOMPATIVEL',
      );
      const deFora = (await categorias.list(outro.dono.userId, outro.tenantId, { status: 'ALL' })).categories[0].id;
      expect(await codigoDe(produtos.create(dono(), est.tenantId, { ...base, requestKey: novaChave(), categoryId: deFora, subcategoryId: null } as never))).toBe(
        'CATEGORIA_INVALIDA',
      );
    });

    it('banco recusa direto: categoria inexistente ou de outro estabelecimento (sem subcategoria) e subcategoria alheia', async () => {
      const inserir = (categoryId: string, subcategoryId: string | null, tenantId = est.tenantId) =>
        q(
          `INSERT INTO stock_products (id, tenant_id, category_id, subcategory_id, name, purpose, unit, created_by_user_id, request_key, request_fingerprint)
           VALUES ($1, $2, $3, $4, 'Direto', 'VENDA', 'UN', $5, $6, $7)`,
          [novoId(), tenantId, categoryId, subcategoryId, dono(), novaChave(), 'a'.repeat(64)],
        );
      const deFora = (await categorias.list(outro.dono.userId, outro.tenantId, { status: 'ALL' })).categories[0].id;
      const fk = async (p: Promise<unknown>) => {
        const e = (await erroDe(p)) as Error & { driverError?: { code?: string; constraint?: string } };
        return `${e.driverError?.code}:${e.driverError?.constraint}`;
      };
      expect(await fk(inserir(novoId(), null))).toBe('23503:fk_stock_products_category');
      expect(await fk(inserir(deFora, null))).toBe('23503:fk_stock_products_category');
      expect(await fk(inserir(barba, pomadas))).toBe('23503:fk_stock_products_subcategory');
      const subDeFora = (await categorias.createSubcategory(outro.dono.userId, outro.tenantId, deFora, { name: 'Sub vizinha' })).subcategories[0].id;
      expect(await fk(inserir(cabelo, subDeFora))).toBe('23503:fk_stock_products_subcategory');
    });

    it('arquivar com produto ativo é recusado; sem produto ativo, arquiva junto as subcategorias', async () => {
      const cat = (await categorias.create(dono(), est.tenantId, { name: 'Unhas' })).id;
      const sub = (await categorias.createSubcategory(dono(), est.tenantId, cat, { name: 'Esmaltes' })).subcategories[0].id;
      const p = await produto('Esmalte vermelho', { categoryId: cat, subcategoryId: sub });
      const recusa = await erroDe(categorias.archive(dono(), est.tenantId, cat));
      expect(recusa.getResponse?.()).toMatchObject({ code: 'CATEGORIA_COM_PRODUTOS', activeProducts: 1 });
      expect(await codigoDe(categorias.archiveSubcategory(dono(), est.tenantId, sub))).toBe('CATEGORIA_COM_PRODUTOS');
      await produtos.archive(dono(), est.tenantId, p.id);
      const arquivada = await categorias.archive(dono(), est.tenantId, cat);
      expect(arquivada).toMatchObject({ archived: true, subcategories: [{ id: sub, archived: true }] });
      // Produto arquivado continua ligado à categoria arquivada; reativar exige a categoria ativa.
      expect(await codigoDe(produtos.reactivate(dono(), est.tenantId, p.id))).toBe('CATEGORIA_ARQUIVADA');
      expect(await codigoDe(produto('Novo na arquivada', { categoryId: cat }))).toBe('CATEGORIA_ARQUIVADA');
      // Reativar a categoria não reativa a subcategoria.
      const reativada = await categorias.reactivate(dono(), est.tenantId, cat);
      expect(reativada).toMatchObject({ archived: false, subcategories: [{ id: sub, archived: true }] });
      expect(await codigoDe(produtos.reactivate(dono(), est.tenantId, p.id))).toBe('CATEGORIA_ARQUIVADA');
      await categorias.reactivateSubcategory(dono(), est.tenantId, sub);
      expect(await produtos.reactivate(dono(), est.tenantId, p.id)).toMatchObject({ archived: false, subcategoryId: sub });
    });

    it('filtros de produto por categoria, subcategoria, busca, situação e estoque baixo', async () => {
      const cat = (await categorias.create(dono(), est.tenantId, { name: 'Filtros' })).id;
      const sub = (await categorias.createSubcategory(dono(), est.tenantId, cat, { name: 'Shampoos' })).subcategories[0].id;
      const a = await produto('Shampoo 100% natural', { categoryId: cat, subcategoryId: sub, internalCode: 'SH-01', minQuantityMilli: 5000, initialQuantityMilli: 2000 });
      const b = await produto('Condicionador', { categoryId: cat, minQuantityMilli: 1000, initialQuantityMilli: 9000 });
      const listar = (extra: Record<string, unknown>) =>
        produtos.list(dono(), est.tenantId, { status: 'ACTIVE', ...extra } as never).then((r) => r.products.map((p) => p.id).sort());
      expect(await listar({ categoryId: cat })).toEqual([a.id, b.id].sort());
      expect(await listar({ categoryId: cat, subcategoryId: sub })).toEqual([a.id]);
      expect(await listar({ categoryId: cat, low: true })).toEqual([a.id]);
      expect(await listar({ q: 'sh-01' })).toEqual([a.id]);
      expect(await listar({ q: '100%' })).toEqual([a.id]);
      expect(await listar({ q: '%' })).toEqual([a.id]);
      await produtos.archive(dono(), est.tenantId, b.id);
      expect(await listar({ categoryId: cat })).toEqual([a.id]);
      expect(await listar({ categoryId: cat, status: 'ARCHIVED' })).toEqual([b.id]);
      expect((await produtos.get(dono(), est.tenantId, a.id)).low).toBe(true);
    });
  });

  describe('produtos e movimentações', () => {
    it('saldo inicial vira movimentação; edição muda o cadastro sem tocar no saldo nem no histórico', async () => {
      const p = await produto('Pomada matte', { subcategoryId: pomadas, initialQuantityMilli: 10_000 });
      expect(p).toMatchObject({ balanceMilli: 10_000, balanceVersion: 1 });
      const historico = await movimentos.list(dono(), est.tenantId, { productId: p.id } as never);
      expect(historico.movements).toMatchObject([{ kind: 'SALDO_INICIAL', deltaMilli: 10_000, balanceBeforeMilli: 0, balanceAfterMilli: 10_000 }]);
      const editado = await produtos.update(dono(), est.tenantId, p.id, {
        name: 'Pomada matte 90g',
        description: 'Fixação forte',
        internalCode: null,
        categoryId: cabelo,
        subcategoryId: null,
        purpose: 'VENDA',
        unit: 'UN',
        minQuantityMilli: 3000,
        expectedUpdatedAt: p.updatedAt,
      });
      expect(editado).toMatchObject({ name: 'Pomada matte 90g', balanceMilli: 10_000, balanceVersion: 1, subcategoryId: null });
      expect((await movimentos.list(dono(), est.tenantId, { productId: p.id } as never)).movements).toHaveLength(1);
      // Edição com a versão velha da tela: recusada.
      expect(
        await codigoDe(produtos.update(dono(), est.tenantId, p.id, { ...editado, description: null, expectedUpdatedAt: p.updatedAt } as never)),
      ).toBe('TELA_DESATUALIZADA');
    });

    it('unidade muda antes da primeira movimentação e trava depois', async () => {
      const p = await produto('Lâmina avulsa');
      const emCaixa = await produtos.update(dono(), est.tenantId, p.id, { ...campos(p), unit: 'CX', expectedUpdatedAt: p.updatedAt } as never);
      expect(emCaixa.unit).toBe('CX');
      await mover(p.id, 'ENTRADA_COMPRA', 2000, { expectedUnit: 'CX' });
      const atual = await produtos.get(dono(), est.tenantId, p.id);
      expect(await codigoDe(produtos.update(dono(), est.tenantId, p.id, { ...campos(atual), unit: 'UN', expectedUpdatedAt: atual.updatedAt } as never))).toBe(
        'UNIDADE_TRAVADA',
      );
    });

    it('código interno único por estabelecimento, sem diferenciar maiúsculas', async () => {
      await produto('Navalha', { internalCode: 'NAV-1' });
      expect(await codigoDe(produto('Outra navalha', { internalCode: 'nav-1' }))).toBe('CODIGO_EM_USO');
    });

    it('entrada, saídas por venda, consumo e perda com saldo anterior e posterior; finalidade conferida', async () => {
      const p = await produto('Cera', { purpose: 'VENDA' });
      await mover(p.id, 'ENTRADA_COMPRA', 10_000);
      await mover(p.id, 'SAIDA_VENDA', 3000);
      const perda = await mover(p.id, 'SAIDA_PERDA', 1000);
      expect(perda.movement).toMatchObject({ kind: 'SAIDA_PERDA', deltaMilli: -1000, balanceBeforeMilli: 7000, balanceAfterMilli: 6000, reason: 'Embalagem danificada' });
      expect(perda.movement.recordedBy).toMatchObject({ id: dono() });
      expect(await codigoDe(mover(p.id, 'SAIDA_CONSUMO', 1000))).toBe('FINALIDADE_INCOMPATIVEL');
      const interno = await produto('Álcool 70', { purpose: 'CONSUMO_INTERNO', unit: 'L', initialQuantityMilli: 5000 });
      expect((await mover(interno.id, 'SAIDA_CONSUMO', 250, { expectedUnit: 'L' })).movement.balanceAfterMilli).toBe(4750);
      expect(await codigoDe(mover(interno.id, 'SAIDA_VENDA', 250, { expectedUnit: 'L' }))).toBe('FINALIDADE_INCOMPATIVEL');
      expect(await conferirInvariante(p.id)).toBe(6000);
      expect(await conferirInvariante(interno.id)).toBe(4750);
    });

    it('saldo negativo bloqueado; produto arquivado não movimenta; unidade alterada é recusada', async () => {
      const p = await produto('Gel fixador', { initialQuantityMilli: 2000 });
      expect(await codigoDe(mover(p.id, 'SAIDA_VENDA', 3000))).toBe('SALDO_INSUFICIENTE');
      expect(await codigoDe(mover(p.id, 'ENTRADA_COMPRA', 1000, { expectedUnit: 'CX' }))).toBe('UNIDADE_ALTERADA');
      await produtos.archive(dono(), est.tenantId, p.id);
      expect(await codigoDe(mover(p.id, 'ENTRADA_COMPRA', 1000))).toBe('PRODUTO_ARQUIVADO');
      // Arquivar preservou saldo e histórico.
      expect(await produtos.get(dono(), est.tenantId, p.id)).toMatchObject({ archived: true, balanceMilli: 2000 });
      expect((await movimentos.list(dono(), est.tenantId, { productId: p.id } as never)).movements).toHaveLength(1);
      expect(await conferirInvariante(p.id)).toBe(2000);
    });

    it('precisão: KG com 3 casas sem arredondamento; o banco recusa casas em UN', async () => {
      const p = await produto('Pó descolorante', { unit: 'KG', initialQuantityMilli: 1000 });
      for (const q3 of [1, 333, 333, 333]) await mover(p.id, 'SAIDA_CONSUMO', q3, { expectedUnit: 'KG' });
      expect(await conferirInvariante(p.id)).toBe(0);
      const un = await produto('Pente', { initialQuantityMilli: 1000 });
      const e = (await erroDe(
        q(`UPDATE stock_products SET balance_milli = 1500 WHERE id = $1`, [un.id]),
      )) as Error & { driverError?: { constraint?: string } };
      expect(e.driverError?.constraint).toBe('ck_stock_products_precision');
    });

    it('estorno: uma vez, com referência e motivo; ajuste e estorno não se estornam; saldo negativo bloqueia', async () => {
      const p = await produto('Tônico', { initialQuantityMilli: 5000 });
      const venda = (await mover(p.id, 'SAIDA_VENDA', 2000)).movement;
      const estorno = await movimentos.reverse(dono(), est.tenantId, venda.id, { requestKey: novaChave(), reason: 'Venda lançada errado' });
      expect(estorno.movement).toMatchObject({ kind: 'ESTORNO', deltaMilli: 2000, reversesMovementId: venda.id, balanceAfterMilli: 5000 });
      expect(await codigoDe(movimentos.reverse(dono(), est.tenantId, venda.id, { requestKey: novaChave(), reason: 'De novo' }))).toBe('JA_ESTORNADA');
      expect(await codigoDe(movimentos.reverse(dono(), est.tenantId, estorno.movement.id, { requestKey: novaChave(), reason: 'Estorno do estorno' }))).toBe(
        'NAO_ESTORNAVEL',
      );
      const original = (await movimentos.list(dono(), est.tenantId, { productId: p.id } as never)).movements.find((m) => m.id === venda.id)!;
      expect(original).toMatchObject({ reversedByMovementId: estorno.movement.id, deltaMilli: -2000 });
      // Estornar uma entrada já consumida deixaria o saldo negativo.
      const entrada = (await mover(p.id, 'ENTRADA_COMPRA', 3000)).movement;
      await mover(p.id, 'SAIDA_VENDA', 8000);
      expect(await codigoDe(movimentos.reverse(dono(), est.tenantId, entrada.id, { requestKey: novaChave(), reason: 'Entrada duplicada' }))).toBe(
        'SALDO_INSUFICIENTE',
      );
      expect(await conferirInvariante(p.id)).toBe(0);
    });

    it('histórico imutável: o banco recusa UPDATE e DELETE de movimentação', async () => {
      const p = await produto('Talco', { initialQuantityMilli: 1000 });
      const [m] = await q<{ id: string }>(`SELECT id FROM stock_movements WHERE product_id = $1`, [p.id]);
      for (const sql of [`UPDATE stock_movements SET reason = 'x' WHERE id = $1`, `DELETE FROM stock_movements WHERE id = $1`]) {
        const e = (await erroDe(q(sql, [m.id]))) as Error & { driverError?: { code?: string } };
        expect(e.driverError?.code).toBe('23001');
      }
    });
  });

  describe('concorrência e reenvio', () => {
    it('saídas simultâneas que juntas passam do saldo: só uma grava', async () => {
      const p = await produto('Óleo de barba', { initialQuantityMilli: 5000 });
      const resultados = await Promise.allSettled([mover(p.id, 'SAIDA_VENDA', 4000), mover(p.id, 'SAIDA_VENDA', 4000)]);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((recusa.reason as { getResponse: () => { code: string } }).getResponse().code).toBe('SALDO_INSUFICIENTE');
      expect(await conferirInvariante(p.id)).toBe(1000);
    });

    it('dez entradas simultâneas: nenhuma se perde', async () => {
      const p = await produto('Algodão');
      await Promise.all(Array.from({ length: 10 }, () => mover(p.id, 'ENTRADA_COMPRA', 1000)));
      expect(await conferirInvariante(p.id)).toBe(10_000);
    });

    it('mesma chave e mesmos dados devolvem o original (sequencial e simultâneo)', async () => {
      const p = await produto('Escova', { initialQuantityMilli: 9000 });
      const corpo = { requestKey: novaChave(), productId: p.id, kind: 'SAIDA_VENDA', quantityMilli: 1000, expectedUnit: 'UN', reason: ' Balcão ' };
      const primeiro = await movimentos.create(dono(), est.tenantId, corpo as never);
      const repetido = await movimentos.create(dono(), est.tenantId, { ...corpo, reason: 'Balcão' } as never);
      expect(primeiro.created).toBe(true);
      expect(repetido).toEqual({ created: false, movement: primeiro.movement });
      const simultaneo = { ...corpo, requestKey: novaChave() };
      const [a, b] = await Promise.all([movimentos.create(dono(), est.tenantId, simultaneo as never), movimentos.create(dono(), est.tenantId, simultaneo as never)]);
      expect([a.created, b.created].sort()).toEqual([false, true]);
      expect(a.movement.id).toBe(b.movement.id);
      expect(await conferirInvariante(p.id)).toBe(7000);
    });

    it.each([
      ['produto', { productId: 'OUTRO' }],
      ['quantidade', { quantityMilli: 2000 }],
      ['tipo', { kind: 'SAIDA_PERDA', reason: 'Quebrou' }],
      ['motivo', { reason: 'Outro motivo' }],
      ['unidade esperada', { expectedUnit: 'CX' }],
    ])('mesma chave com outro(a) %s: 409 sem gravar', async (_nome, mudanca) => {
      const p = await produto(`Reenvio ${novoId().slice(0, 5)}`, { initialQuantityMilli: 9000 });
      const outroProduto = await produto(`Outro ${novoId().slice(0, 5)}`, { initialQuantityMilli: 9000 });
      const corpo = { requestKey: novaChave(), productId: p.id, kind: 'SAIDA_VENDA', quantityMilli: 1000, expectedUnit: 'UN', reason: null };
      await movimentos.create(dono(), est.tenantId, corpo as never);
      const alterado = { ...corpo, ...mudanca, productId: (mudanca as { productId?: string }).productId === 'OUTRO' ? outroProduto.id : corpo.productId };
      expect(await codigoDe(movimentos.create(dono(), est.tenantId, alterado as never))).toBe('CHAVE_REUTILIZADA');
      expect(await conferirInvariante(p.id)).toBe(8000);
      expect(await conferirInvariante(outroProduto.id)).toBe(9000);
    });

    it('mesma chave com dados diferentes ao mesmo tempo: uma grava, a outra recebe 409', async () => {
      const p = await produto('Pincel', { initialQuantityMilli: 9000 });
      const chave = novaChave();
      const base = { requestKey: chave, productId: p.id, kind: 'SAIDA_VENDA', expectedUnit: 'UN', reason: null };
      const r = await Promise.allSettled([
        movimentos.create(dono(), est.tenantId, { ...base, quantityMilli: 1000 } as never),
        movimentos.create(dono(), est.tenantId, { ...base, quantityMilli: 2000 } as never),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const recusa = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect((recusa.reason as { getResponse: () => { code: string } }).getResponse().code).toBe('CHAVE_REUTILIZADA');
      expect([8000, 7000]).toContain(await conferirInvariante(p.id));
    });

    it('produto: mesma chave e dados devolvem o mesmo produto; dados diferentes, 409', async () => {
      const corpo = { requestKey: novaChave(), name: 'Máquina', description: null, internalCode: null, categoryId: cabelo, subcategoryId: null, purpose: 'VENDA', unit: 'UN', minQuantityMilli: 0, initialQuantityMilli: 2000 };
      const a = await produtos.create(dono(), est.tenantId, corpo as never);
      const b = await produtos.create(dono(), est.tenantId, { ...corpo, description: '  ' } as never);
      expect(b).toEqual({ created: false, product: a.product });
      expect(await codigoDe(produtos.create(dono(), est.tenantId, { ...corpo, initialQuantityMilli: 3000 } as never))).toBe('CHAVE_REUTILIZADA');
      expect(await conferirInvariante(a.product.id)).toBe(2000);
    });

    it('chave já usada pelo mesmo usuário em outro estabelecimento: 409 sem expor nada', async () => {
      const segundo = await dados.estabelecimento('segundo');
      await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [novoId(), dono(), segundo.tenantId]);
      const catSegundo = (await categorias.create(dono(), segundo.tenantId, { name: 'Geral' })).id;
      const corpo = { requestKey: novaChave(), name: 'Item', description: null, internalCode: null, categoryId: cabelo, subcategoryId: null, purpose: 'VENDA', unit: 'UN', minQuantityMilli: 0, initialQuantityMilli: null };
      await produtos.create(dono(), est.tenantId, corpo as never);
      expect(await codigoDe(produtos.create(dono(), segundo.tenantId, { ...corpo, categoryId: catSegundo } as never))).toBe('CHAVE_EM_USO');
    });
  });

  describe('conferência', () => {
    it('ajusta a diferença, registra item sem diferença e guarda unidade e versão esperadas', async () => {
      const a = await produto('Conf A', { initialQuantityMilli: 10_000 });
      const b = await produto('Conf B', { initialQuantityMilli: 4000 });
      const r = await conferencias.create(dono(), est.tenantId, {
        requestKey: novaChave(),
        note: 'Contagem de sexta',
        items: [
          { productId: a.id, expectedBalanceVersion: 1, expectedUnit: 'UN', countedMilli: 8000 },
          { productId: b.id, expectedBalanceVersion: 1, expectedUnit: 'UN', countedMilli: 4000 },
        ],
      });
      expect(r.count).toMatchObject({ itemCount: 2, adjustedCount: 1, note: 'Contagem de sexta' });
      const itemA = r.count.items!.find((i) => i.productId === a.id)!;
      expect(itemA).toMatchObject({ expectedMilli: 10_000, countedMilli: 8000, differenceMilli: -2000, expectedUnit: 'UN' });
      expect(r.count.items!.find((i) => i.productId === b.id)).toMatchObject({ differenceMilli: 0, movementId: null });
      const ajuste = (await movimentos.list(dono(), est.tenantId, { productId: a.id, kind: 'AJUSTE_CONFERENCIA' } as never)).movements[0];
      expect(ajuste).toMatchObject({ id: itemA.movementId, deltaMilli: -2000, countId: r.count.id, reason: 'Contagem de sexta' });
      expect(await conferirInvariante(a.id)).toBe(8000);
      expect(await conferirInvariante(b.id)).toBe(4000);
    });

    it('desatualizada por movimentação concorrente: 409 com o estado atual, nada gravado', async () => {
      const a = await produto('Desat A', { initialQuantityMilli: 5000 });
      const b = await produto('Desat B', { initialQuantityMilli: 5000 });
      await mover(a.id, 'SAIDA_VENDA', 1000); // outra tela, depois de a contagem começar
      const antes = Number((await q<{ n: number }>(`SELECT count(*)::int AS n FROM stock_counts WHERE tenant_id = $1`, [est.tenantId]))[0].n);
      const e = await erroDe(
        conferencias.create(dono(), est.tenantId, {
          requestKey: novaChave(),
          note: null,
          items: [
            { productId: a.id, expectedBalanceVersion: 1, expectedUnit: 'UN', countedMilli: 3000 },
            { productId: b.id, expectedBalanceVersion: 1, expectedUnit: 'UN', countedMilli: 2000 },
          ],
        }),
      );
      expect(e.getResponse?.()).toMatchObject({ code: 'CONFERENCIA_DESATUALIZADA', items: [{ productId: a.id, balanceMilli: 4000, balanceVersion: 2, unit: 'UN' }] });
      expect(Number((await q<{ n: number }>(`SELECT count(*)::int AS n FROM stock_counts WHERE tenant_id = $1`, [est.tenantId]))[0].n)).toBe(antes);
      expect(await conferirInvariante(a.id)).toBe(4000);
      expect(await conferirInvariante(b.id)).toBe(5000);
    });

    it('desatualizada por troca de unidade antes da primeira movimentação (UN → CX em outra tela)', async () => {
      const p = await produto('Contagem em UN');
      await produtos.update(dono(), est.tenantId, p.id, { ...campos(p), unit: 'CX', expectedUpdatedAt: p.updatedAt } as never);
      const e = await erroDe(
        conferencias.create(dono(), est.tenantId, {
          requestKey: novaChave(),
          note: null,
          items: [{ productId: p.id, expectedBalanceVersion: 0, expectedUnit: 'UN', countedMilli: 3000 }],
        }),
      );
      expect(e.getResponse?.()).toMatchObject({ code: 'CONFERENCIA_DESATUALIZADA', items: [{ productId: p.id, balanceVersion: 0, unit: 'CX' }] });
      expect(await conferirInvariante(p.id)).toBe(0);
    });

    it('produto arquivado entra como desatualizado; reenvio com outros itens: 409 sem gravar', async () => {
      const p = await produto('Arquivado na contagem', { initialQuantityMilli: 1000 });
      await produtos.archive(dono(), est.tenantId, p.id);
      expect(
        await codigoDe(
          conferencias.create(dono(), est.tenantId, { requestKey: novaChave(), note: null, items: [{ productId: p.id, expectedBalanceVersion: 1, expectedUnit: 'UN', countedMilli: 0 }] }),
        ),
      ).toBe('CONFERENCIA_DESATUALIZADA');
      const q1 = await produto('Reenvio conferência', { initialQuantityMilli: 1000 });
      const corpo = { requestKey: novaChave(), note: null, items: [{ productId: q1.id, expectedBalanceVersion: 1, expectedUnit: 'UN' as const, countedMilli: 1000 }] };
      const primeiro = await conferencias.create(dono(), est.tenantId, corpo);
      expect(await conferencias.create(dono(), est.tenantId, corpo)).toEqual({ created: false, count: primeiro.count });
      expect(await codigoDe(conferencias.create(dono(), est.tenantId, { ...corpo, items: [{ ...corpo.items[0], countedMilli: 2000 }] }))).toBe('CHAVE_REUTILIZADA');
      expect(await conferirInvariante(q1.id)).toBe(1000);
    });
  });
});

function campos(p: { name: string; description: string | null; internalCode: string | null; categoryId: string; subcategoryId: string | null; purpose: string; unit: string; minQuantityMilli: number }) {
  return {
    name: p.name,
    description: p.description,
    internalCode: p.internalCode,
    categoryId: p.categoryId,
    subcategoryId: p.subcategoryId,
    purpose: p.purpose,
    unit: p.unit,
    minQuantityMilli: p.minQuantityMilli,
  };
}
