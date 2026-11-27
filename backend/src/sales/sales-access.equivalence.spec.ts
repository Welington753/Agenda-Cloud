// Equivalência por ação e alcance entre as políticas de Vendas e a regra
// anterior à base comum (docs/plans/permissoes-individuais.md, etapa 1).
//
// A REFERÊNCIA é uma cópia congelada das regras de `4e0d841` (o que está no
// piloto), escrita só com listas literais, sem importar `managerCan`,
// `receptionistCan` nem `MANAGER_PERMISSION_REQUIRES`: se alguém mudar essas
// fontes, este teste continua comparando com o comportamento de antes.
//
// Casos: os quatro papéis, gerente confirmado ou não (o descarte dos GRANTED
// acontece em `effectiveOverrides`, antes da política, como no serviço) e
// TODAS as combinações de ausente, GRANTED, DENIED ou os dois para as seis
// permissões de vendas, mais concessões ignoradas pelo papel (estoque,
// agenda, equipe) num lote pseudoaleatório de semente fixa.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { effectiveOverrides, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { MANAGER_PERMISSIONS } from '../common/manager-permissions.js';
import * as vendas from './sales-access.js';

// ---- Referência congelada (4e0d841) ---------------------------------------

const REF_RECEPCIONISTA = ['VENDAS_REGISTRAR', 'VENDAS_RECEBER', 'VENDAS_ALTERAR_PRECO'];
const REF_EXIGE: Record<string, string[]> = {
  VENDAS_REGISTRAR: [],
  VENDAS_RECEBER: ['VENDAS_REGISTRAR'],
  VENDAS_ALTERAR_PRECO: ['VENDAS_REGISTRAR'],
  VENDAS_VISUALIZAR: [],
  VENDAS_CANCELAR: ['VENDAS_VISUALIZAR'],
  VENDAS_ESTORNAR_RECEBIMENTO: ['VENDAS_VISUALIZAR'],
};

function refConcedida(ov: readonly PermissionOverrideLike[], p: string): boolean {
  return ov.some((o) => o.permission === p && o.mode === 'GRANTED') && !ov.some((o) => o.permission === p && o.mode === 'DENIED');
}

function refPode(role: string, ov: readonly PermissionOverrideLike[], p: string): boolean {
  const exigidas = [p, ...REF_EXIGE[p]];
  if (role === 'GERENTE') return exigidas.every((x) => refConcedida(ov, x));
  if (role === 'RECEPCIONISTA') return exigidas.every((x) => REF_RECEPCIONISTA.includes(x) && refConcedida(ov, x));
  if (role !== 'DONO') return false;
  return !ov.some((o) => o.mode === 'DENIED' && exigidas.includes(o.permission));
}

/** Pares (ação, alcance) da regra anterior. */
function referencia(role: string, ov: readonly PermissionOverrideLike[]): Record<string, boolean> {
  const todas = refPode(role, ov, 'VENDAS_VISUALIZAR');
  const receber = refPode(role, ov, 'VENDAS_RECEBER');
  const registrar = refPode(role, ov, 'VENDAS_REGISTRAR');
  return {
    'registrar:proprias': registrar,
    'alterar-preco:venda-nova': refPode(role, ov, 'VENDAS_ALTERAR_PRECO'),
    'consultar:todas': todas,
    'consultar:proprias': registrar || todas,
    'receber:propria': receber,
    'receber:de-outra-pessoa': receber && todas,
    'receber:alguma': receber,
    'cancelar:todas': refPode(role, ov, 'VENDAS_CANCELAR'),
    'estornar:todas': refPode(role, ov, 'VENDAS_ESTORNAR_RECEBIMENTO'),
  };
}

// ---- Código atual ---------------------------------------------------------

/** Cada política `can*` exportada por sales-access.ts, com o alcance. */
const COBERTAS = [
  'canAccessSalesHistory',
  'canCancelSales',
  'canOverrideSalePrice',
  'canReceiveSale',
  'canReceiveSales',
  'canRefundSalePayments',
  'canRegisterSales',
  'canViewAllSales',
];

function atual(role: EstablishmentRole, ov: readonly PermissionOverrideLike[]): Record<string, boolean> {
  return {
    'registrar:proprias': vendas.canRegisterSales(role, ov),
    'alterar-preco:venda-nova': vendas.canOverrideSalePrice(role, ov),
    'consultar:todas': vendas.canViewAllSales(role, ov),
    'consultar:proprias': vendas.canAccessSalesHistory(role, ov),
    'receber:propria': vendas.canReceiveSale(role, ov, { ownSale: true }),
    'receber:de-outra-pessoa': vendas.canReceiveSale(role, ov, { ownSale: false }),
    'receber:alguma': vendas.canReceiveSales(role, ov),
    'cancelar:todas': vendas.canCancelSales(role, ov),
    'estornar:todas': vendas.canRefundSalePayments(role, ov),
  };
}

// ---- Casos ----------------------------------------------------------------

const PAPEIS = [
  EstablishmentRole.DONO,
  EstablishmentRole.GERENTE,
  EstablishmentRole.RECEPCIONISTA,
  EstablishmentRole.PROFISSIONAL,
];
const VENDAS = Object.keys(REF_EXIGE);
const ESTADOS = ['ausente', 'GRANTED', 'DENIED', 'ambos'] as const;

function ajustes(estados: readonly (typeof ESTADOS)[number][], permissoes: readonly string[]): PermissionOverrideLike[] {
  const ov: PermissionOverrideLike[] = [];
  estados.forEach((e, i) => {
    const permission = permissoes[i] as Permission;
    if (e === 'GRANTED' || e === 'ambos') ov.push({ permission, mode: PermissionMode.GRANTED });
    if (e === 'DENIED' || e === 'ambos') ov.push({ permission, mode: PermissionMode.DENIED });
  });
  return ov;
}

function* combinacoes(n: number): Generator<(typeof ESTADOS)[number][]> {
  const total = ESTADOS.length ** n;
  for (let k = 0; k < total; k++) {
    const estados: (typeof ESTADOS)[number][] = [];
    let r = k;
    for (let i = 0; i < n; i++) {
      estados.push(ESTADOS[r % ESTADOS.length]);
      r = Math.floor(r / ESTADOS.length);
    }
    yield estados;
  }
}

/** Gerador congruencial de semente fixa: o lote é sempre o mesmo. */
function sorteador(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function comparar(role: EstablishmentRole, confirmado: boolean, gravados: readonly PermissionOverrideLike[]): string[] {
  // O serviço aplica a confirmação antes da política, igual para os dois.
  const ov = effectiveOverrides(role, confirmado, gravados);
  const antes = referencia(role, ov);
  const depois = atual(role, ov);
  return Object.keys(antes).filter((acao) => antes[acao] !== depois[acao]);
}

describe('Vendas: equivalência com a regra anterior à base comum', () => {
  it('cobre todas as políticas can* exportadas (política nova exige caso novo)', () => {
    const exportadas = Object.keys(vendas).filter((k) => k.startsWith('can')).sort();
    expect(exportadas).toEqual([...COBERTAS].sort());
  });

  it('todas as combinações das seis permissões, nos quatro papéis, confirmado ou não', () => {
    let casos = 0;
    const diferencas: string[] = [];
    for (const role of PAPEIS) {
      for (const confirmado of [true, false]) {
        for (const estados of combinacoes(VENDAS.length)) {
          casos++;
          const dif = comparar(role, confirmado, ajustes(estados, VENDAS));
          if (dif.length && diferencas.length < 5) diferencas.push(`${role} ${confirmado} ${estados.join(',')}: ${dif.join(', ')}`);
        }
      }
    }
    expect(casos).toBe(4 * 2 * 4 ** 6);
    expect(diferencas).toEqual([]);
  });

  it('lote pseudoaleatório com concessões ignoradas pelo papel (todas as permissões)', () => {
    const sortear = sorteador(20261126);
    const universo = [...new Set<string>([...MANAGER_PERMISSIONS, ...Object.values(Permission)])];
    const diferencas: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const role = PAPEIS[Math.floor(sortear() * PAPEIS.length)];
      const confirmado = sortear() < 0.5;
      const estados = universo.map(() => ESTADOS[Math.floor(sortear() * ESTADOS.length)]);
      const dif = comparar(role, confirmado, ajustes(estados, universo));
      if (dif.length && diferencas.length < 5) diferencas.push(`${role} ${confirmado} caso ${i}: ${dif.join(', ')}`);
    }
    expect(diferencas).toEqual([]);
  });

  it('casos nomeados do plano continuam com o mesmo resultado', () => {
    const G = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
    const D = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.DENIED }));
    // Recepcionista com cancelar gravado: ignorado.
    expect(vendas.canCancelSales(EstablishmentRole.RECEPCIONISTA, G('VENDAS_VISUALIZAR', 'VENDAS_CANCELAR'))).toBe(false);
    // Recepcionista recebe só a própria venda.
    const rec = G('VENDAS_REGISTRAR', 'VENDAS_RECEBER');
    expect(vendas.canReceiveSale(EstablishmentRole.RECEPCIONISTA, rec, { ownSale: true })).toBe(true);
    expect(vendas.canReceiveSale(EstablishmentRole.RECEPCIONISTA, rec, { ownSale: false })).toBe(false);
    // Gerente não confirmado: os GRANTED somem antes da política.
    const tudo = G(...VENDAS);
    expect(vendas.canRegisterSales(EstablishmentRole.GERENTE, effectiveOverrides('GERENTE', false, tudo))).toBe(false);
    expect(vendas.canRegisterSales(EstablishmentRole.GERENTE, effectiveOverrides('GERENTE', true, tudo))).toBe(true);
    // DENIED vence GRANTED; DENIED numa dependência bloqueia a ação.
    expect(vendas.canViewAllSales(EstablishmentRole.GERENTE, [...tudo, ...D('VENDAS_VISUALIZAR')])).toBe(false);
    expect(vendas.canCancelSales(EstablishmentRole.DONO, D('VENDAS_VISUALIZAR'))).toBe(false);
    expect(vendas.canRegisterSales(EstablishmentRole.DONO, D('VENDAS_VISUALIZAR'))).toBe(true);
    // Profissional nunca, mesmo com tudo gravado.
    expect(vendas.canRegisterSales(EstablishmentRole.PROFISSIONAL, tudo)).toBe(false);
    // Manutenção de vendas antigas continua sem recurso.
    expect(vendas.SALES_MAINTENANCE_FEATURES).toBeNull();
  });
});
