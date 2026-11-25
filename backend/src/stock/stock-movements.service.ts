// Movimentações manuais do estoque: entrada por compra ou reposição e saída
// por venda, consumo interno ou perda; estorno de um lançamento. Nada é
// editado nem apagado (gatilho no banco): corrigir é lançar de novo.
//
// - a tela manda a unidade que mostrou (`expectedUnit`): se o cadastro mudou
//   a unidade antes da primeira movimentação, 409 `UNIDADE_ALTERADA`;
// - saldo negativo bloqueado (409 `SALDO_INSUFICIENTE`), com o produto
//   travado na transação (saídas simultâneas ficam em fila);
// - reenvio: a mesma `requestKey` com os mesmos dados devolve o lançamento
//   original; com dados diferentes, 409 `CHAVE_REUTILIZADA` sem gravar
//   (stock-request-fingerprint.ts). Acesso e estabelecimento são conferidos
//   ANTES, inclusive no reenvio;
// - estorno: uma vez por lançamento, com motivo; ajuste e estorno não se
//   estornam (a correção é nova conferência). "Saída por venda" é só
//   estoque: não gera recebimento, comissão nem nota.
// - com o adicional VENDAS ligado (docs/plans/vendas-v1.md), a saída por
//   venda manual é recusada (409 `USE_VENDAS`): a venda baixa o estoque pelo
//   fluxo de vendas. Sem VENDAS, nada muda; lançamentos antigos continuam
//   legíveis e estornáveis;
// - a baixa ligada a uma venda (`sale_id`) nunca é estornada por aqui (409
//   `BAIXA_DE_VENDA`): só o cancelamento da venda a devolve. O gatilho
//   `stock_movements_sale_link` (migration SalesModule) é a garantia final.
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { featureEnabled } from '../commercial/commercial-gate.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { SALE_REVERSAL_CONSTRAINT } from '../migrations/1794614400000-SalesModule.js';
import { linhasDe } from '../common/linhas-de.js';
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
import { registrarMovimentacao, travarProduto } from './stock-ledger.js';
import {
  REVERSIBLE_KINDS,
  deltaDoTipo,
  tipoCombinaComFinalidade,
  type StockMovementKind,
  type StockUnit,
} from './stock-quantity.js';
import { impressaoDaMovimentacao, impressaoDoEstorno, textoNormalizado } from './stock-request-fingerprint.js';
import type { CreateMovementDto, MovementListQueryDto, ReverseMovementDto } from './stock.dto.js';

export interface MovementView {
  id: string;
  productId: string;
  productName: string;
  kind: StockMovementKind;
  quantityMilli: number;
  deltaMilli: number;
  balanceBeforeMilli: number;
  balanceAfterMilli: number;
  unit: StockUnit;
  reason: string | null;
  reversesMovementId: string | null;
  reversedByMovementId: string | null;
  countId: string | null;
  /** Venda que baixou (ou devolveu) este item; nulo nos lançamentos manuais. */
  saleId: string | null;
  recordedBy: { id: string; name: string };
  recordedAt: string;
}

interface MovimentoRow {
  id: string;
  product_id: string;
  product_name: string;
  kind: StockMovementKind;
  quantity_milli: string;
  delta_milli: string;
  balance_before_milli: string;
  balance_after_milli: string;
  unit: StockUnit;
  reason: string | null;
  reverses_movement_id: string | null;
  reversed_by_movement_id: string | null;
  count_id: string | null;
  sale_id: string | null;
  recorded_by_user_id: string;
  recorded_by_name: string;
  recorded_at: Date;
  request_fingerprint: string | null;
}

export const SELECT_MOVIMENTO = `SELECT m.id, m.product_id, p.name AS product_name, m.kind,
    m.quantity_milli::text AS quantity_milli, m.delta_milli::text AS delta_milli,
    m.balance_before_milli::text AS balance_before_milli, m.balance_after_milli::text AS balance_after_milli,
    m.unit, m.reason, m.reverses_movement_id,
    (SELECT r.id FROM stock_movements r WHERE r.tenant_id = m.tenant_id AND r.reverses_movement_id = m.id) AS reversed_by_movement_id,
    m.count_id, m.sale_id, m.recorded_by_user_id, u.name AS recorded_by_name, m.recorded_at, m.request_fingerprint
  FROM stock_movements m
  JOIN stock_products p ON p.tenant_id = m.tenant_id AND p.id = m.product_id
  JOIN users u ON u.id = m.recorded_by_user_id`;

export function toMovementView(l: MovimentoRow): MovementView {
  return {
    id: l.id,
    productId: l.product_id,
    productName: l.product_name,
    kind: l.kind,
    quantityMilli: numero(l.quantity_milli),
    deltaMilli: numero(l.delta_milli),
    balanceBeforeMilli: numero(l.balance_before_milli),
    balanceAfterMilli: numero(l.balance_after_milli),
    unit: l.unit,
    reason: l.reason,
    reversesMovementId: l.reverses_movement_id,
    reversedByMovementId: l.reversed_by_movement_id,
    countId: l.count_id,
    saleId: l.sale_id ?? null,
    recordedBy: { id: l.recorded_by_user_id, name: l.recorded_by_name },
    recordedAt: iso(l.recorded_at)!,
  };
}

@Injectable()
export class StockMovementsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(userId: string, tenantId: string, query: MovementListQueryDto): Promise<{ movements: MovementView[]; nextCursor: string | null }> {
    const autorizado = await autorizarConsulta(this.dataSource.manager, userId, tenantId);
    const filtros = ['m.tenant_id = $1'];
    const params: unknown[] = [autorizado.tenantId];
    const parametro = (valor: unknown) => {
      params.push(valor);
      return `$${params.length}`;
    };
    if (query.productId) filtros.push(`m.product_id = ${parametro(query.productId)}`);
    if (query.kind) filtros.push(`m.kind = ${parametro(query.kind)}`);
    const fuso = `(SELECT t.timezone FROM tenants t WHERE t.id = m.tenant_id)`;
    if (query.from) filtros.push(`(m.recorded_at AT TIME ZONE ${fuso})::date >= ${parametro(query.from)}::date`);
    if (query.to) filtros.push(`(m.recorded_at AT TIME ZONE ${fuso})::date <= ${parametro(query.to)}::date`);
    const cursor = decodificarCursor(query.cursor, 2);
    if (cursor) filtros.push(`(m.recorded_at, m.id) < (${parametro(cursor[0])}::timestamptz, ${parametro(cursor[1])})`);
    const linhas = linhasDe<MovimentoRow>(
      await this.dataSource.manager.query(
        `${SELECT_MOVIMENTO} WHERE ${filtros.join(' AND ')} ORDER BY m.recorded_at DESC, m.id DESC LIMIT ${LIMITE_DA_PAGINA + 1}`,
        params,
      ),
    );
    const pagina = linhas.slice(0, LIMITE_DA_PAGINA);
    const ultimo = pagina.at(-1);
    return {
      movements: pagina.map(toMovementView),
      nextCursor: linhas.length > LIMITE_DA_PAGINA && ultimo ? codificarCursor([iso(ultimo.recorded_at)!, ultimo.id]) : null,
    };
  }

  async create(userId: string, tenantId: string, dto: CreateMovementDto, now = new Date()): Promise<{ created: boolean; movement: MovementView }> {
    const autorizado = await autorizarOperacao(this.dataSource.manager, userId, tenantId);
    const impressao = impressaoDaMovimentacao(dto);
    return this.comChave(autorizado.tenantId, userId, dto.requestKey, impressao, async (manager, t) => {
      if (dto.kind === 'SAIDA_VENDA' && (await featureEnabled(manager, t, FeatureKey.VENDAS))) {
        throw conflito(
          'USE_VENDAS',
          'Com o adicional Vendas, a saída por venda é registrada em Vendas, que baixa o estoque junto com a venda.',
        );
      }
      const produto = await travarProduto(manager, t, dto.productId);
      if (produto.unit !== dto.expectedUnit) throw unidadeAlterada(produto.unit);
      if (!tipoCombinaComFinalidade(dto.kind, produto.purpose)) {
        throw conflito(
          'FINALIDADE_INCOMPATIVEL',
          dto.kind === 'SAIDA_VENDA'
            ? 'Este produto não é de venda. Use outra saída ou mude a finalidade no cadastro.'
            : 'Este produto não é de consumo interno. Use outra saída ou mude a finalidade no cadastro.',
        );
      }
      return registrarMovimentacao(manager, {
        tenantId: t,
        produto,
        kind: dto.kind,
        deltaMilli: deltaDoTipo(dto.kind, dto.quantityMilli),
        reason: textoNormalizado(dto.reason),
        userId,
        now,
        requestKey: dto.requestKey,
        requestFingerprint: impressao,
      });
    });
  }

  async reverse(
    userId: string,
    tenantId: string,
    movementId: string,
    dto: ReverseMovementDto,
    now = new Date(),
  ): Promise<{ created: boolean; movement: MovementView }> {
    const autorizado = await autorizarOperacao(this.dataSource.manager, userId, tenantId);
    const impressao = impressaoDoEstorno({ movementId, reason: dto.reason });
    return this.comChave(autorizado.tenantId, userId, dto.requestKey, impressao, async (manager, t) => {
      const [original] = linhasDe<{ product_id: string; kind: StockMovementKind; delta_milli: string; sale_id?: string | null }>(
        await manager.query(`SELECT product_id, kind, delta_milli::text AS delta_milli, sale_id FROM stock_movements WHERE tenant_id = $1 AND id = $2`, [
          t,
          movementId,
        ]),
      );
      if (!original) throw new NotFoundException('Movimentação não encontrada.');
      if (original.sale_id) throw baixaDeVendaErro();
      if (!REVERSIBLE_KINDS.includes(original.kind)) {
        throw conflito('NAO_ESTORNAVEL', 'Ajuste de conferência e estorno não podem ser estornados. Faça uma nova conferência.');
      }
      const produto = await travarProduto(manager, t, original.product_id);
      const [jaEstornada] = await manager.query<unknown[]>(
        `SELECT 1 FROM stock_movements WHERE tenant_id = $1 AND reverses_movement_id = $2`,
        [t, movementId],
      );
      if (jaEstornada) throw jaEstornadaErro();
      return registrarMovimentacao(manager, {
        tenantId: t,
        produto,
        kind: 'ESTORNO',
        deltaMilli: -numero(original.delta_milli),
        reason: textoNormalizado(dto.reason),
        userId,
        now,
        reversesMovementId: movementId,
        requestKey: dto.requestKey,
        requestFingerprint: impressao,
      });
    });
  }

  /** Reenvio pela chave (mesma operação devolve o original), gravação numa
   * transação com o acesso conferido de novo, e corrida pela mesma chave. */
  private async comChave(
    tenantId: string,
    userId: string,
    chave: string,
    impressao: string,
    gravar: (manager: EntityManager, tenantId: string) => Promise<string>,
  ): Promise<{ created: boolean; movement: MovementView }> {
    const repetido = await this.porChave(this.dataSource.manager, tenantId, userId, chave);
    if (repetido) return { created: false, movement: conferirRepeticao(repetido, impressao) };
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const t = (await autorizarOperacao(manager, userId, tenantId)).tenantId;
        return gravar(manager, t);
      });
      return { created: true, movement: await this.porId(this.dataSource.manager, tenantId, id) };
    } catch (error) {
      if (isUniqueViolation(error, 'uq_stock_movements_request_key')) {
        const outro = await this.porChave(this.dataSource.manager, tenantId, userId, chave);
        if (outro) return { created: false, movement: conferirRepeticao(outro, impressao) };
        throw CHAVE_EM_USO();
      }
      if (isUniqueViolation(error, 'uq_stock_movements_reverses')) throw jaEstornadaErro();
      if (restricaoDoErro(error) === SALE_REVERSAL_CONSTRAINT) throw baixaDeVendaErro();
      throw error;
    }
  }

  private async porId(manager: EntityManager, tenantId: string, id: string): Promise<MovementView> {
    const [linha] = linhasDe<MovimentoRow>(await manager.query(`${SELECT_MOVIMENTO} WHERE m.tenant_id = $1 AND m.id = $2`, [tenantId, id]));
    if (!linha) throw new NotFoundException('Movimentação não encontrada.');
    return toMovementView(linha);
  }

  private async porChave(manager: EntityManager, tenantId: string, userId: string, chave: string) {
    const [linha] = linhasDe<MovimentoRow>(
      await manager.query(`${SELECT_MOVIMENTO} WHERE m.tenant_id = $1 AND m.recorded_by_user_id = $2 AND m.request_key = $3`, [
        tenantId,
        userId,
        chave,
      ]),
    );
    return linha ? { fingerprint: linha.request_fingerprint ?? '', value: toMovementView(linha) } : null;
  }
}

function unidadeAlterada(atual: StockUnit) {
  return conflito('UNIDADE_ALTERADA', 'A unidade do produto mudou em outra tela. Recarregue antes de registrar.', { unit: atual });
}

function jaEstornadaErro() {
  return conflito('JA_ESTORNADA', 'Esta movimentação já foi estornada.');
}

function baixaDeVendaErro() {
  return conflito('BAIXA_DE_VENDA', 'Esta saída é de uma venda: ela só volta ao estoque pelo cancelamento da venda.');
}

/** Nome da restrição de um erro do PostgreSQL (o gatilho informa o dele). */
function restricaoDoErro(error: unknown): string | undefined {
  const e = error as { constraint?: string; driverError?: { constraint?: string } };
  return e.driverError?.constraint ?? e.constraint;
}
