// Matriz de acesso de vendas (docs/plans/vendas-v1.md, seção 3), só com
// funções puras. Contra PostgreSQL real (concessões gravadas, gate do
// adicional): test/sales-integrity-postgres.db-e2e-spec.ts.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import {
  SALES_MAINTENANCE_FEATURES,
  SALES_NEW_SALE_FEATURES,
  canAccessSalesHistory,
  canCancelSales,
  canOverrideSalePrice,
  canReceiveSale,
  canRefundSalePayments,
  canRegisterSales,
  canViewAllSales,
} from './sales-access.js';
import { SALES_PERMISSIONS } from '../migrations/1794528000000-SalesEnumValues.js';
import { canManageStock, canViewStock } from '../stock/stock-access.js';

const { DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL } = EstablishmentRole;
const g = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
const n = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.DENIED }));
const TODAS = g(...SALES_PERMISSIONS);

function matriz(role: EstablishmentRole, overrides: ReturnType<typeof g>) {
  return {
    registrar: canRegisterSales(role, overrides),
    receberPropria: canReceiveSale(role, overrides, { ownSale: true }),
    receberDeOutra: canReceiveSale(role, overrides, { ownSale: false }),
    alterarPreco: canOverrideSalePrice(role, overrides),
    historico: canAccessSalesHistory(role, overrides),
    verTodas: canViewAllSales(role, overrides),
    cancelar: canCancelSales(role, overrides),
    estornar: canRefundSalePayments(role, overrides),
    estoque: canViewStock(role, overrides) || canManageStock(role, overrides),
  };
}

const TUDO = {
  registrar: true,
  receberPropria: true,
  receberDeOutra: true,
  alterarPreco: true,
  historico: true,
  verTodas: true,
  cancelar: true,
  estornar: true,
};
const NADA = Object.fromEntries(Object.keys(TUDO).map((k) => [k, false]));

describe('recursos por rota', () => {
  it('nova venda pede VENDAS e ESTOQUE; a manutenção não pede recurso', () => {
    expect(SALES_NEW_SALE_FEATURES).toEqual([FeatureKey.VENDAS, FeatureKey.ESTOQUE]);
    expect(SALES_MAINTENANCE_FEATURES).toBeNull();
  });
});

describe('matriz de vendas', () => {
  it('DONO: tudo; um DENIED tira só aquela ação e as que dependem dela', () => {
    expect(matriz(DONO, [])).toMatchObject({ ...TUDO, estoque: true });
    expect(matriz(DONO, n('VENDAS_REGISTRAR'))).toMatchObject({
      registrar: false,
      receberPropria: false,
      alterarPreco: false,
      verTodas: true,
      cancelar: true,
      historico: true,
    });
    expect(matriz(DONO, n('VENDAS_VISUALIZAR'))).toMatchObject({
      verTodas: false,
      cancelar: false,
      estornar: false,
      receberDeOutra: false,
      receberPropria: true,
    });
  });

  it('GERENTE: nada sem concessão; tudo de vendas com tudo concedido, sem ganhar estoque', () => {
    expect(matriz(GERENTE, [])).toMatchObject({ ...NADA, estoque: false });
    expect(matriz(GERENTE, TODAS)).toMatchObject({ ...TUDO, estoque: false });
  });

  it('GERENTE: receber de outra pessoa exige receber E consultar todas; consulta sozinha não recebe', () => {
    expect(matriz(GERENTE, g('VENDAS_REGISTRAR', 'VENDAS_RECEBER'))).toMatchObject({
      receberPropria: true,
      receberDeOutra: false,
    });
    expect(matriz(GERENTE, g('VENDAS_VISUALIZAR'))).toMatchObject({
      verTodas: true,
      receberPropria: false,
      receberDeOutra: false,
    });
    expect(matriz(GERENTE, g('VENDAS_REGISTRAR', 'VENDAS_RECEBER', 'VENDAS_VISUALIZAR'))).toMatchObject({
      receberDeOutra: true,
    });
  });

  it('GERENTE: dependência que falta não vale (receber sem registrar, cancelar sem consultar)', () => {
    expect(matriz(GERENTE, g('VENDAS_RECEBER')).receberPropria).toBe(false);
    expect(matriz(GERENTE, g('VENDAS_CANCELAR')).cancelar).toBe(false);
    expect(matriz(GERENTE, g('VENDAS_ALTERAR_PRECO')).alterarPreco).toBe(false);
  });

  it('RECEPCIONISTA com TUDO concedido: vende, recebe a própria e altera preço; nunca consulta geral, cancela, estorna ou vê estoque', () => {
    expect(matriz(RECEPCIONISTA, [...TODAS, ...g(Permission.ESTOQUE_VISUALIZAR, Permission.ESTOQUE_GERENCIAR)])).toEqual({
      registrar: true,
      receberPropria: true,
      receberDeOutra: false,
      alterarPreco: true,
      historico: true,
      verTodas: false,
      cancelar: false,
      estornar: false,
      estoque: false,
    });
  });

  it('RECEPCIONISTA: vender não traz preço nem recebimento; cada um é uma concessão separada', () => {
    expect(matriz(RECEPCIONISTA, g('VENDAS_REGISTRAR'))).toMatchObject({
      registrar: true,
      historico: true,
      alterarPreco: false,
      receberPropria: false,
    });
    expect(matriz(RECEPCIONISTA, g('VENDAS_REGISTRAR', 'VENDAS_ALTERAR_PRECO')).alterarPreco).toBe(true);
    expect(matriz(RECEPCIONISTA, [...g('VENDAS_REGISTRAR'), ...n('VENDAS_REGISTRAR')]).registrar).toBe(false);
  });

  it('PROFISSIONAL: nunca, nem com tudo concedido', () => {
    expect(matriz(PROFISSIONAL, TODAS)).toMatchObject({ ...NADA, estoque: false });
  });
});
