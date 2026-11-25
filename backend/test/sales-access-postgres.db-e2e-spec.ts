// Acesso da API de vendas (PR 3 de docs/plans/vendas-v1.md) contra
// PostgreSQL descartável com dados fictícios: matriz por papel e concessão,
// catálogo sem saldo numérico para quem não consulta o estoque, busca
// limitada de clientes, escopo das consultas e dos totais, compras na ficha,
// VENDAS retirado com a manutenção ativa e isolamento entre estabelecimentos
// em todas as rotas, inclusive nas de manutenção sem recurso.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { abrirBanco, codigoDe, novaChave, statusDe, urlDoBancoDescartavel, type Estabelecimento, type Pessoa } from './support/estoque.js';
import { apoioDeVendas } from './support/vendas.js';

const url = urlDoBancoDescartavel();

describe.skipIf(!url)('vendas, PR 3: acesso da API contra PostgreSQL descartável', () => {
  let db: DataSource;
  let v: ReturnType<typeof apoioDeVendas>;
  let est: Estabelecimento;
  let vizinha: Estabelecimento;
  let produto: string;
  let rita: Pessoa;
  let ritaRecebe: Pessoa;
  let gerenteVende: Pessoa;
  let gerenteRecebe: Pessoa;
  let gerenteConsulta: Pessoa;
  let gerenteTudo: Pessoa;
  let funcionario: Pessoa;

  const recebimento = () => ({ requestKey: novaChave(), method: 'PIX' as const, receivedOn: v.hoje(), notes: null });
  const venderComo = async (quem: Pessoa, e = est, p = produto) => (await v.vender(e, quem, [await v.item(p, 1_000)])).sale;

  beforeAll(async () => {
    db = await abrirBanco(url!);
    v = apoioDeVendas(db, `vendas-acesso-${Date.now()}`);
    est = await v.loja('loja');
    vizinha = await v.loja('vizinha');
    produto = await v.produto(est, 'Pomada', 1_000_000, { preco: 2_000 });
    rita = await v.dados.vinculo(est, 'rita', 'RECEPCIONISTA', ['VENDAS_REGISTRAR']);
    ritaRecebe = await v.dados.vinculo(est, 'rita-recebe', 'RECEPCIONISTA', ['VENDAS_REGISTRAR', 'VENDAS_RECEBER']);
    gerenteVende = await v.dados.vinculo(est, 'g-vende', 'GERENTE', ['VENDAS_REGISTRAR']);
    gerenteRecebe = await v.dados.vinculo(est, 'g-recebe', 'GERENTE', ['VENDAS_REGISTRAR', 'VENDAS_RECEBER']);
    gerenteConsulta = await v.dados.vinculo(est, 'g-consulta', 'GERENTE', ['VENDAS_VISUALIZAR', 'CONSUMIDORES_VISUALIZAR']);
    gerenteTudo = await v.dados.vinculo(est, 'g-tudo', 'GERENTE', [
      'VENDAS_REGISTRAR',
      'VENDAS_RECEBER',
      'VENDAS_VISUALIZAR',
      'VENDAS_CANCELAR',
      'VENDAS_ESTORNAR_RECEBIMENTO',
      'CONSUMIDORES_VISUALIZAR',
    ]);
    funcionario = await v.dados.vinculo(est, 'func', 'PROFISSIONAL');
  }, 120_000);

  afterAll(async () => {
    await v?.dados.limparGerentes();
    await db?.destroy();
  });

  describe('catálogo da venda', () => {
    it('só produtos de venda ativos em categoria ativa; saldo numérico só para quem consulta o estoque', async () => {
      const loja = await v.loja('catalogo');
      const venda = await v.produto(loja, 'Catálogo venda', 5_000, { preco: 1_500 });
      const ambos = await v.produto(loja, 'Catálogo ambos', 0, { purpose: 'AMBOS', preco: null });
      await v.produto(loja, 'Catálogo consumo', 5_000, { purpose: 'CONSUMO_INTERNO' });
      const arquivado = await v.produto(loja, 'Catálogo arquivado', 5_000);
      await v.produtos.archive(loja.dono.userId, loja.tenantId, arquivado);
      const recepcao = await v.dados.vinculo(loja, 'recepcao', 'RECEPCIONISTA', ['VENDAS_REGISTRAR']);

      const doDono = await v.vendas.catalog(loja.dono.userId, loja.tenantId, {});
      expect(doDono.showsBalance).toBe(true);
      expect(doDono.products).toEqual([
        { id: ambos, name: 'Catálogo ambos', unit: 'UN', salePriceCents: null, available: false, balanceMilli: 0 },
        { id: venda, name: 'Catálogo venda', unit: 'UN', salePriceCents: 1_500, available: true, balanceMilli: 5_000 },
      ]);
      const daRecepcao = await v.vendas.catalog(recepcao.userId, loja.tenantId, {});
      expect(daRecepcao.showsBalance).toBe(false);
      expect(daRecepcao.products).toEqual([
        { id: ambos, name: 'Catálogo ambos', unit: 'UN', salePriceCents: null, available: false },
        { id: venda, name: 'Catálogo venda', unit: 'UN', salePriceCents: 1_500, available: true },
      ]);
      // Recusa por saldo sem dizer quanto há, para quem não consulta o estoque.
      const recusa = await v.vender(loja, recepcao, [await v.item(venda, 6_000)]).catch((e: { response: unknown }) => e.response);
      expect(recusa).toMatchObject({ code: 'SALDO_INSUFICIENTE', products: [{ productId: venda, name: 'Catálogo venda' }] });
      expect(JSON.stringify(recusa)).not.toContain('balanceMilli');

      // Categoria arquivada some do catálogo.
      await v.q(`UPDATE stock_categories SET archived_at = now() WHERE tenant_id = $1`, [loja.tenantId]);
      expect((await v.vendas.catalog(loja.dono.userId, loja.tenantId, {})).products).toEqual([]);
    });
  });

  describe('busca de clientes da venda', () => {
    it('nome ou os quatro últimos dígitos; só id, nome e esses dígitos; nunca cadastro unificado', async () => {
      const loja = await v.loja('busca');
      const a = await v.cliente(loja, 'Joana Lima');
      const b = await v.cliente(loja, 'Joana Lima');
      const recepcao = await v.dados.vinculo(loja, 'recepcao', 'RECEPCIONISTA', ['VENDAS_REGISTRAR']);
      const r = await v.vendas.searchConsumers(recepcao.userId, loja.tenantId, 'joana');
      expect(r.consumers.map((c) => c.id).sort()).toEqual([a, b].sort());
      for (const c of r.consumers) {
        expect(Object.keys(c).sort()).toEqual(['id', 'name', 'phoneLast4']);
        expect(c.phoneLast4).toMatch(/^\d{4}$/);
      }
      const [tel] = await v.q<{ w: string }>(`SELECT whatsapp_normalized AS w FROM consumers WHERE id = $1`, [a]);
      const porDigitos = await v.vendas.searchConsumers(recepcao.userId, loja.tenantId, tel.w.slice(-4));
      expect(porDigitos.consumers.map((c) => c.id)).toContain(a);
      // Telefone inteiro não vira busca de telefone.
      expect((await v.vendas.searchConsumers(recepcao.userId, loja.tenantId, tel.w.slice(-8))).consumers).toEqual([]);
      const previa = await v.unificacao.preview(loja.dono.userId, loja.tenantId, b, a);
      await v.unificacao.merge(loja.dono.userId, loja.tenantId, b, { principalId: a, versaoDaPrevia: previa.versaoDaPrevia });
      expect((await v.vendas.searchConsumers(recepcao.userId, loja.tenantId, 'joana')).consumers.map((c) => c.id)).toEqual([a]);
    });
  });

  describe('matriz', () => {
    it('recepcionista que vende: catálogo, venda no preço sugerido e as próprias operações; nada além', async () => {
      const minha = await venderComo(rita);
      const doDono = await venderComo(est.dono);
      expect(await codigoDe(v.vender(est, rita, [await v.item(produto, 1_000, 1_500)]))).toBe('PRECO_NAO_AUTORIZADO');
      const lista = await v.vendas.list(rita.userId, est.tenantId, { scope: 'mine' });
      expect(lista.sales.every((s) => s.recordedBy.id === rita.userId)).toBe(true);
      expect(lista.sales.map((s) => s.id)).toContain(minha.id);
      expect((await v.vendas.get(rita.userId, est.tenantId, minha.id)).id).toBe(minha.id);
      expect(await statusDe(v.vendas.get(rita.userId, est.tenantId, doDono.id))).toBe(404);
      expect(await statusDe(v.vendas.list(rita.userId, est.tenantId, { scope: 'all' }))).toBe(403);
      expect(await statusDe(v.recebimentos.list(rita.userId, est.tenantId, { scope: 'all' }))).toBe(403);
      expect(await statusDe(v.recebimentos.record(rita.userId, est.tenantId, minha.id, recebimento()))).toBe(403);
      await v.reconfirmarSenha(rita);
      expect(await statusDe(v.vendas.cancel(rita.userId, rita.sessionId, est.tenantId, minha.id, { reason: 'Tentativa da recepção' }))).toBe(403);
      expect(await statusDe(v.vendas.purchases(rita.userId, est.tenantId, 'qualquer', {}))).toBe(403);
    });

    it('recepcionista que recebe: só as vendas que ela registrou', async () => {
      const minha = await venderComo(ritaRecebe);
      const doDono = await venderComo(est.dono);
      expect((await v.recebimentos.record(ritaRecebe.userId, est.tenantId, minha.id, recebimento())).created).toBe(true);
      expect(await codigoDe(v.recebimentos.record(ritaRecebe.userId, est.tenantId, doDono.id, recebimento()))).toBe('VENDA_DE_OUTRA_PESSOA');
      const meus = await v.recebimentos.list(ritaRecebe.userId, est.tenantId, { scope: 'mine' });
      expect(meus.payments.every((p) => p.recordedBy.id === ritaRecebe.userId)).toBe(true);
      expect(meus.summary.receivedCents).toBe(meus.payments.reduce((s, p) => s + p.amountCents, 0));
    });

    it('gerente: receber de outra pessoa exige receber E consultar todas; consulta sozinha não recebe', async () => {
      const deOutro = await venderComo(est.dono);
      const propria = await venderComo(gerenteRecebe);
      expect((await v.recebimentos.record(gerenteRecebe.userId, est.tenantId, propria.id, recebimento())).created).toBe(true);
      expect(await codigoDe(v.recebimentos.record(gerenteRecebe.userId, est.tenantId, deOutro.id, recebimento()))).toBe('VENDA_DE_OUTRA_PESSOA');
      expect(await statusDe(v.recebimentos.record(gerenteConsulta.userId, est.tenantId, deOutro.id, recebimento()))).toBe(403);
      expect((await v.vendas.get(gerenteConsulta.userId, est.tenantId, deOutro.id)).id).toBe(deOutro.id);
      expect((await v.recebimentos.record(gerenteTudo.userId, est.tenantId, deOutro.id, recebimento())).created).toBe(true);
      expect(await statusDe(v.vender(est, gerenteConsulta, [await v.item(produto, 1_000)]))).toBe(403);
      expect((await v.vender(est, gerenteVende, [await v.item(produto, 1_000)])).created).toBe(true);
    });

    it('gerente com tudo cancela e estorna; sem as concessões, 403; funcionário nunca', async () => {
      const venda = await venderComo(est.dono);
      const { payment } = await v.recebimentos.record(est.dono.userId, est.tenantId, venda.id, recebimento());
      await v.reconfirmarSenha(gerenteRecebe);
      expect(await statusDe(v.recebimentos.refund(gerenteRecebe.userId, gerenteRecebe.sessionId, est.tenantId, payment.id, { reason: 'Sem permissão' }))).toBe(403);
      await v.reconfirmarSenha(gerenteTudo);
      await v.recebimentos.refund(gerenteTudo.userId, gerenteTudo.sessionId, est.tenantId, payment.id, { reason: 'Cliente pediu' });
      expect((await v.vendas.cancel(gerenteTudo.userId, gerenteTudo.sessionId, est.tenantId, venda.id, { reason: 'Cliente pediu' })).sale.status).toBe('CANCELADA');
      for (const chamada of [
        async () => v.vendas.catalog(funcionario.userId, est.tenantId, {}),
        async () => v.vendas.searchConsumers(funcionario.userId, est.tenantId, 'ana'),
        async () => v.vender(est, funcionario, [await v.item(produto, 1_000)]),
        async () => v.vendas.list(funcionario.userId, est.tenantId, { scope: 'mine' }),
        async () => v.vendas.get(funcionario.userId, est.tenantId, venda.id),
        async () => v.recebimentos.list(funcionario.userId, est.tenantId, { scope: 'mine' }),
      ]) {
        expect(await statusDe(chamada())).toBe(403);
      }
    });
  });

  describe('escopo das consultas e dos totais', () => {
    it('"mine" conta só o que a pessoa registrou; "all" conta o estabelecimento inteiro e nada da vizinha', async () => {
      const loja = await v.loja('totais');
      const p = await v.produto(loja, 'Totais', 1_000_000, { preco: 1_000 });
      const recepcao = await v.dados.vinculo(loja, 'recepcao', 'RECEPCIONISTA', ['VENDAS_REGISTRAR', 'VENDAS_RECEBER']);
      const daRecepcao = (await v.vender(loja, recepcao, [await v.item(p, 2_000)])).sale;
      await v.vender(loja, loja.dono, [await v.item(p, 3_000)]);
      const cancelada = (await v.vender(loja, loja.dono, [await v.item(p, 1_000)])).sale;
      await v.vendas.cancel(loja.dono.userId, loja.dono.sessionId, loja.tenantId, cancelada.id, { reason: 'Cliente desistiu' });
      await v.recebimentos.record(recepcao.userId, loja.tenantId, daRecepcao.id, recebimento());
      const vizinhaP = await v.produto(vizinha, 'Totais vizinha', 1_000_000, { preco: 99_999 });
      await v.vender(vizinha, vizinha.dono, [await v.item(vizinhaP, 1_000)]);

      expect((await v.vendas.list(recepcao.userId, loja.tenantId, { scope: 'mine' })).summary).toEqual({ activeSales: 1, soldCents: 2_000, cancelledSales: 0 });
      expect((await v.vendas.list(loja.dono.userId, loja.tenantId, { scope: 'all' })).summary).toEqual({ activeSales: 2, soldCents: 5_000, cancelledSales: 1 });
      expect((await v.vendas.list(loja.dono.userId, loja.tenantId, { scope: 'all', status: 'CANCELADA' })).sales.map((s) => s.id)).toEqual([cancelada.id]);
      expect((await v.recebimentos.list(loja.dono.userId, loja.tenantId, { scope: 'mine' })).summary.receivedCents).toBe(0);
      expect((await v.recebimentos.list(loja.dono.userId, loja.tenantId, { scope: 'all' })).summary).toEqual({ receivedCents: 2_000, refundedCents: 0, netCents: 2_000 });
    });
  });

  describe('compras na ficha do cliente', () => {
    it('consulta geral de vendas e de clientes; saída manual antiga não é compra; lápide responde CLIENTE_UNIFICADO', async () => {
      const c = await v.cliente(est, 'Fernanda Ficha');
      const venda = (await v.vender(est, est.dono, [await v.item(produto, 2_000)], { consumerId: c })).sale;
      const r = await v.vendas.purchases(gerenteConsulta.userId, est.tenantId, c, {});
      expect(r.purchases.map((p) => p.id)).toEqual([venda.id]);
      expect(r.purchases[0]).toMatchObject({ totalCents: 4_000, status: 'ATIVA', items: [{ productName: 'Pomada', quantityMilli: 2_000, unit: 'UN' }], payment: null });
      expect(await statusDe(v.vendas.purchases(gerenteVende.userId, est.tenantId, c, {}))).toBe(403);
      const semClientes = await v.dados.vinculo(est, 'g-so-vendas', 'GERENTE', ['VENDAS_VISUALIZAR']);
      expect(await statusDe(v.vendas.purchases(semClientes.userId, est.tenantId, c, {}))).toBe(403);

      const dup = await v.cliente(est, 'Fernanda Ficha');
      const previa = await v.unificacao.preview(est.dono.userId, est.tenantId, c, dup);
      await v.unificacao.merge(est.dono.userId, est.tenantId, c, { principalId: dup, versaoDaPrevia: previa.versaoDaPrevia });
      expect(await codigoDe(v.vendas.purchases(est.dono.userId, est.tenantId, c, {}))).toBe('CLIENTE_UNIFICADO');
      expect((await v.vendas.purchases(est.dono.userId, est.tenantId, dup, {})).purchases.map((p) => p.id)).toEqual([venda.id]);
    });
  });

  describe('VENDAS retirado: nova venda recusada, manutenção continua', () => {
    it('catálogo, busca e venda nova respondem RECURSO_NAO_CONTRATADO; consultar, receber, estornar, cancelar e compras seguem', async () => {
      const loja = await v.loja('retirada');
      const p = await v.produto(loja, 'Retirada', 10_000, { preco: 1_000 });
      const c = await v.cliente(loja, 'Gabi Retirada');
      const recepcao = await v.dados.vinculo(loja, 'recepcao', 'RECEPCIONISTA', ['VENDAS_REGISTRAR', 'VENDAS_RECEBER']);
      const daRecepcao = (await v.vender(loja, recepcao, [await v.item(p, 1_000)])).sale;
      const doDono = (await v.vender(loja, loja.dono, [await v.item(p, 2_000)], { consumerId: c })).sale;
      const item = await v.item(p, 1_000);
      await v.desligarVendas(loja.tenantId);

      for (const chamada of [
        async () => v.vendas.catalog(loja.dono.userId, loja.tenantId, {}),
        async () => v.vendas.searchConsumers(loja.dono.userId, loja.tenantId, 'gabi'),
        async () => v.vender(loja, loja.dono, [item]),
        async () => v.vender(loja, recepcao, [item]),
      ]) {
        expect(await codigoDe(chamada())).toBe('RECURSO_NAO_CONTRATADO');
      }
      expect((await v.vendas.list(recepcao.userId, loja.tenantId, { scope: 'mine' })).sales.map((s) => s.id)).toEqual([daRecepcao.id]);
      expect((await v.vendas.get(loja.dono.userId, loja.tenantId, doDono.id)).id).toBe(doDono.id);
      const { payment } = await v.recebimentos.record(recepcao.userId, loja.tenantId, daRecepcao.id, recebimento());
      await v.recebimentos.refund(loja.dono.userId, loja.dono.sessionId, loja.tenantId, payment.id, { reason: 'Cliente pediu de volta' });
      await v.vendas.cancel(loja.dono.userId, loja.dono.sessionId, loja.tenantId, daRecepcao.id, { reason: 'Cliente pediu de volta' });
      expect(await v.saldo(p)).toBe(8_000);
      expect((await v.vendas.purchases(loja.dono.userId, loja.tenantId, c, {})).purchases.map((s) => s.id)).toEqual([doDono.id]);

      // Sem ESTOQUE também (estado incoerente vindo de fora): nova venda recusada, cancelamento devolve ao saldo.
      await v.ligarVendas(loja.tenantId);
      await v.dados.desligarEstoque(loja.tenantId);
      expect(await codigoDe(v.vender(loja, loja.dono, [item]))).toBe('RECURSO_NAO_CONTRATADO');
      await v.vendas.cancel(loja.dono.userId, loja.dono.sessionId, loja.tenantId, doDono.id, { reason: 'Cliente desistiu' });
      expect(await v.saldo(p)).toBe(10_000);
    });
  });

  describe('isolamento entre estabelecimentos', () => {
    it('ids de outro estabelecimento respondem 404 em todas as rotas, inclusive nas de manutenção', async () => {
      const venda = await venderComo(est.dono);
      const { payment } = await v.recebimentos.record(est.dono.userId, est.tenantId, venda.id, recebimento());
      const c = await v.cliente(est, 'Helena Isolada');
      const intruso = vizinha.dono;
      await v.reconfirmarSenha(intruso);
      for (const chamada of [
        async () => v.vendas.get(intruso.userId, vizinha.tenantId, venda.id),
        async () => v.vendas.cancel(intruso.userId, intruso.sessionId, vizinha.tenantId, venda.id, { reason: 'Intruso tentando' }),
        async () => v.recebimentos.record(intruso.userId, vizinha.tenantId, venda.id, recebimento()),
        async () => v.recebimentos.refund(intruso.userId, intruso.sessionId, vizinha.tenantId, payment.id, { reason: 'Intruso tentando' }),
        async () => v.vendas.purchases(intruso.userId, vizinha.tenantId, c, {}),
        async () => v.vender(vizinha, intruso, [await v.item(produto, 1_000)]),
        async () => v.vender(vizinha, intruso, [await v.item(await v.produto(vizinha, 'Vizinha própria', 5_000), 1_000)], { consumerId: c }),
      ]) {
        expect(await statusDe(chamada())).toBe(404);
      }
      // Sem vínculo no estabelecimento: 404, nunca 403.
      for (const chamada of [
        async () => v.vendas.list(intruso.userId, est.tenantId, { scope: 'all' }),
        async () => v.vendas.catalog(intruso.userId, est.tenantId, {}),
        async () => v.recebimentos.list(intruso.userId, est.tenantId, { scope: 'all' }),
      ]) {
        expect(await statusDe(chamada())).toBe(404);
      }
      expect((await v.vendas.catalog(intruso.userId, vizinha.tenantId, {})).products.map((p) => p.id)).not.toContain(produto);
      expect((await v.vendas.get(est.dono.userId, est.tenantId, venda.id)).activePaymentId).toBe(payment.id);
    });
  });
});
