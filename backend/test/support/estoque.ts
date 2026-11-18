// Apoio dos testes de banco do estoque: banco descartável, estabelecimentos
// fictícios com o adicional ligado como a assinatura liga (override de
// `feat_estoque`), vínculos de dono, gerente, recepcionista e profissional.
// O plano de teste tem todos os recursos MENOS o estoque: estoque só existe
// pelo adicional, como no produto.
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { buildRuntimeDataSourceOptions } from '../../src/database/runtime-data-source.js';
import { comTodosOsRecursos } from './plano-de-teste.js';

export const urlDoBancoDescartavel = (): string | undefined => {
  const url = process.env.DB_E2E_DIRECT_URL;
  if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('Este teste exige PostgreSQL descartável local.');
  }
  return url;
};

export const novoId = () => randomUUID().replaceAll('-', '').slice(0, 24);
export const novaChave = () => `chave-${novoId()}`;

export type ErroHttp = Error & { getResponse?: () => { code?: string; message?: string; [k: string]: unknown }; getStatus?: () => number };

export async function erroDe(promessa: Promise<unknown>): Promise<ErroHttp> {
  try {
    await promessa;
  } catch (error) {
    return error as ErroHttp;
  }
  throw new Error('era esperado um erro');
}

export const codigoDe = async (promessa: Promise<unknown>) => (await erroDe(promessa)).getResponse?.()?.code;
export const statusDe = async (promessa: Promise<unknown>) => (await erroDe(promessa)).getStatus?.();

export async function abrirBanco(url: string): Promise<DataSource> {
  const pasta = path.dirname(fileURLToPath(import.meta.url));
  const entities: (new () => object)[] = [];
  for (const file of globSync(path.join(pasta, '../../src/entities/**/*.entity.ts'))) {
    const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
  }
  const db = new DataSource({ ...buildRuntimeDataSourceOptions(url), entities, logging: ['error'] });
  await db.initialize();
  return db;
}

export interface Pessoa {
  userId: string;
  sessionId: string;
  membershipId: string;
}

export interface Estabelecimento {
  tenantId: string;
  nome: string;
  dono: Pessoa;
}

/** Fábrica de dados fictícios de um spec (marca própria nos slugs e e-mails). */
export function semeador(db: DataSource, marca: string) {
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)) as T[];
  let planoId: string | null = null;
  const gerentes: string[] = [];

  async function plano(): Promise<string> {
    if (planoId) return planoId;
    planoId = novoId();
    await q(
      comTodosOsRecursos(`INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $1, 'Plano de teste do estoque', '', 20, 1)`),
      [planoId],
    );
    await q(`DELETE FROM plan_features WHERE plan_id = $1 AND feature_id = 'feat_estoque'`, [planoId]);
    return planoId;
  }

  async function conta(nome: string, extra: { platformRole?: string } = {}): Promise<{ userId: string; sessionId: string }> {
    const userId = novoId();
    await q(
      `INSERT INTO users (id, name, email, status, platform_role, email_verified) VALUES ($1, $2, $3, 'ACTIVE', $4::platform_role, true)`,
      [userId, `Pessoa ${nome}`, `${marca}-${nome}-${userId.slice(0, 6)}@example.test`, extra.platformRole ?? null],
    );
    const sessionId = novoId();
    await q(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, reauthenticated_at) VALUES ($1, $2, $3, now() + interval '1 day', now())`,
      [sessionId, userId, novoId() + novoId()],
    );
    return { userId, sessionId };
  }

  async function estabelecimento(nome: string, comEstoque = true): Promise<Estabelecimento> {
    const tenantId = novoId();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since)
       VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now())`,
      [tenantId, `${marca}-${nome}-${tenantId.slice(0, 6)}`, await plano()],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', 'America/Sao_Paulo', true)`, [
      novoId(),
      tenantId,
      nome,
    ]);
    const pessoa = await conta(`${nome}-dono`);
    const membershipId = novoId();
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [membershipId, pessoa.userId, tenantId]);
    if (comEstoque) await ligarEstoque(tenantId);
    return { tenantId, nome, dono: { ...pessoa, membershipId } };
  }

  /** Como a assinatura liga um adicional (platform/subscription.service.ts). */
  async function ligarEstoque(tenantId: string) {
    await q(
      `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) VALUES ($1, $2, 'feat_estoque', true)
       ON CONFLICT (tenant_id, feature_id) DO UPDATE SET enabled = true`,
      [novoId(), tenantId],
    );
  }

  async function desligarEstoque(tenantId: string) {
    await q(`DELETE FROM tenant_feature_overrides WHERE tenant_id = $1 AND feature_id = 'feat_estoque'`, [tenantId]);
  }

  /** Vínculo de equipe. GERENTE com as concessões dadas (confirmadas). */
  async function vinculo(
    est: Estabelecimento,
    nome: string,
    role: 'GERENTE' | 'RECEPCIONISTA' | 'PROFISSIONAL',
    concedidas: string[] = [],
  ): Promise<Pessoa> {
    const pessoa = await conta(`${est.nome}-${nome}`);
    let professionalId: string | null = null;
    if (role === 'PROFISSIONAL') {
      professionalId = novoId();
      await q(`INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, $3, 'PX', '#000000')`, [
        professionalId,
        est.tenantId,
        `Profissional ${nome}`,
      ]);
    }
    const membershipId = novoId();
    await q(
      `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, status, permissions_confirmed_at)
       VALUES ($1, $2, $3, $4::establishment_role, $5, 'ACTIVE', now())`,
      [membershipId, pessoa.userId, est.tenantId, role, professionalId],
    );
    if (role === 'GERENTE') gerentes.push(membershipId);
    for (const permissao of concedidas) {
      await q(
        `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
         VALUES ($1, $2, $3, $4::permission, 'GRANTED')`,
        [novoId(), est.tenantId, membershipId, permissao],
      );
    }
    return { ...pessoa, membershipId };
  }

  /** O check do piloto de gerentes lê o mesmo banco: os gerentes deste spec
   * saem no fim (concessões e vínculos), sem tocar em dado de outro spec. */
  async function limparGerentes() {
    if (!gerentes.length) return;
    await q(`DELETE FROM membership_permission_overrides WHERE membership_id = ANY($1::varchar[])`, [gerentes]);
    await q(`UPDATE memberships SET role = 'RECEPCIONISTA' WHERE id = ANY($1::varchar[])`, [gerentes]);
  }

  return { q, plano, conta, estabelecimento, ligarEstoque, desligarEstoque, vinculo, limparGerentes };
}
