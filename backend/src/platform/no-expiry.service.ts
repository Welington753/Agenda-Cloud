// Acesso "sem vencimento" pela administração da plataforma (ver
// docs/plans/portal-da-plataforma.md, seção 3).
//
// - Só o proprietário da plataforma, com senha confirmada há pouco NESTA
//   sessão, motivo e confirmação explícita. Concessão, retirada e histórico
//   administrativo na mesma transação.
// - Enquanto vale, a validade não bloqueia. NÃO é pagamento, não cria
//   período, não libera recurso fora do plano e não muda papel. A situação
//   administrativa vem antes: inativo (suspenso) continua bloqueado.
// - A retirada nunca apaga a concessão: a mesma linha ganha quem retirou,
//   quando e por quê. Depois dela vale o que os períodos dizem; a marca de
//   anterior ao controle NÃO volta (commercial-gate.ts), então sem período o
//   acesso fica bloqueado. A ficha mostra essa consequência antes
//   (`revokePreview`).
// - Repetir a mesma requisição devolve o que já foi gravado; a mesma chave
//   com outro conteúdo é recusada.
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { recordAudit } from '../accounts/audit.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { generateId } from '../entities/common/generate-id.js';
import { accessSituation, localDate, type AccessSituation, type StoredPeriod } from '../commercial/access-periods.js';
import { loadAccessFlags, loadAccessPeriods } from '../commercial/commercial-gate.js';
import { lifecycleActor, lockEstablishment, writeEstablishment } from './establishment-admin.service.js';
import { conflito } from './access-validity.service.js';
import type { GrantNoExpiryDto, RevokeNoExpiryDto } from './platform.dto.js';

export interface NoExpiryGrantView {
  id: string;
  grantedAt: string;
  grantedBy: { id: string; name: string };
  reason: string;
  revoked: { at: string; by: { id: string; name: string }; reason: string } | null;
}

interface GrantRow {
  id: string;
  tenant_id: string;
  granted_at: Date;
  granted_by_user_id: string;
  granted_by_name: string;
  grant_reason: string;
  grant_request_key: string;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
  revoked_by_name: string | null;
  revoke_reason: string | null;
  revoke_request_key: string | null;
}

const GRANT_SELECT = `SELECT g.id, g.tenant_id, g.granted_at, g.granted_by_user_id, gu.name AS granted_by_name, g.grant_reason,
    g.grant_request_key, g.revoked_at, g.revoked_by_user_id, ru.name AS revoked_by_name, g.revoke_reason, g.revoke_request_key
  FROM tenant_no_expiry_grants g
  JOIN users gu ON gu.id = g.granted_by_user_id
  LEFT JOIN users ru ON ru.id = g.revoked_by_user_id`;

const toView = (l: GrantRow): NoExpiryGrantView => ({
  id: l.id,
  grantedAt: new Date(l.granted_at).toISOString(),
  grantedBy: { id: l.granted_by_user_id, name: l.granted_by_name },
  reason: l.grant_reason,
  revoked: l.revoked_at
    ? { at: new Date(l.revoked_at).toISOString(), by: { id: l.revoked_by_user_id!, name: l.revoked_by_name! }, reason: l.revoke_reason! }
    : null,
});

export async function listNoExpiryGrants(manager: EntityManager, tenantId: string): Promise<NoExpiryGrantView[]> {
  const linhas = await manager.query<GrantRow[]>(`${GRANT_SELECT} WHERE g.tenant_id = $1 ORDER BY g.granted_at DESC, g.id DESC`, [
    tenantId,
  ]);
  return linhas.map(toView);
}

/** Como fica a validade se a concessão em vigor for retirada agora: só os
 * períodos, sem a marca de anterior ao controle. */
export function noExpiryRevokePreview(periods: readonly StoredPeriod[], now: Date): AccessSituation {
  return accessSituation(periods, now, { legacy: false });
}

const dia = (instante: Date | null, timeZone: string) => {
  if (!instante) return null;
  const d = localDate(new Date(instante.getTime() - 1), timeZone);
  return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${d.year}`;
};

/** Consequência em texto, para o histórico. */
export function describeAfterRevoke(depois: AccessSituation, timeZone: string): string {
  if (!depois.blocked) return `o acesso segue pelos períodos registrados, até ${dia(depois.validUntil, timeZone)}`;
  if (depois.state === 'EXPIRED') return `o acesso fica bloqueado: o último período acabou em ${dia(depois.expiredAt, timeZone)}`;
  return 'o acesso fica bloqueado: não há período registrado';
}

@Injectable()
export class NoExpiryService {
  constructor(private readonly dataSource: DataSource) {}

  async grant(actorId: string, sessionId: string, tenantId: string, dto: GrantNoExpiryDto, now = new Date()) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await lifecycleActor(manager, actorId, sessionId, now);
        const repetida = await this.replay(manager, 'grant', actor.id, dto.requestKey, tenantId);
        if (repetida) return repetida;
        const atual = await lockEstablishment(manager, tenantId, dto.expectedUpdatedAt);
        if (atual.status === 'ARCHIVED') {
          throw conflito('ESTABELECIMENTO_ARQUIVADO', 'Estabelecimento arquivado: reative antes de mudar o acesso.');
        }
        const [vigente] = await manager.query<{ id: string }[]>(
          'SELECT id FROM tenant_no_expiry_grants WHERE tenant_id = $1 AND revoked_at IS NULL',
          [atual.id],
        );
        if (vigente) throw conflito('JA_SEM_VENCIMENTO', 'Este estabelecimento já tem acesso sem vencimento.');
        const antes = accessSituation(await loadAccessPeriods(manager, atual.id), now, await loadAccessFlags(manager, atual.id));
        const id = generateId();
        await manager.query(
          `INSERT INTO tenant_no_expiry_grants (id, tenant_id, granted_at, granted_by_user_id, grant_reason, grant_request_key)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, atual.id, now, actor.id, dto.reason, dto.requestKey],
        );
        const versao = await writeEstablishment(manager, atual.id, now, 'status = status', []);
        await recordAudit(
          manager,
          {
            action: 'ACCESS_NO_EXPIRY_GRANTED',
            actor,
            tenantId: atual.id,
            summary:
              `Acesso sem vencimento concedido a ${atual.name}. Não é pagamento, não muda plano, recursos nem papéis` +
              `${atual.status === 'SUSPENDED' ? '; o estabelecimento continua inativo até a reativação' : ''}. Motivo: ${dto.reason}`,
            previousData: { accessState: antes.state, validUntil: antes.validUntil?.toISOString() ?? null, status: atual.status },
            newData: { grantId: id, accessState: 'NO_EXPIRY', reason: dto.reason, moneyMoved: false },
          },
          now,
        );
        const [linha] = await manager.query<GrantRow[]>(`${GRANT_SELECT} WHERE g.id = $1`, [id]);
        return { created: true, updatedAt: versao, grant: toView(linha) };
      });
    } catch (erro) {
      if (isUniqueViolation(erro, 'uq_tenant_no_expiry_grants_grant_key')) {
        const repetida = await this.replay(this.dataSource.manager, 'grant', actorId, dto.requestKey, tenantId);
        if (repetida) return repetida;
      }
      if (isUniqueViolation(erro, 'uq_tenant_no_expiry_grants_active')) {
        throw conflito('JA_SEM_VENCIMENTO', 'Este estabelecimento já tem acesso sem vencimento.');
      }
      throw erro;
    }
  }

  async revoke(actorId: string, sessionId: string, tenantId: string, dto: RevokeNoExpiryDto, now = new Date()) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await lifecycleActor(manager, actorId, sessionId, now);
        const repetida = await this.replay(manager, 'revoke', actor.id, dto.requestKey, tenantId);
        if (repetida) return repetida;
        const atual = await lockEstablishment(manager, tenantId, dto.expectedUpdatedAt);
        if (atual.status === 'ARCHIVED') {
          throw conflito('ESTABELECIMENTO_ARQUIVADO', 'Estabelecimento arquivado: reative antes de mudar o acesso.');
        }
        const [vigente] = await manager.query<{ id: string }[]>(
          'SELECT id FROM tenant_no_expiry_grants WHERE tenant_id = $1 AND revoked_at IS NULL FOR UPDATE',
          [atual.id],
        );
        if (!vigente) throw conflito('SEM_CONCESSAO', 'Este estabelecimento não tem acesso sem vencimento em vigor.');
        const depois = noExpiryRevokePreview(await loadAccessPeriods(manager, atual.id), now);
        await manager.query(
          `UPDATE tenant_no_expiry_grants SET revoked_at = $2, revoked_by_user_id = $3, revoke_reason = $4, revoke_request_key = $5
            WHERE id = $1`,
          [vigente.id, now, actor.id, dto.reason, dto.requestKey],
        );
        const versao = await writeEstablishment(manager, atual.id, now, 'status = status', []);
        await recordAudit(
          manager,
          {
            action: 'ACCESS_NO_EXPIRY_REVOKED',
            actor,
            tenantId: atual.id,
            summary:
              `Acesso sem vencimento de ${atual.name} retirado: ${describeAfterRevoke(depois, atual.timezone)}. ` +
              `Nenhum período foi criado e nenhum agendamento foi cancelado. Motivo: ${dto.reason}`,
            previousData: { grantId: vigente.id, accessState: 'NO_EXPIRY' },
            newData: {
              accessState: depois.state,
              blocked: depois.blocked,
              validUntil: depois.validUntil?.toISOString() ?? null,
              expiredAt: depois.expiredAt?.toISOString() ?? null,
              reason: dto.reason,
            },
          },
          now,
        );
        const [linha] = await manager.query<GrantRow[]>(`${GRANT_SELECT} WHERE g.id = $1`, [vigente.id]);
        return { created: true, updatedAt: versao, grant: toView(linha) };
      });
    } catch (erro) {
      if (isUniqueViolation(erro, 'uq_tenant_no_expiry_grants_revoke_key')) {
        const repetida = await this.replay(this.dataSource.manager, 'revoke', actorId, dto.requestKey, tenantId);
        if (repetida) return repetida;
      }
      throw erro;
    }
  }

  private async replay(manager: EntityManager, acao: 'grant' | 'revoke', actorId: string, requestKey: string, tenantId: string) {
    const coluna = acao === 'grant' ? 'g.granted_by_user_id = $1 AND g.grant_request_key = $2' : 'g.revoked_by_user_id = $1 AND g.revoke_request_key = $2';
    const [linha] = await manager.query<GrantRow[]>(`${GRANT_SELECT} WHERE ${coluna}`, [actorId, requestKey]);
    if (!linha) return null;
    if (linha.tenant_id !== tenantId) {
      throw conflito('CHAVE_REUTILIZADA', 'Este formulário já foi usado para outro registro. Recarregue a tela.');
    }
    return { created: false, updatedAt: null, grant: toView(linha) };
  }
}
