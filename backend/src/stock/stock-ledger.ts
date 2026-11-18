// Gravação de uma movimentação de estoque, igual para saldo inicial,
// entrada, saídas, estorno e ajuste de conferência. Quem chama já travou o
// produto (`travarProduto`, `FOR UPDATE`) na MESMA transação: duas saídas
// simultâneas ficam em fila, e a segunda vê o saldo que a primeira deixou.
// O `CHECK (balance_milli >= 0)` é a última barreira.
//
// A movimentação guarda saldo anterior e posterior; o produto guarda o saldo
// atual e a versão (uma a mais por movimentação). Invariante, provada nos
// testes com banco: saldo = soma das movimentações; versão = quantidade de
// movimentações.
import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { linhasDe } from '../common/linhas-de.js';
import { generateId } from '../entities/common/generate-id.js';
import { conflito, numero } from './stock-common.js';
import { MAX_BALANCE_MILLI, type StockMovementKind, type StockPurpose, type StockUnit } from './stock-quantity.js';

export interface ProdutoTravado {
  id: string;
  name: string;
  unit: StockUnit;
  purpose: StockPurpose;
  balanceMilli: number;
  balanceVersion: number;
  archived: boolean;
}

export async function travarProduto(manager: EntityManager, tenantId: string, productId: string): Promise<ProdutoTravado> {
  const [linha] = linhasDe<{
    id: string;
    name: string;
    unit: StockUnit;
    purpose: StockPurpose;
    balance_milli: string;
    balance_version: number;
    archived_at: Date | null;
  }>(
    await manager.query(
      `SELECT id, name, unit, purpose, balance_milli::text AS balance_milli, balance_version, archived_at
         FROM stock_products WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, productId],
    ),
  );
  if (!linha) throw new NotFoundException('Produto não encontrado.');
  return {
    id: linha.id,
    name: linha.name,
    unit: linha.unit,
    purpose: linha.purpose,
    balanceMilli: numero(linha.balance_milli),
    balanceVersion: Number(linha.balance_version),
    archived: linha.archived_at !== null,
  };
}

export const SALDO_INSUFICIENTE = (produto: ProdutoTravado) =>
  conflito('SALDO_INSUFICIENTE', `Saldo insuficiente de "${produto.name}". O estoque não pode ficar negativo.`, {
    balanceMilli: produto.balanceMilli,
    balanceVersion: produto.balanceVersion,
  });

export const PRODUTO_ARQUIVADO = () => conflito('PRODUTO_ARQUIVADO', 'Produto arquivado não recebe movimentação. Reative-o antes.');

export interface NovaMovimentacao {
  tenantId: string;
  produto: ProdutoTravado;
  kind: StockMovementKind;
  deltaMilli: number;
  reason: string | null;
  userId: string;
  now: Date;
  reversesMovementId?: string | null;
  countId?: string | null;
  requestKey?: string | null;
  requestFingerprint?: string | null;
}

/** Grava a movimentação e o saldo novo. Atualiza `produto` em memória para
 * quem continuar na mesma transação. */
export async function registrarMovimentacao(manager: EntityManager, m: NovaMovimentacao): Promise<string> {
  if (m.produto.archived) throw PRODUTO_ARQUIVADO();
  const antes = m.produto.balanceMilli;
  const depois = antes + m.deltaMilli;
  if (depois < 0) throw SALDO_INSUFICIENTE(m.produto);
  if (depois > MAX_BALANCE_MILLI) {
    throw conflito('SALDO_ACIMA_DO_LIMITE', 'O saldo passaria do limite permitido para um produto.');
  }
  const id = generateId();
  await manager.query(
    `INSERT INTO stock_movements (id, tenant_id, product_id, kind, quantity_milli, delta_milli, balance_before_milli,
        balance_after_milli, unit, reason, reverses_movement_id, count_id, recorded_by_user_id, recorded_at,
        request_key, request_fingerprint)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      id,
      m.tenantId,
      m.produto.id,
      m.kind,
      Math.abs(m.deltaMilli),
      m.deltaMilli,
      antes,
      depois,
      m.produto.unit,
      m.reason,
      m.reversesMovementId ?? null,
      m.countId ?? null,
      m.userId,
      m.now,
      m.requestKey ?? null,
      m.requestFingerprint ?? null,
    ],
  );
  await manager.query(
    `UPDATE stock_products SET balance_milli = $3, balance_version = balance_version + 1 WHERE tenant_id = $1 AND id = $2`,
    [m.tenantId, m.produto.id, depois],
  );
  m.produto.balanceMilli = depois;
  m.produto.balanceVersion += 1;
  return id;
}
