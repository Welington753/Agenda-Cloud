// Conferência de estoque: a pessoa informa a quantidade encontrada de cada
// produto, revisa a diferença e confirma. Na confirmação, tudo ou nada:
//
// - os produtos são travados em ordem de id (`FOR UPDATE`, sem deadlock
//   entre duas conferências);
// - cada item traz a versão do saldo E a unidade que a tela mostrou; se
//   alguma mudou (movimentação concorrente, edição de UN para CX antes da
//   primeira movimentação) ou o produto foi arquivado, 409
//   `CONFERENCIA_DESATUALIZADA` com o estado atual dos itens afetados, e
//   nada é gravado: uma contagem velha nunca sobrescreve um lançamento novo;
// - diferença diferente de zero vira `AJUSTE_CONFERENCIA` (contado − saldo);
//   diferença zero fica registrada só na conferência;
// - motivo (`note`) obrigatório quando a confirmação registra ajuste, e com
//   pelo menos 3 letras sempre que vier: senão 400 `MOTIVO_OBRIGATORIO` e
//   nada é gravado. É o mesmo motivo de cada ajuste no histórico.
//
// Reenvio igual ao das movimentações: mesma chave e mesmos itens devolvem a
// conferência original; itens diferentes, 409 `CHAVE_REUTILIZADA`.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { linhasDe } from '../common/linhas-de.js';
import { generateId } from '../entities/common/generate-id.js';
import {
  CHAVE_EM_USO,
  LIMITE_DA_PAGINA,
  autorizarConsulta,
  autorizarOperacao,
  codificarCursor,
  conferirRepeticao,
  conflito,
  decodificarCursor,
  iso,
  numero,
} from './stock-common.js';
import { registrarMovimentacao, travarProduto, type ProdutoTravado } from './stock-ledger.js';
import type { StockUnit } from './stock-quantity.js';
import { impressaoDaConferencia, textoNormalizado } from './stock-request-fingerprint.js';
import type { CountListQueryDto, CreateCountDto } from './stock.dto.js';

export interface CountItemView {
  productId: string;
  productName: string;
  expectedUnit: StockUnit;
  expectedMilli: number;
  countedMilli: number;
  differenceMilli: number;
  movementId: string | null;
}

export interface CountView {
  id: string;
  note: string | null;
  recordedBy: { id: string; name: string };
  recordedAt: string;
  itemCount: number;
  adjustedCount: number;
  items?: CountItemView[];
}

interface ConferenciaRow {
  id: string;
  note: string | null;
  recorded_by_user_id: string;
  recorded_by_name: string;
  recorded_at: Date;
  request_fingerprint: string;
  item_count: number;
  adjusted_count: number;
}

const SELECT_CONFERENCIA = `SELECT c.id, c.note, c.recorded_by_user_id, u.name AS recorded_by_name, c.recorded_at, c.request_fingerprint,
    (SELECT count(*)::int FROM stock_count_items i WHERE i.tenant_id = c.tenant_id AND i.count_id = c.id) AS item_count,
    (SELECT count(*)::int FROM stock_count_items i WHERE i.tenant_id = c.tenant_id AND i.count_id = c.id AND i.difference_milli <> 0) AS adjusted_count
  FROM stock_counts c JOIN users u ON u.id = c.recorded_by_user_id`;

const MOTIVO_MINIMO = 3;
const MOTIVO_OBRIGATORIO = () =>
  new BadRequestException({ code: 'MOTIVO_OBRIGATORIO', message: 'Informe o motivo dos ajustes, com pelo menos 3 letras.' });

function toCountView(l: ConferenciaRow): CountView {
  return {
    id: l.id,
    note: l.note,
    recordedBy: { id: l.recorded_by_user_id, name: l.recorded_by_name },
    recordedAt: iso(l.recorded_at)!,
    itemCount: Number(l.item_count),
    adjustedCount: Number(l.adjusted_count),
  };
}

@Injectable()
export class StockCountsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(userId: string, tenantId: string, query: CountListQueryDto): Promise<{ counts: CountView[]; nextCursor: string | null }> {
    const autorizado = await autorizarConsulta(this.dataSource.manager, userId, tenantId);
    const params: unknown[] = [autorizado.tenantId];
    let filtroCursor = '';
    const cursor = decodificarCursor(query.cursor, 2);
    if (cursor) {
      params.push(cursor[0], cursor[1]);
      filtroCursor = ' AND (c.recorded_at, c.id) < ($2::timestamptz, $3)';
    }
    const linhas = linhasDe<ConferenciaRow>(
      await this.dataSource.manager.query(
        `${SELECT_CONFERENCIA} WHERE c.tenant_id = $1${filtroCursor} ORDER BY c.recorded_at DESC, c.id DESC LIMIT ${LIMITE_DA_PAGINA + 1}`,
        params,
      ),
    );
    const pagina = linhas.slice(0, LIMITE_DA_PAGINA);
    const ultimo = pagina.at(-1);
    return {
      counts: pagina.map(toCountView),
      nextCursor: linhas.length > LIMITE_DA_PAGINA && ultimo ? codificarCursor([iso(ultimo.recorded_at)!, ultimo.id]) : null,
    };
  }

  async get(userId: string, tenantId: string, countId: string): Promise<CountView> {
    const autorizado = await autorizarConsulta(this.dataSource.manager, userId, tenantId);
    return this.porId(this.dataSource.manager, autorizado.tenantId, countId);
  }

  async create(userId: string, tenantId: string, dto: CreateCountDto, now = new Date()): Promise<{ created: boolean; count: CountView }> {
    const autorizado = await autorizarOperacao(this.dataSource.manager, userId, tenantId);
    const impressao = impressaoDaConferencia(dto);
    const repetido = await this.porChave(this.dataSource.manager, autorizado.tenantId, userId, dto.requestKey);
    if (repetido) return { created: false, count: conferirRepeticao(repetido, impressao) };
    const nota = textoNormalizado(dto.note);
    if (nota !== null && nota.length < MOTIVO_MINIMO) throw MOTIVO_OBRIGATORIO();
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const t = (await autorizarOperacao(manager, userId, tenantId)).tenantId;
        const itens = [...dto.items].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
        const produtos = new Map<string, ProdutoTravado>();
        for (const item of itens) produtos.set(item.productId, await travarProduto(manager, t, item.productId));

        const desatualizados = itens
          .map((item) => ({ item, produto: produtos.get(item.productId)! }))
          .filter(({ item, produto }) => produto.archived || produto.unit !== item.expectedUnit || produto.balanceVersion !== item.expectedBalanceVersion);
        if (desatualizados.length) {
          throw conflito(
            'CONFERENCIA_DESATUALIZADA',
            'O estoque mudou desde que a contagem começou. Revise os itens destacados antes de confirmar.',
            {
              items: desatualizados.map(({ produto }) => ({
                productId: produto.id,
                balanceMilli: produto.balanceMilli,
                balanceVersion: produto.balanceVersion,
                unit: produto.unit,
                archived: produto.archived,
              })),
            },
          );
        }

        // A diferença só é conhecida com o saldo travado: sem motivo, nada
        // foi gravado ainda e a transação inteira volta.
        const temAjuste = itens.some((item) => item.countedMilli !== produtos.get(item.productId)!.balanceMilli);
        if (temAjuste && nota === null) throw MOTIVO_OBRIGATORIO();

        const conferencia = generateId();
        await manager.query(
          `INSERT INTO stock_counts (id, tenant_id, note, recorded_by_user_id, recorded_at, request_key, request_fingerprint)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [conferencia, t, nota, userId, now, dto.requestKey, impressao],
        );
        for (const item of itens) {
          const produto = produtos.get(item.productId)!;
          const esperado = produto.balanceMilli;
          const diferenca = item.countedMilli - esperado;
          const movimento =
            diferenca === 0
              ? null
              : await registrarMovimentacao(manager, {
                  tenantId: t,
                  produto,
                  kind: 'AJUSTE_CONFERENCIA',
                  deltaMilli: diferenca,
                  reason: nota,
                  userId,
                  now,
                  countId: conferencia,
                });
          await manager.query(
            `INSERT INTO stock_count_items (id, tenant_id, count_id, product_id, expected_unit, expected_balance_version,
                expected_milli, counted_milli, difference_milli, movement_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [generateId(), t, conferencia, produto.id, item.expectedUnit, item.expectedBalanceVersion, esperado, item.countedMilli, diferenca, movimento],
          );
        }
        return conferencia;
      });
      return { created: true, count: await this.porId(this.dataSource.manager, autorizado.tenantId, id) };
    } catch (error) {
      if (isUniqueViolation(error, 'uq_stock_counts_request_key')) {
        const outro = await this.porChave(this.dataSource.manager, autorizado.tenantId, userId, dto.requestKey);
        if (outro) return { created: false, count: conferirRepeticao(outro, impressao) };
        throw CHAVE_EM_USO();
      }
      throw error;
    }
  }

  private async porId(manager: EntityManager, tenantId: string, id: string): Promise<CountView> {
    const [linha] = linhasDe<ConferenciaRow>(await manager.query(`${SELECT_CONFERENCIA} WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, id]));
    if (!linha) throw new NotFoundException('Conferência não encontrada.');
    return { ...toCountView(linha), items: await this.itens(manager, tenantId, id) };
  }

  private async porChave(manager: EntityManager, tenantId: string, userId: string, chave: string) {
    const [linha] = linhasDe<ConferenciaRow>(
      await manager.query(`${SELECT_CONFERENCIA} WHERE c.tenant_id = $1 AND c.recorded_by_user_id = $2 AND c.request_key = $3`, [
        tenantId,
        userId,
        chave,
      ]),
    );
    if (!linha) return null;
    return { fingerprint: linha.request_fingerprint, value: { ...toCountView(linha), items: await this.itens(manager, tenantId, linha.id) } };
  }

  private async itens(manager: EntityManager, tenantId: string, countId: string): Promise<CountItemView[]> {
    const linhas = linhasDe<{
      product_id: string;
      product_name: string;
      expected_unit: StockUnit;
      expected_milli: string;
      counted_milli: string;
      difference_milli: string;
      movement_id: string | null;
    }>(
      await manager.query(
        `SELECT i.product_id, p.name AS product_name, i.expected_unit, i.expected_milli::text AS expected_milli,
                i.counted_milli::text AS counted_milli, i.difference_milli::text AS difference_milli, i.movement_id
           FROM stock_count_items i JOIN stock_products p ON p.tenant_id = i.tenant_id AND p.id = i.product_id
          WHERE i.tenant_id = $1 AND i.count_id = $2 ORDER BY lower(p.name), p.id`,
        [tenantId, countId],
      ),
    );
    return linhas.map((l) => ({
      productId: l.product_id,
      productName: l.product_name,
      expectedUnit: l.expected_unit,
      expectedMilli: numero(l.expected_milli),
      countedMilli: numero(l.counted_milli),
      differenceMilli: numero(l.difference_milli),
      movementId: l.movement_id,
    }));
  }
}
