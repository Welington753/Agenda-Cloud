// Peças comuns dos serviços do estoque: autorização (sempre a primeira
// chamada, com o recurso do adicional), recusas com `code`, cursor das
// listas e leitura das linhas (bigint chega como texto do driver).
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { resolveAuthorizedTenant, type AuthorizedTenant } from '../common/tenant-authorization.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { canManageStock, canViewStock, STOCK_FORBIDDEN_MESSAGE, STOCK_MANAGE_FORBIDDEN_MESSAGE } from './stock-access.js';

export const conflito = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ code, message, ...extra });

export const LIMITE_DA_PAGINA = 100;

/** Sem vínculo: 404. Sem adicional: 403 `RECURSO_NAO_CONTRATADO`. Sem
 * permissão: 403. Sempre antes de ler ou gravar qualquer dado. */
export function autorizarConsulta(manager: EntityManager, userId: string, tenantId: string): Promise<AuthorizedTenant> {
  return resolveAuthorizedTenant(manager, userId, tenantId, {
    permitido: canViewStock,
    mensagemProibido: STOCK_FORBIDDEN_MESSAGE,
    recurso: FeatureKey.ESTOQUE,
  });
}

export function autorizarOperacao(manager: EntityManager, userId: string, tenantId: string): Promise<AuthorizedTenant> {
  return resolveAuthorizedTenant(manager, userId, tenantId, {
    permitido: canManageStock,
    mensagemProibido: STOCK_MANAGE_FORBIDDEN_MESSAGE,
    recurso: FeatureKey.ESTOQUE,
  });
}

export const CHAVE_REUTILIZADA = () =>
  conflito('CHAVE_REUTILIZADA', 'Este envio já foi usado com outros dados. Recarregue a tela antes de tentar de novo.');
export const CHAVE_EM_USO = () =>
  conflito('CHAVE_EM_USO', 'Este formulário já foi usado. Atualize a página antes de enviar de novo.');

/** Resultado de um envio repetido: mesmo dado devolve o original; dado
 * diferente, 409 sem gravar. */
export function conferirRepeticao<T>(original: { fingerprint: string; value: T }, impressao: string): T {
  if (original.fingerprint !== impressao) throw CHAVE_REUTILIZADA();
  return original.value;
}

/** Cursor opaco das listas (ordem decrescente por data e id). */
export function codificarCursor(partes: readonly string[]): string {
  return Buffer.from(JSON.stringify(partes), 'utf8').toString('base64url');
}

export function decodificarCursor(cursor: string | undefined, tamanho: number): string[] | null {
  if (!cursor) return null;
  try {
    const partes = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(partes) && partes.length === tamanho && partes.every((p) => typeof p === 'string')) return partes;
  } catch {
    // cursor inválido: tratado abaixo
  }
  throw conflito('CURSOR_INVALIDO', 'A lista mudou. Recarregue a página.');
}

export const numero = (valor: string | number | null | undefined): number => (valor === null || valor === undefined ? 0 : Number(valor));
export const iso = (valor: Date | string | null): string | null => (valor === null ? null : new Date(valor).toISOString());

/** `LIKE` com o termo literal (sem curingas do usuário). */
export function termoDeBusca(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
