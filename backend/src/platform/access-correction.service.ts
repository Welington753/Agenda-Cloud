// Correção de um período de validade registrado por engano (ver
// docs/plans/planos-e-validade-do-acesso.md, seção 2.9).
//
// O que faz: anula o registro. A linha original fica como estava (tipo,
// datas, valor, forma de pagamento, quem registrou) e ganha quem anulou,
// quando e por quê; um período anulado deixa de contar para a validade e
// para as constraints de sobreposição. Nada é apagado.
//
// O que NÃO faz: não devolve nem movimenta dinheiro. Um estorno, se houver,
// acontece fora do Agenda Cloud; aqui só se corrige o registro.
//
// Regras (as mesmas das outras ações de validade):
// - só `MASTER_OWNER`, com senha confirmada há pouco NESTA sessão, motivo
//   obrigatório;
// - a linha do estabelecimento é travada e a versão lida pela tela é
//   conferida: a tela mostrou o impacto sobre a versão que está valendo;
// - a chave do formulário é única por quem anulou: repetir devolve a mesma
//   correção, sem anular outro período;
// - só o último período da cadeia é anulado. Se houver período válido
//   começando no mesmo instante ou depois, anular este deixaria uma lacuna ou
//   exigiria mover os seguintes: recusa, dizendo qual corrigir antes;
// - nunca mexe na situação administrativa (suspensão, arquivamento) nem em
//   outro período.
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { recordAudit } from '../accounts/audit.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { correctionImpact, type AccessSituation, type IdentifiedPeriod } from '../commercial/access-periods.js';
import { loadAccessLegacy, loadAccessPeriods } from '../commercial/commercial-gate.js';
import {
  PERIOD_SELECT,
  br,
  conflito,
  reais,
  toView,
  type AccessPeriodView,
  type PeriodRow,
} from './access-validity.service.js';
import { lifecycleActor, lockEstablishment, writeEstablishment } from './establishment-admin.service.js';
import type { CorrectAccessPeriodDto } from './platform.dto.js';

const CANCEL_KEY_CONSTRAINT = 'uq_tenant_access_periods_cancel_request_key';

const TIPO = { PAID: 'período pago', TRIAL: 'teste', COURTESY: 'cortesia' } as const;

/** Situação comercial como a tela da correção mostra (antes e depois). */
export interface AccessSituationView {
  state: AccessSituation['state'];
  blocked: boolean;
  validUntil: string | null;
}

export interface AccessCorrectionResult {
  created: boolean;
  updatedAt: Date | null;
  period: AccessPeriodView;
}

const vista = (s: AccessSituation): AccessSituationView => ({
  state: s.state,
  blocked: s.blocked,
  validUntil: s.validUntil?.toISOString() ?? null,
});

/** O que a ficha mostra antes de confirmar: se o registro pode ser anulado
 * e como fica a validade depois. `null` num período já anulado. */
export type CorrectionPreview =
  | { allowed: true; after: AccessSituationView }
  | { allowed: false; blockedByPeriodId: string }
  | null;

export function correctionPreview(
  periods: readonly IdentifiedPeriod[],
  view: AccessPeriodView,
  now: Date,
  legacy: { legacy: boolean },
): CorrectionPreview {
  if (view.canceled) return null;
  const impacto = correctionImpact(periods, view.id, now, legacy);
  return impacto.allowed ? { allowed: true, after: vista(impacto.after) } : { allowed: false, blockedByPeriodId: impacto.blockedBy };
}

@Injectable()
export class AccessCorrectionService {
  constructor(private readonly dataSource: DataSource) {}

  async cancelPeriod(
    actorId: string,
    sessionId: string,
    tenantId: string,
    periodId: string,
    dto: CorrectAccessPeriodDto,
    now = new Date(),
  ): Promise<AccessCorrectionResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await lifecycleActor(manager, actorId, sessionId, now);
        const repetida = await this.replay(manager, actorId, dto.requestKey, tenantId, periodId);
        if (repetida) return repetida;
        const atual = await lockEstablishment(manager, tenantId, dto.expectedUpdatedAt).catch(async (erro: unknown) => {
          // Repetição concorrente: a primeira já avançou a versão.
          const outra = await this.replay(manager, actorId, dto.requestKey, tenantId, periodId);
          if (outra) return outra;
          throw erro;
        });
        if ('period' in atual) return atual;

        if (atual.status === 'ARCHIVED') {
          throw conflito('ESTABELECIMENTO_ARQUIVADO', 'Estabelecimento arquivado: reative antes de corrigir a validade.');
        }
        const [linha] = await manager.query<PeriodRow[]>(`${PERIOD_SELECT} WHERE ap.id = $1 AND ap.tenant_id = $2`, [
          periodId,
          atual.id,
        ]);
        if (!linha) throw new NotFoundException('Período não encontrado neste estabelecimento.');
        const original = toView(linha);
        if (original.canceled) {
          throw conflito('PERIODO_JA_CORRIGIDO', 'Este registro já foi anulado. Recarregue a ficha.');
        }

        const periodos = await loadAccessPeriods(manager, atual.id);
        const legado = await loadAccessLegacy(manager, atual.id);
        const impacto = correctionImpact(periodos, original.id, now, legado);
        if (!impacto.allowed) {
          const [seguinte] = await manager.query<PeriodRow[]>(`${PERIOD_SELECT} WHERE ap.id = $1`, [impacto.blockedBy]);
          const s = toView(seguinte);
          throw conflito(
            'CORRECAO_EM_CADEIA',
            `Há um registro depois deste (${TIPO[s.kind]} de ${br(s.firstDay)} a ${br(s.lastDay)}). ` +
              'Anular este deixaria uma lacuna ou exigiria mover os seguintes, e isso não é feito automaticamente. ' +
              'Corrija primeiro o registro mais recente.',
          );
        }

        await manager.query(
          `UPDATE tenant_access_periods
              SET canceled_at = $2, canceled_by_user_id = $3, cancel_reason = $4, cancel_request_key = $5
            WHERE id = $1 AND canceled_at IS NULL`,
          [original.id, now, actor.id, dto.reason, dto.requestKey],
        );
        const versao = await writeEstablishment(manager, atual.id, now, 'status = status', []);
        const [gravada] = await manager.query<PeriodRow[]>(`${PERIOD_SELECT} WHERE ap.id = $1`, [original.id]);
        const periodo = toView(gravada);

        const valor = original.amountCents === null ? '' : `, ${reais(original.amountCents)}`;
        await recordAudit(
          manager,
          {
            action: 'ACCESS_PERIOD_CORRECTED',
            actor,
            tenantId: atual.id,
            summary:
              `Registro de ${TIPO[original.kind]} de ${atual.name} (${br(original.firstDay)} a ${br(original.lastDay)}${valor}) ` +
              `anulado por engano. Correção do registro: nenhum valor foi devolvido ou movimentado pelo sistema. ` +
              `Motivo: ${dto.reason}`,
            previousData: { period: { ...original, canceled: null }, access: vista(impacto.before) },
            newData: {
              periodId: original.id,
              canceledAt: now.toISOString(),
              reason: dto.reason,
              access: vista(impacto.after),
              moneyMoved: false,
            },
          },
          now,
        );
        return { created: true, updatedAt: versao, period: periodo };
      });
    } catch (erro) {
      if (isUniqueViolation(erro, CANCEL_KEY_CONSTRAINT)) {
        const repetida = await this.replay(this.dataSource.manager, actorId, dto.requestKey, tenantId, periodId);
        if (repetida) return repetida;
      }
      throw erro;
    }
  }

  /** A correção já gravada com esta chave por esta pessoa. A mesma chave
   * noutro período é recusada. */
  private async replay(
    manager: EntityManager,
    actorId: string,
    requestKey: string,
    tenantId: string,
    periodId: string,
  ): Promise<AccessCorrectionResult | null> {
    const [linha] = await manager.query<PeriodRow[]>(
      `${PERIOD_SELECT} WHERE ap.canceled_by_user_id = $1 AND ap.cancel_request_key = $2`,
      [actorId, requestKey],
    );
    if (!linha) return null;
    if (linha.tenant_id !== tenantId || linha.id !== periodId) {
      throw conflito('CHAVE_REUTILIZADA', 'Este formulário já foi usado para outra correção. Recarregue a tela.');
    }
    return { created: false, updatedAt: null, period: toView(linha) };
  }
}
