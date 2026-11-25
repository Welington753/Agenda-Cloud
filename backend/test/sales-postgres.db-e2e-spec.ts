// API de vendas (PR 3 de docs/plans/vendas-v1.md) contra PostgreSQL
// descartável com dados fictícios: preço sugerido no produto, registro (tudo
// ou nada, preço, unidade, cliente), reenvio pela chave, último saldo com
// conexões simultâneas, cancelamento (senha recente, recebimento ativo,
// produto arquivado, repetição e corrida), recebimento e estorno (reenvio,
// datas, corridas com o cancelamento) e o Início sem vendas.
// Matriz de acesso, catálogo, busca de clientes, VENDAS retirado e
// isolamento: test/sales-access-postgres.db-e2e-spec.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { DashboardService } from '../src/dashboard/dashboard.service.js';
import { abrirBanco, codigoDe, novaChave, statusDe, urlDoBancoDescartavel, type Estabelecimento } from './support/estoque.js';
import { apoioDeVendas } from './support/vendas.js';

const url = urlDoBancoDescartavel();

describe.skipIf(!url)('vendas, PR 3: API contra PostgreSQL descartável', () => {
  let db: DataSource;
  let v: ReturnType<typeof apoioDeVendas>;
  let est: Estabelecimento;

  const dono = () => est.dono;
  const contar = async (sql: string, params: unknown[]) => Number((await v.q<{ n: string }>(sql, params))[0].n);
  const vendasDoEstabelecimento = () => contar(`SELECT count(*)::text AS n FROM sales WHERE tenant_id = $1`, [est.tenantId]);
  const auditoria = (acao: string) => contar(`SELECT count(*)::text AS n FROM audit_logs WHERE tenant_id = $1 AND action = $2`, [est.tenantId, acao]);

  beforeAll(async () => {
    db = await abrirBanco(url!);
    v = apoioDeVendas(db, `vendas-api-${Date.now()}`);
    est = await v.loja('loja');
  }, 120_000);

  afterAll(async () => {
    await v?.dados.limparGerentes();
    await db?.destroy();
  });

  describe('preço sugerido no produto', () => {
    it('criação com preço; edição sem o campo mantém; null tira; zero nunca é aceito pelo corpo', async () => {
      const id = await v.produto(est, 'Pomada com preço', 5_000, { preco: 2_490 });
      let p = await v.produtos.get(dono().userId, est.tenantId, id);
      expect(p.salePriceCents).toBe(2_490);
      const base = {
        name: p.name,
        description: null,
        internalCode: null,
        categoryId: p.categoryId,
        subcategoryId: null,
        purpose: p.purpose,
        unit: p.unit,
        minQuantityMilli: 0,
      };
      // Tela anterior ao campo: não manda `salePriceCents` e não apaga o preço.
      p = await v.produtos.update(dono().userId, est.tenantId, id, { ...base, name: 'Pomada renomeada', expectedUpdatedAt: p.updatedAt } as never);
      expect(p).toMatchObject({ name: 'Pomada renomeada', salePriceCents: 2_490 });
      p = await v.produtos.update(dono().userId, est.tenantId, id, { ...base, salePriceCents: null, expectedUpdatedAt: p.updatedAt } as never);
      expect(p.salePriceCents).toBeNull();
      const [auditado] = await v.q<{ prev: { salePriceCents: number | null }; novo: { salePriceCents: number | null } }>(
        `SELECT previous_data AS prev, new_data AS novo FROM audit_logs
          WHERE tenant_id = $1 AND action = 'STOCK_PRODUCT_CHANGED' AND new_data->>'productId' = $2 ORDER BY occurred_at DESC LIMIT 1`,
        [est.tenantId, id],
      );
      expect(auditado).toMatchObject({ prev: { salePriceCents: 2_490 }, novo: { salePriceCents: null } });
    });
  });

  describe('registro', () => {
    it('valores calculados no servidor, itens congelados, baixas ligadas e auditoria na mesma transação', async () => {
      const a = await v.produto(est, 'Shampoo', 10_000, { preco: 1_999 });
      const b = await v.produto(est, 'Cera a granel', 5_000, { preco: 4_590, unit: 'KG' });
      const consumerId = await v.cliente(est, 'Carla Compradora');
      const antes = await auditoria('SALE_RECORDED');
      const r = await v.vender(est, dono(), [await v.item(a, 3_000), await v.item(b, 1_250)], { consumerId });
      expect(r.created).toBe(true);
      expect(r.sale).toMatchObject({
        status: 'ATIVA',
        totalCents: 5_997 + 5_738,
        consumer: { id: consumerId, name: 'Carla Compradora' },
        recordedBy: { id: dono().userId },
        activePaymentId: null,
        payments: [],
      });
      expect(r.sale.items).toEqual([
        expect.objectContaining({ position: 1, productId: a, productName: 'Shampoo', unit: 'UN', quantityMilli: 3_000, unitPriceCents: 1_999, suggestedPriceCents: 1_999, lineTotalCents: 5_997 }),
        expect.objectContaining({ position: 2, productId: b, productName: 'Cera a granel', unit: 'KG', quantityMilli: 1_250, unitPriceCents: 4_590, lineTotalCents: 5_738 }),
      ]);
      expect(await v.saldo(a)).toBe(7_000);
      expect(await v.saldo(b)).toBe(3_750);
      const baixas = await v.q<{ kind: string; sale_id: string }>(`SELECT kind, sale_id FROM stock_movements WHERE sale_id = $1`, [r.sale.id]);
      expect(baixas).toHaveLength(2);
      expect(baixas.every((m) => m.kind === 'SAIDA_VENDA')).toBe(true);
      expect(await auditoria('SALE_RECORDED')).toBe(antes + 1);

      // Mudar o cadastro depois não muda a venda.
      const p = await v.produtos.get(dono().userId, est.tenantId, a);
      await v.produtos.update(
        dono().userId,
        est.tenantId,
        a,
        { name: 'Shampoo novo', description: null, internalCode: null, categoryId: p.categoryId, subcategoryId: null, purpose: 'VENDA', unit: 'UN', minQuantityMilli: 0, salePriceCents: 2_500, expectedUpdatedAt: p.updatedAt } as never,
      );
      const detalhe = await v.vendas.get(dono().userId, est.tenantId, r.sale.id);
      expect(detalhe.items[0]).toMatchObject({ productName: 'Shampoo', unitPriceCents: 1_999, suggestedPriceCents: 1_999 });
    });

    it('tudo ou nada: um item sem saldo recusa a venda inteira, cita o produto e nada é gravado', async () => {
      const a = await v.produto(est, 'Gel', 5_000);
      const b = await v.produto(est, 'Óleo', 1_000);
      const [vendasAntes, auditAntes] = [await vendasDoEstabelecimento(), await auditoria('SALE_RECORDED')];
      const erro = v.vender(est, dono(), [await v.item(a, 2_000), await v.item(b, 2_000)]);
      await expect(erro).rejects.toMatchObject({
        response: { code: 'SALDO_INSUFICIENTE', products: [{ productId: b, name: 'Óleo', balanceMilli: 1_000 }] },
      });
      expect([await v.saldo(a), await v.saldo(b)]).toEqual([5_000, 1_000]);
      expect(await vendasDoEstabelecimento()).toBe(vendasAntes);
      expect(await auditoria('SALE_RECORDED')).toBe(auditAntes);
    });

    it('preço sugerido mudou depois da tela: 409 PRECO_ALTERADO com o preço atual, nada gravado', async () => {
      const a = await v.produto(est, 'Escova', 5_000, { preco: 1_500 });
      const visto = await v.item(a, 1_000);
      await v.q(`UPDATE stock_products SET sale_price_cents = 1700 WHERE id = $1`, [a]);
      await expect(v.vender(est, dono(), [visto])).rejects.toMatchObject({
        response: { code: 'PRECO_ALTERADO', products: [{ productId: a, salePriceCents: 1_700 }] },
      });
      expect(await v.saldo(a)).toBe(5_000);
    });

    it('unidade, finalidade, arquivamento, produto e cliente de fora, cliente unificado', async () => {
      const a = await v.produto(est, 'Pente', 5_000);
      const visto = await v.item(a, 1_000);
      await expect(v.vender(est, dono(), [{ ...visto, expectedUnit: 'CX' }])).rejects.toMatchObject({ response: { code: 'UNIDADE_ALTERADA', products: [{ productId: a, unit: 'UN' }] } });
      const consumo = await v.produto(est, 'Álcool da bancada', 5_000, { purpose: 'CONSUMO_INTERNO' });
      expect(await codigoDe(v.vender(est, dono(), [await v.item(consumo, 1_000)]))).toBe('FINALIDADE_INCOMPATIVEL');
      const arquivado = await v.produto(est, 'Toalha antiga', 5_000);
      const itemArquivado = await v.item(arquivado, 1_000);
      await v.produtos.archive(dono().userId, est.tenantId, arquivado);
      expect(await codigoDe(v.vender(est, dono(), [itemArquivado]))).toBe('PRODUTO_ARQUIVADO');

      const vizinha = await v.loja('vizinha-registro');
      const deFora = await v.produto(vizinha, 'Produto da vizinha', 5_000);
      expect(await statusDe(v.vender(est, dono(), [await v.item(deFora, 1_000)]))).toBe(404);
      const clienteDeFora = await v.cliente(vizinha, 'Cliente Vizinha');
      expect(await statusDe(v.vender(est, dono(), [visto], { consumerId: clienteDeFora }))).toBe(404);
      expect(await v.saldo(deFora)).toBe(5_000);

      const principal = await v.cliente(est, 'Duda Dupla');
      const secundario = await v.cliente(est, 'Duda Dupla');
      const previa = await v.unificacao.preview(dono().userId, est.tenantId, secundario, principal);
      await v.unificacao.merge(dono().userId, est.tenantId, secundario, { principalId: principal, versaoDaPrevia: previa.versaoDaPrevia });
      await expect(v.vender(est, dono(), [visto], { consumerId: secundario })).rejects.toMatchObject({
        response: { code: 'CLIENTE_UNIFICADO', principalId: principal },
      });
      expect(await v.saldo(a)).toBe(5_000);
    });

    it('preço diferente do sugerido ou produto sem sugerido: só com VENDAS_ALTERAR_PRECO; a venda guarda os dois preços', async () => {
      const comPreco = await v.produto(est, 'Máscara', 10_000, { preco: 3_000 });
      const semPreco = await v.produto(est, 'Brinde avulso', 10_000, { preco: null });
      const so = await v.dados.vinculo(est, 'gerente-vende', 'GERENTE', ['VENDAS_REGISTRAR']);
      const comPrecoLivre = await v.dados.vinculo(est, 'gerente-preco', 'GERENTE', ['VENDAS_REGISTRAR', 'VENDAS_ALTERAR_PRECO']);
      await expect(v.vender(est, so, [await v.item(comPreco, 1_000, 2_500)])).rejects.toMatchObject({
        response: { code: 'PRECO_NAO_AUTORIZADO', products: [{ productId: comPreco }] },
      });
      expect(await codigoDe(v.vender(est, so, [await v.item(semPreco, 1_000, 500)]))).toBe('PRECO_NAO_AUTORIZADO');
      expect((await v.vender(est, so, [await v.item(comPreco, 1_000)])).created).toBe(true);
      const livre = await v.vender(est, comPrecoLivre, [await v.item(comPreco, 1_000, 2_500), await v.item(semPreco, 2_000, 500)]);
      expect(livre.sale.items.map((i) => [i.unitPriceCents, i.suggestedPriceCents])).toEqual([
        [2_500, 3_000],
        [500, null],
      ]);
      expect(livre.sale.recordedBy.id).toBe(comPrecoLivre.userId);
      expect(livre.sale.totalCents).toBe(2_500 + 1_000);
    });
  });

  describe('reenvio pela chave', () => {
    it('mesma chave e mesma venda devolvem a original (sem baixar de novo); itens em outra ordem são a mesma venda', async () => {
      const a = await v.produto(est, 'Reenvio A', 10_000);
      const b = await v.produto(est, 'Reenvio B', 10_000);
      const corpo = { requestKey: novaChave(), consumerId: null, items: [await v.item(a, 1_000), await v.item(b, 2_000)] };
      const primeira = await v.vendas.create(dono().userId, est.tenantId, corpo);
      const repetida = await v.vendas.create(dono().userId, est.tenantId, { ...corpo, items: [...corpo.items].reverse() });
      expect(repetida).toMatchObject({ created: false, sale: { id: primeira.sale.id } });
      expect([await v.saldo(a), await v.saldo(b)]).toEqual([9_000, 8_000]);
    });

    it('mesma chave com outra venda: 409 CHAVE_REUTILIZADA, nada gravado', async () => {
      const a = await v.produto(est, 'Reenvio C', 10_000);
      const corpo = { requestKey: novaChave(), consumerId: null, items: [await v.item(a, 1_000)] };
      await v.vendas.create(dono().userId, est.tenantId, corpo);
      const antes = await vendasDoEstabelecimento();
      expect(await codigoDe(v.vendas.create(dono().userId, est.tenantId, { ...corpo, items: [{ ...corpo.items[0], quantityMilli: 2_000 }] }))).toBe(
        'CHAVE_REUTILIZADA',
      );
      expect(await vendasDoEstabelecimento()).toBe(antes);
      expect(await v.saldo(a)).toBe(9_000);
    });

    it('mesma chave enviada duas vezes ao mesmo tempo: uma venda só, as duas respostas com o mesmo id', async () => {
      const a = await v.produto(est, 'Reenvio simultâneo', 10_000);
      const corpo = { requestKey: novaChave(), consumerId: null, items: [await v.item(a, 1_000)] };
      const [r1, r2] = await Promise.all([v.vendas.create(dono().userId, est.tenantId, corpo), v.vendas.create(dono().userId, est.tenantId, corpo)]);
      expect(r1.sale.id).toBe(r2.sale.id);
      expect([r1.created, r2.created].sort()).toEqual([false, true]);
      expect(await v.saldo(a)).toBe(9_000);
    });
  });

  describe('concorrência pelo saldo', () => {
    it('duas vendas do último item ao mesmo tempo: uma passa, a outra recebe 409 e o saldo nunca fica negativo', async () => {
      const a = await v.produto(est, 'Última unidade', 1_000);
      const outro = await v.produto(est, 'Companheiro', 10_000);
      const [ia, io] = [await v.item(a, 1_000), await v.item(outro, 1_000)];
      // Ordens opostas no corpo: a trava por ordem de id evita impasse.
      const resultados = await Promise.allSettled([v.vender(est, dono(), [ia, io]), v.vender(est, dono(), [io, ia])]);
      const ok = resultados.filter((r) => r.status === 'fulfilled');
      const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      expect(ok).toHaveLength(1);
      expect((recusa!.reason as { response?: { code?: string } }).response?.code).toBe('SALDO_INSUFICIENTE');
      expect([await v.saldo(a), await v.saldo(outro)]).toEqual([0, 9_000]);
    });
  });

  describe('cancelamento', () => {
    const cancelar = (saleId: string, reason = 'Cliente desistiu da compra', quem = est.dono) =>
      v.vendas.cancel(quem.userId, quem.sessionId, est.tenantId, saleId, { reason });

    it('exige senha confirmada há pouco', async () => {
      const a = await v.produto(est, 'Cancelar sem senha', 5_000);
      const { sale } = await v.vender(est, dono(), [await v.item(a, 1_000)]);
      await v.reconfirmarSenha(dono(), new Date(Date.now() - 60 * 60 * 1000));
      try {
        expect(await codigoDe(cancelar(sale.id))).toBe('REAUTENTICACAO_NECESSARIA');
      } finally {
        await v.reconfirmarSenha(dono());
      }
      expect(await v.saldo(a)).toBe(4_000);
    });

    it('integral: um estorno por item com o sale_id, saldo devolvido, motivo e auditoria; produto arquivado volta e continua arquivado', async () => {
      const a = await v.produto(est, 'Cancelar A', 5_000);
      const b = await v.produto(est, 'Cancelar arquivado', 5_000);
      const { sale } = await v.vender(est, dono(), [await v.item(a, 2_000), await v.item(b, 1_000)]);
      await v.produtos.archive(dono().userId, est.tenantId, b);
      const antes = await auditoria('SALE_CANCELLED');
      const r = await cancelar(sale.id);
      expect(r.created).toBe(true);
      expect(r.sale).toMatchObject({ status: 'CANCELADA', cancellation: { reason: 'Cliente desistiu da compra', cancelledBy: { id: dono().userId } } });
      expect([await v.saldo(a), await v.saldo(b)]).toEqual([5_000, 5_000]);
      const estornos = await v.q<{ reason: string }>(`SELECT reason FROM stock_movements WHERE sale_id = $1 AND kind = 'ESTORNO'`, [sale.id]);
      expect(estornos.map((e) => e.reason)).toEqual(['Cliente desistiu da compra', 'Cliente desistiu da compra']);
      expect((await v.produtos.get(dono().userId, est.tenantId, b)).archived).toBe(true);
      expect(await auditoria('SALE_CANCELLED')).toBe(antes + 1);
    });

    it('repetir com o mesmo motivo devolve a venda cancelada sem novo lançamento; outro motivo, 409 JA_CANCELADA', async () => {
      const a = await v.produto(est, 'Cancelar duas vezes', 5_000);
      const { sale } = await v.vender(est, dono(), [await v.item(a, 1_000)]);
      await cancelar(sale.id);
      const repetido = await cancelar(sale.id, '  Cliente desistiu  da compra ');
      expect(repetido).toMatchObject({ created: false, sale: { status: 'CANCELADA' } });
      expect(await codigoDe(cancelar(sale.id, 'Produto com defeito'))).toBe('JA_CANCELADA');
      expect(await contar(`SELECT count(*)::text AS n FROM stock_movements WHERE sale_id = $1 AND kind = 'ESTORNO'`, [sale.id])).toBe(1);
      expect(await v.saldo(a)).toBe(5_000);
    });

    it('dois cancelamentos ao mesmo tempo: um lança os estornos, o outro devolve o estado', async () => {
      const a = await v.produto(est, 'Cancelar em paralelo', 5_000);
      const { sale } = await v.vender(est, dono(), [await v.item(a, 1_000)]);
      const [r1, r2] = await Promise.all([cancelar(sale.id), cancelar(sale.id)]);
      expect([r1.created, r2.created].sort()).toEqual([false, true]);
      expect(await contar(`SELECT count(*)::text AS n FROM stock_movements WHERE sale_id = $1 AND kind = 'ESTORNO'`, [sale.id])).toBe(1);
      expect(await v.saldo(a)).toBe(5_000);
    });

    it('com recebimento ativo: 409 RECEBIMENTO_ATIVO; depois do estorno do recebimento, cancela', async () => {
      const a = await v.produto(est, 'Cancelar recebida', 5_000);
      const { sale } = await v.vender(est, dono(), [await v.item(a, 1_000)]);
      const { payment } = await v.recebimentos.record(dono().userId, est.tenantId, sale.id, { requestKey: novaChave(), method: 'PIX', receivedOn: v.hoje(), notes: null });
      expect(await codigoDe(cancelar(sale.id))).toBe('RECEBIMENTO_ATIVO');
      await v.recebimentos.refund(dono().userId, dono().sessionId, est.tenantId, payment.id, { reason: 'Cliente desistiu' });
      expect((await cancelar(sale.id)).sale.status).toBe('CANCELADA');
    });
  });

  describe('recebimento e estorno', () => {
    const receber = (saleId: string, extra: Record<string, unknown> = {}, quem = est.dono) =>
      v.recebimentos.record(quem.userId, est.tenantId, saleId, { requestKey: novaChave(), method: 'DINHEIRO', receivedOn: v.hoje(), notes: null, ...extra } as never);
    const estornar = (paymentId: string, reason = 'Pagamento lançado errado') =>
      v.recebimentos.refund(dono().userId, dono().sessionId, est.tenantId, paymentId, { reason });

    it('no total da venda, sem PAGAMENTOS e fora do Início', async () => {
      await v.recurso(est.tenantId, 'feat_pagamentos', false);
      try {
        const a = await v.produto(est, 'Recebimento sem PAGAMENTOS', 5_000, { preco: 2_345 });
        const { sale } = await v.vender(est, dono(), [await v.item(a, 2_000)]);
        const antes = await auditoria('SALE_PAYMENT_RECORDED');
        const r = await receber(sale.id, { method: 'PIX', notes: 'Pago no balcão' });
        expect(r.payment).toMatchObject({ saleId: sale.id, amountCents: 4_690, method: 'PIX', notes: 'Pago no balcão', refund: null });
        expect(await auditoria('SALE_PAYMENT_RECORDED')).toBe(antes + 1);
        expect((await v.vendas.get(dono().userId, est.tenantId, sale.id)).activePaymentId).toBe(r.payment.id);
      } finally {
        await v.q(`DELETE FROM tenant_feature_overrides WHERE tenant_id = $1 AND feature_id = 'feat_pagamentos'`, [est.tenantId]);
      }
      // O Início (com PAGAMENTOS) lê só os recebimentos de atendimentos.
      const inicio = await new DashboardService(db).summary(dono().userId, est.tenantId, {});
      expect(inicio.finance).toMatchObject({ receivedCents: 0, refundedCents: 0, netCents: 0 });
    });

    it('reenvio: mesma chave e mesmos dados devolvem o original; outros dados, 409 CHAVE_REUTILIZADA', async () => {
      const a = await v.produto(est, 'Reenvio do recebimento', 5_000);
      const { sale } = await v.vender(est, dono(), [await v.item(a, 1_000)]);
      const corpo = { requestKey: novaChave(), method: 'CARTAO_CREDITO', receivedOn: v.hoje(), notes: null };
      const primeiro = await receber(sale.id, corpo);
      expect(await receber(sale.id, corpo)).toMatchObject({ created: false, payment: { id: primeiro.payment.id } });
      expect(await codigoDe(receber(sale.id, { ...corpo, method: 'PIX' }))).toBe('CHAVE_REUTILIZADA');
      expect(await contar(`SELECT count(*)::text AS n FROM sale_payments WHERE sale_id = $1`, [sale.id])).toBe(1);
    });

    it('um ativo por venda; datas; venda cancelada não recebe', async () => {
      const a = await v.produto(est, 'Regras do recebimento', 5_000);
      const { sale } = await v.vender(est, dono(), [await v.item(a, 1_000)]);
      expect(await codigoDe(receber(sale.id, { receivedOn: '2999-01-01' }))).toBe('DATA_NO_FUTURO');
      expect(await codigoDe(receber(sale.id, { receivedOn: '2020-01-01' }))).toBe('DATA_ANTES_DA_VENDA');
      await receber(sale.id);
      expect(await codigoDe(receber(sale.id))).toBe('JA_RECEBIDA');
      const outra = await v.vender(est, dono(), [await v.item(a, 1_000)]);
      await v.vendas.cancel(dono().userId, dono().sessionId, est.tenantId, outra.sale.id, { reason: 'Cliente desistiu' });
      expect(await codigoDe(receber(outra.sale.id))).toBe('VENDA_CANCELADA');
    });

    it('estorno: senha recente; repetir com o mesmo motivo não lança de novo; outro motivo, 409; depois, novo recebimento', async () => {
      const a = await v.produto(est, 'Estorno do recebimento', 5_000);
      const { sale } = await v.vender(est, dono(), [await v.item(a, 1_000)]);
      const { payment } = await receber(sale.id);
      await v.reconfirmarSenha(dono(), new Date(Date.now() - 60 * 60 * 1000));
      try {
        expect(await codigoDe(estornar(payment.id))).toBe('REAUTENTICACAO_NECESSARIA');
      } finally {
        await v.reconfirmarSenha(dono());
      }
      const antes = await auditoria('SALE_PAYMENT_REFUNDED');
      const r = await estornar(payment.id);
      expect(r).toMatchObject({ created: true, payment: { refund: { reason: 'Pagamento lançado errado', refundedOn: v.hoje() } } });
      expect(await estornar(payment.id)).toMatchObject({ created: false });
      expect(await codigoDe(estornar(payment.id, 'Outro motivo qualquer'))).toBe('JA_ESTORNADO');
      expect(await auditoria('SALE_PAYMENT_REFUNDED')).toBe(antes + 1);
      expect((await receber(sale.id)).created).toBe(true);
    });

    it('receber e cancelar ao mesmo tempo: só um vence, nunca venda cancelada com recebimento ativo', async () => {
      for (let rodada = 0; rodada < 3; rodada += 1) {
        const a = await v.produto(est, `Corrida receber cancelar ${rodada}`, 5_000);
        const { sale } = await v.vender(est, dono(), [await v.item(a, 1_000)]);
        const [rec, can] = await Promise.allSettled([
          receber(sale.id),
          v.vendas.cancel(dono().userId, dono().sessionId, est.tenantId, sale.id, { reason: 'Cliente desistiu' }),
        ]);
        const codigo = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason as { response?: { code?: string } }).response?.code : 'ok');
        expect([
          ['ok', 'RECEBIMENTO_ATIVO'],
          ['VENDA_CANCELADA', 'ok'],
        ]).toContainEqual([codigo(rec), codigo(can)]);
        const [estado] = await v.q<{ status: string; ativos: number }>(
          `SELECT s.status, (SELECT count(*)::int FROM sale_payments p WHERE p.sale_id = s.id AND p.refunded_at IS NULL) AS ativos
             FROM sales s WHERE s.id = $1`,
          [sale.id],
        );
        expect(estado.status === 'CANCELADA' ? estado.ativos : 0).toBe(0);
      }
    });

    it('dois recebimentos com chaves diferentes ao mesmo tempo: um só; dois estornos iguais ao mesmo tempo: um lançamento', async () => {
      const a = await v.produto(est, 'Corrida de recebimentos', 5_000);
      const { sale } = await v.vender(est, dono(), [await v.item(a, 1_000)]);
      const r = await Promise.allSettled([receber(sale.id), receber(sale.id)]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason as { response: { code: string } }).response.code).toBe('JA_RECEBIDA');
      const [ativo] = await v.q<{ id: string }>(`SELECT id FROM sale_payments WHERE sale_id = $1 AND refunded_at IS NULL`, [sale.id]);
      const [e1, e2] = await Promise.all([estornar(ativo.id), estornar(ativo.id)]);
      expect([e1.created, e2.created].sort()).toEqual([false, true]);
    });

    it('estornar e cancelar ao mesmo tempo: o cancelamento vence só depois do estorno; nunca cancelada com recebimento ativo', async () => {
      const a = await v.produto(est, 'Corrida estorno cancelamento', 5_000);
      const { sale } = await v.vender(est, dono(), [await v.item(a, 1_000)]);
      const { payment } = await receber(sale.id);
      const [est1, can] = await Promise.allSettled([
        estornar(payment.id),
        v.vendas.cancel(dono().userId, dono().sessionId, est.tenantId, sale.id, { reason: 'Cliente desistiu' }),
      ]);
      expect(est1.status).toBe('fulfilled');
      if (can.status === 'rejected') expect((can.reason as { response: { code: string } }).response.code).toBe('RECEBIMENTO_ATIVO');
      const [estado] = await v.q<{ status: string; ativos: number }>(
        `SELECT s.status, (SELECT count(*)::int FROM sale_payments p WHERE p.sale_id = s.id AND p.refunded_at IS NULL) AS ativos FROM sales s WHERE s.id = $1`,
        [sale.id],
      );
      expect(estado.ativos).toBe(0);
      expect(await v.saldo(a)).toBe(estado.status === 'CANCELADA' ? 5_000 : 4_000);
    });
  });
});
