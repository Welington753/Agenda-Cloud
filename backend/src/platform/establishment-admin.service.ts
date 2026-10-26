// Escritas da administração da plataforma sobre um estabelecimento: dados
// cadastrais, situação (suspender, reativar, arquivar) e plano.
//
// Regras comuns (as mesmas da gestão de contas):
// - quem age é relido do banco dentro da transação;
// - a tela manda o `updated_at` que leu: se outra tela mudou antes, 409;
// - mudanças de situação e de plano exigem senha confirmada há pouco NESTA
//   sessão; dados cadastrais não (como nome e telefone de uma conta);
// - mudança e histórico na mesma transação.
//
// EFEITOS
// - Suspender: o estabelecimento para de operar (painel da equipe, agenda,
//   agendamento público e avisos). Nada é apagado; as contas continuam
//   entrando nos OUTROS estabelecimentos a que têm acesso.
// - Arquivar: o mesmo, como encerramento (exclusão lógica). Agenda, clientes,
//   reservas, vínculos e histórico ficam. Reversível pela reativação.
// - Reativar: volta à situação anterior à restrição (TRIAL ou ACTIVE).
// - O endereço público (`slug`) nunca muda aqui: links já distribuídos
//   exigem um fluxo próprio.
// - Trocar plano: recusado se o uso atual passar dos limites do plano novo;
//   nada é desligado para caber.
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor, requireCapability, type Actor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { requireRecentReauth } from '../accounts/reauth.js';
import { linhasDe } from '../notifications/notification-jobs.repository.js';
import { activeProfessionals, isOperational, staffSeatUsage, unitsCount } from '../team/seats.js';
import type {
  ArchiveEstablishmentDto,
  ChangePlanDto,
  ReactivateEstablishmentDto,
  SuspendEstablishmentDto,
  UpdateEstablishmentDto,
} from './platform.dto.js';

const conflito = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ code, message, ...extra });

interface TenantRow {
  id: string;
  slug: string;
  status: string;
  restore_status: string | null;
  category: string;
  tax_document: string | null;
  updated_at: Date;
  plan_id: string;
  name: string;
  unit_id: string | null;
}

/** `updated_at` do estabelecimento é a versão comparada pelas telas: sempre
 * avança, mesmo com duas escritas no mesmo milissegundo. */
const AVANCAR = `updated_at = GREATEST($2::timestamptz, updated_at + interval '1 millisecond')`;

export interface PlanExcess {
  kind: 'PROFESSIONALS' | 'STAFF_ACCESSES' | 'UNITS';
  used: number;
  limit: number;
  action: string;
}

/** O que passaria do limite com este plano (vazio: cabe). Usado na troca e
 * na ficha, que mostra antes se cada plano comporta o uso atual. */
export async function planExcess(
  manager: EntityManager,
  tenantId: string,
  plano: { max_professionals: number; max_units: number },
  now: Date,
): Promise<PlanExcess[]> {
  const excesso: PlanExcess[] = [];
  const profissionais = await activeProfessionals(manager, tenantId);
  if (profissionais > plano.max_professionals) {
    excesso.push({
      kind: 'PROFESSIONALS',
      used: profissionais,
      limit: plano.max_professionals,
      action: `Desative ${profissionais - plano.max_professionals} profissional(is) (ativos: ${profissionais}, limite: ${plano.max_professionals}).`,
    });
  }
  const vagas = await staffSeatUsage(manager, tenantId, plano.max_professionals, now);
  if (vagas.used > plano.max_professionals) {
    excesso.push({
      kind: 'STAFF_ACCESSES',
      used: vagas.used,
      limit: plano.max_professionals,
      action: `Revogue convites ou suspenda acessos de funcionário: ${vagas.used - plano.max_professionals} a mais (ativos: ${vagas.activeAccesses}, convites pendentes: ${vagas.pendingInvites}).`,
    });
  }
  const unidades = await unitsCount(manager, tenantId);
  if (unidades > plano.max_units) {
    excesso.push({
      kind: 'UNITS',
      used: unidades,
      limit: plano.max_units,
      action: `O estabelecimento tem ${unidades} unidade(s); o plano permite ${plano.max_units}.`,
    });
  }
  return excesso;
}

@Injectable()
export class EstablishmentAdminService {
  constructor(private readonly dataSource: DataSource) {}

  async update(actorId: string, tenantId: string, dto: UpdateEstablishmentDto, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      const actor = await loadActor(manager, actorId);
      requireCapability(actor, 'manageEstablishments');
      const atual = await this.lockTenant(manager, tenantId, dto.expectedUpdatedAt);
      const novo = {
        name: dto.name ?? atual.name,
        category: dto.category ?? atual.category,
        taxDocument: dto.taxDocument === undefined ? atual.tax_document : dto.taxDocument,
      };
      const anterior = { name: atual.name, category: atual.category, taxDocument: atual.tax_document };
      if (JSON.stringify(novo) === JSON.stringify(anterior)) return { updatedAt: atual.updated_at };
      if (novo.name !== atual.name) {
        if (!atual.unit_id) throw conflito('SEM_UNIDADE', 'Este estabelecimento não tem unidade principal.');
        await manager.query('UPDATE units SET name = $2 WHERE id = $1 AND tenant_id = $3', [
          atual.unit_id,
          novo.name,
          atual.id,
        ]);
      }
      const versao = await this.gravar(
        manager,
        atual.id,
        now,
        `category = $3::business_category, tax_document = $4`,
        [novo.category, novo.taxDocument],
      );
      await recordAudit(
        manager,
        {
          action: 'TENANT_UPDATED',
          actor,
          tenantId: atual.id,
          summary: `Dados cadastrais de ${novo.name} atualizados (endereço público mantido: ${atual.slug}).`,
          previousData: anterior,
          newData: novo,
        },
        now,
      );
      return { updatedAt: versao };
    });
  }

  async suspend(actorId: string, sessionId: string, tenantId: string, dto: SuspendEstablishmentDto, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.lifecycleActor(manager, actorId, sessionId, now);
      const atual = await this.lockTenant(manager, tenantId, dto.expectedUpdatedAt);
      if (!isOperational(atual.status)) {
        throw conflito('SITUACAO_INVALIDA', 'Só um estabelecimento em operação (teste ou ativo) pode ser suspenso.');
      }
      const versao = await this.gravar(
        manager,
        atual.id,
        now,
        `status = 'SUSPENDED', restore_status = $3::tenant_status, suspension_reason = $4`,
        [atual.status, dto.reason],
      );
      await recordAudit(
        manager,
        {
          action: 'TENANT_SUSPENDED',
          actor,
          tenantId: atual.id,
          summary: `Estabelecimento ${atual.name} suspenso: ${dto.reason}`,
          previousData: { status: atual.status },
          newData: { status: 'SUSPENDED', reason: dto.reason },
        },
        now,
      );
      return { updatedAt: versao, status: 'SUSPENDED' };
    });
  }

  async archive(actorId: string, sessionId: string, tenantId: string, dto: ArchiveEstablishmentDto, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.lifecycleActor(manager, actorId, sessionId, now);
      const atual = await this.lockTenant(manager, tenantId, dto.expectedUpdatedAt);
      if (atual.status === 'ARCHIVED') throw conflito('JA_ARQUIVADO', 'Este estabelecimento já está arquivado.');
      if (!isOperational(atual.status) && atual.status !== 'SUSPENDED') {
        throw conflito('SITUACAO_INVALIDA', 'Esta situação não pode ser arquivada por aqui.');
      }
      if (dto.confirmSlug.toLowerCase() !== atual.slug.toLowerCase()) {
        throw conflito('CONFIRMACAO_DIFERENTE', 'Digite o endereço do estabelecimento exatamente como aparece para confirmar.');
      }
      const restaurar = isOperational(atual.status) ? atual.status : atual.restore_status;
      const versao = await this.gravar(
        manager,
        atual.id,
        now,
        `status = 'ARCHIVED', restore_status = $3::tenant_status, suspension_reason = $4`,
        [restaurar, dto.reason],
      );
      await recordAudit(
        manager,
        {
          action: 'TENANT_ARCHIVED',
          actor,
          tenantId: atual.id,
          summary: `Estabelecimento ${atual.name} arquivado: ${dto.reason}`,
          previousData: { status: atual.status },
          newData: { status: 'ARCHIVED', reason: dto.reason },
        },
        now,
      );
      return { updatedAt: versao, status: 'ARCHIVED' };
    });
  }

  async reactivate(
    actorId: string,
    sessionId: string,
    tenantId: string,
    dto: ReactivateEstablishmentDto,
    now = new Date(),
  ) {
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.lifecycleActor(manager, actorId, sessionId, now);
      const atual = await this.lockTenant(manager, tenantId, dto.expectedUpdatedAt);
      if (atual.status !== 'SUSPENDED' && atual.status !== 'ARCHIVED') {
        throw conflito('SITUACAO_INVALIDA', 'Só um estabelecimento suspenso ou arquivado pode ser reativado.');
      }
      if (!atual.restore_status) {
        throw conflito(
          'SITUACAO_ANTERIOR_DESCONHECIDA',
          'Não há registro da situação anterior deste estabelecimento; a reativação não vai inventar uma.',
        );
      }
      const versao = await this.gravar(
        manager,
        atual.id,
        now,
        `status = $3::tenant_status, restore_status = NULL, suspension_reason = NULL`,
        [atual.restore_status],
      );
      await recordAudit(
        manager,
        {
          action: 'TENANT_REACTIVATED',
          actor,
          tenantId: atual.id,
          summary: `Estabelecimento ${atual.name} reativado.`,
          previousData: { status: atual.status },
          newData: { status: atual.restore_status },
        },
        now,
      );
      return { updatedAt: versao, status: atual.restore_status };
    });
  }

  async changePlan(actorId: string, sessionId: string, tenantId: string, dto: ChangePlanDto, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.lifecycleActor(manager, actorId, sessionId, now);
      // `lockTenant` pega o mesmo lock das vagas (seats.ts): um convite ou um
      // profissional novo em paralelo fica em fila e é contado aqui (ou vê o
      // plano novo).
      const atual = await this.lockTenant(manager, tenantId, dto.expectedUpdatedAt);
      if (atual.plan_id === dto.planId) return { updatedAt: atual.updated_at, planId: atual.plan_id };
      const [plano] = await manager.query<{ id: string; code: string; name: string; max_professionals: number; max_units: number }[]>(
        'SELECT id, code, name, max_professionals, max_units FROM plans WHERE id = $1',
        [dto.planId],
      );
      if (!plano) throw new NotFoundException('Plano não encontrado no catálogo.');
      const [anterior] = await manager.query<{ code: string; name: string }[]>('SELECT code, name FROM plans WHERE id = $1', [
        atual.plan_id,
      ]);
      const excesso = await planExcess(manager, atual.id, plano, now);
      if (excesso.length) {
        throw conflito(
          'PLANO_EXCEDIDO',
          `O uso atual passa dos limites do plano ${plano.name}. Ajuste antes de trocar: ` +
            excesso.map((e) => e.action).join(' '),
          { excess: excesso },
        );
      }
      const versao = await this.gravar(manager, atual.id, now, `plan_id = $3`, [plano.id]);
      await recordAudit(
        manager,
        {
          action: 'TENANT_PLAN_CHANGED',
          actor,
          tenantId: atual.id,
          summary: `Plano de ${atual.name} trocado de ${anterior?.name ?? atual.plan_id} para ${plano.name}.`,
          previousData: { planId: atual.plan_id, planCode: anterior?.code ?? null },
          newData: { planId: plano.id, planCode: plano.code },
        },
        now,
      );
      return { updatedAt: versao, planId: plano.id };
    });
  }

  // ---------------------------------------------------------------- internos

  private async lifecycleActor(manager: EntityManager, actorId: string, sessionId: string, now: Date): Promise<Actor> {
    await requireRecentReauth(manager, sessionId, now);
    const actor = await loadActor(manager, actorId);
    requireCapability(actor, 'manageEstablishmentLifecycle');
    return actor;
  }

  private async lockTenant(manager: EntityManager, tenantId: string, expectedUpdatedAt: string): Promise<TenantRow> {
    const [linha] = await manager.query<TenantRow[]>(
      `SELECT t.id, t.slug::text AS slug, t.status::text AS status, t.restore_status::text AS restore_status,
              t.category::text AS category, t.tax_document, t.updated_at, t.plan_id,
              COALESCE(u.name, t.slug::text) AS name, u.id AS unit_id
         FROM tenants t
         LEFT JOIN LATERAL (
           SELECT id, name FROM units WHERE tenant_id = t.id AND is_primary = true ORDER BY created_at, id LIMIT 1
         ) u ON true
        WHERE t.id = $1 FOR NO KEY UPDATE OF t`,
      [tenantId],
    );
    if (!linha) throw new NotFoundException('Estabelecimento não encontrado.');
    if (new Date(linha.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw conflito('ALTERADO_POR_OUTRA_TELA', 'O estabelecimento mudou desde que você abriu a tela. Recarregue e confira.');
    }
    return linha;
  }

  /** Atualiza o estabelecimento e devolve a nova versão. `$1` é o id, `$2` o
   * instante; os demais parâmetros começam em `$3`. */
  private async gravar(manager: EntityManager, tenantId: string, now: Date, sets: string, valores: unknown[]): Promise<Date> {
    const [linha] = linhasDe<{ updated_at: Date }>(
      await manager.query(`UPDATE tenants SET ${sets}, ${AVANCAR} WHERE id = $1 RETURNING updated_at`, [
        tenantId,
        now,
        ...valores,
      ]),
    );
    return linha.updated_at;
  }
}
