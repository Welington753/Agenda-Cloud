// Regras de comissão por profissional e serviço, e o relatório do dono.
// Autorização refeita a cada requisição (vínculo, estabelecimento, validade,
// recurso `COMISSOES` do plano e política do papel). Ids de profissional ou
// serviço de outro estabelecimento são indistinguíveis de inexistentes.
//
// Mudar uma regra vale só para as próximas conclusões: o que já foi apurado
// guarda a própria fotografia (commission-accrual.ts).
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { dataLocalDe } from '../availability/time-zone.js';
import { linhasDe } from '../common/linhas-de.js';
import { resolveAuthorizedTenant } from '../common/tenant-authorization.js';
import { mesDaData } from '../dashboard/dashboard-period.js';
import { generateId } from '../entities/common/generate-id.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import {
  COMMISSIONS_FORBIDDEN_MESSAGE,
  COMMISSION_RULES_FORBIDDEN_MESSAGE,
  canManageCommissionRules,
  canViewCommissions,
} from './commission-access.js';
import { ruleToView, viewToRule, type RuleView, type StoredRule } from './commission-calculation.js';
import { commissionReport } from './commission-report.js';
import type { CommissionReportQuery, CommissionRuleDto } from './commissions.dto.js';

const PROFESSIONAL_NOT_FOUND_MESSAGE = 'Profissional não encontrado.';
const SERVICE_NOT_FOUND_MESSAGE = 'Serviço não encontrado.';

export interface ProfessionalRulesView {
  professional: { id: string; name: string; active: boolean };
  services: {
    service: { id: string; name: string; priceCents: number | null; active: boolean };
    /** O profissional atende este serviço hoje. Regra de serviço que ele não
     * atende mais continua listada, e só vale se ele voltar a atender. */
    linked: boolean;
    /** `null`: não configurada. */
    rule: RuleView | null;
    updatedAt: string | null;
  }[];
}

const descrever = (regra: RuleView | null) =>
  regra === null
    ? 'não configurada'
    : regra.kind === 'NONE'
      ? 'sem comissão'
      : regra.kind === 'PERCENTAGE'
        ? `${(regra.value! / 100).toFixed(2)}%`
        : `R$ ${(regra.value! / 100).toFixed(2)} fixo`;

@Injectable()
export class CommissionsService {
  constructor(private readonly dataSource: DataSource) {}

  private autorizar(manager: EntityManager, userId: string, tenantId: string, gerenciar: boolean) {
    return resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: gerenciar ? canManageCommissionRules : canViewCommissions,
      mensagemProibido: gerenciar ? COMMISSION_RULES_FORBIDDEN_MESSAGE : COMMISSIONS_FORBIDDEN_MESSAGE,
      recurso: FeatureKey.COMISSOES,
    });
  }

  async rules(userId: string, tenantId: string, professionalId: string): Promise<ProfessionalRulesView> {
    const manager = this.dataSource.manager;
    const autorizado = await this.autorizar(manager, userId, tenantId, true);
    return this.lerRegras(manager, autorizado.tenantId, professionalId);
  }

  async setRule(
    userId: string,
    tenantId: string,
    professionalId: string,
    serviceId: string,
    dto: CommissionRuleDto,
    now = new Date(),
  ): Promise<ProfessionalRulesView> {
    const tenant = await this.dataSource.transaction(async (manager) => {
      const autorizado = await this.autorizar(manager, userId, tenantId, true);
      const { profissional, servico, anterior } = await this.travarAlvo(manager, autorizado.tenantId, professionalId, serviceId);
      const [vinculo] = await manager.query<unknown[]>(
        `SELECT 1 FROM professional_services WHERE tenant_id = $1 AND professional_id = $2 AND service_id = $3`,
        [autorizado.tenantId, professionalId, serviceId],
      );
      if (!vinculo) {
        throw new ConflictException({
          code: 'SERVICO_NAO_VINCULADO',
          message: 'Este profissional não atende este serviço. Vincule o serviço antes de definir a comissão.',
        });
      }
      const nova = viewToRule(dto.kind === 'NONE' ? { kind: 'NONE', value: null } : { kind: dto.kind, value: dto.value });
      if (anterior && anterior.type === nova.type && anterior.value === nova.value) return autorizado.tenantId;
      await manager.query(
        `INSERT INTO commission_rules (id, tenant_id, professional_id, service_id, type, value, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::commission_type, $6, $7, $7)
         ON CONFLICT ON CONSTRAINT uq_commission_rules_tenant_professional_service
         DO UPDATE SET type = EXCLUDED.type, value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [generateId(), autorizado.tenantId, professionalId, serviceId, nova.type, nova.value, now],
      );
      await this.auditar(manager, userId, autorizado.tenantId, profissional, servico, anterior, nova, now);
      return autorizado.tenantId;
    });
    return this.lerRegras(this.dataSource.manager, tenant, professionalId);
  }

  /** Volta a "não configurada". As apurações já gravadas não mudam. */
  async clearRule(userId: string, tenantId: string, professionalId: string, serviceId: string, now = new Date()) {
    const tenant = await this.dataSource.transaction(async (manager) => {
      const autorizado = await this.autorizar(manager, userId, tenantId, true);
      const { profissional, servico, anterior } = await this.travarAlvo(manager, autorizado.tenantId, professionalId, serviceId);
      if (!anterior) return autorizado.tenantId;
      await manager.query(
        `DELETE FROM commission_rules WHERE tenant_id = $1 AND professional_id = $2 AND service_id = $3`,
        [autorizado.tenantId, professionalId, serviceId],
      );
      await this.auditar(manager, userId, autorizado.tenantId, profissional, servico, anterior, null, now);
      return autorizado.tenantId;
    });
    return this.lerRegras(this.dataSource.manager, tenant, professionalId);
  }

  async report(userId: string, tenantId: string, query: CommissionReportQuery, now = new Date()) {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const autorizado = await this.autorizar(manager, userId, tenantId, false);
      const [t] = linhasDe<{ timezone: string }>(
        await manager.query('SELECT timezone FROM tenants WHERE id = $1', [autorizado.tenantId]),
      );
      if (query.professionalId) {
        const [p] = await manager.query<unknown[]>('SELECT 1 FROM professionals WHERE tenant_id = $1 AND id = $2', [
          autorizado.tenantId,
          query.professionalId,
        ]);
        if (!p) throw new NotFoundException(PROFESSIONAL_NOT_FOUND_MESSAGE);
      }
      const periodo = query.from && query.to ? { from: query.from, to: query.to } : mesDaData(dataLocalDe(now, t.timezone));
      const relatorio = await commissionReport(manager, {
        tenantId: autorizado.tenantId,
        timezone: t.timezone,
        period: periodo,
        professionalId: query.professionalId,
        withClientPayment: true,
      });
      const opcoes = linhasDe<{ id: string; name: string; active: boolean }>(
        await manager.query('SELECT id, name, active FROM professionals WHERE tenant_id = $1 ORDER BY name, id', [
          autorizado.tenantId,
        ]),
      );
      return { ...relatorio, professionalOptions: opcoes };
    });
  }

  private async travarAlvo(manager: EntityManager, tenantId: string, professionalId: string, serviceId: string) {
    const [profissional] = linhasDe<{ id: string; name: string }>(
      await manager.query('SELECT id, name FROM professionals WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [
        tenantId,
        professionalId,
      ]),
    );
    if (!profissional) throw new NotFoundException(PROFESSIONAL_NOT_FOUND_MESSAGE);
    const [servico] = linhasDe<{ id: string; name: string }>(
      await manager.query('SELECT id, name FROM services WHERE tenant_id = $1 AND id = $2', [tenantId, serviceId]),
    );
    if (!servico) throw new NotFoundException(SERVICE_NOT_FOUND_MESSAGE);
    const [anterior] = linhasDe<StoredRule>(
      await manager.query(
        `SELECT type::text AS type, value FROM commission_rules WHERE tenant_id = $1 AND professional_id = $2 AND service_id = $3`,
        [tenantId, professionalId, serviceId],
      ),
    );
    return { profissional, servico, anterior: anterior ? { type: anterior.type, value: Number(anterior.value) } : null };
  }

  private async auditar(
    manager: EntityManager,
    userId: string,
    tenantId: string,
    profissional: { id: string; name: string },
    servico: { id: string; name: string },
    anterior: StoredRule | null,
    nova: StoredRule | null,
    now: Date,
  ) {
    const antes = anterior ? ruleToView(anterior) : null;
    const depois = nova ? ruleToView(nova) : null;
    await recordAudit(
      manager,
      {
        action: 'COMMISSION_RULE_CHANGED',
        actor: await loadActor(manager, userId),
        tenantId,
        summary: `Comissão de ${profissional.name} em ${servico.name}: ${descrever(antes)} → ${descrever(depois)}.`,
        previousData: { professionalId: profissional.id, serviceId: servico.id, rule: antes },
        newData: { professionalId: profissional.id, serviceId: servico.id, rule: depois },
      },
      now,
    );
  }

  private async lerRegras(manager: EntityManager, tenantId: string, professionalId: string): Promise<ProfessionalRulesView> {
    const [profissional] = linhasDe<{ id: string; name: string; active: boolean }>(
      await manager.query('SELECT id, name, active FROM professionals WHERE tenant_id = $1 AND id = $2', [
        tenantId,
        professionalId,
      ]),
    );
    if (!profissional) throw new NotFoundException(PROFESSIONAL_NOT_FOUND_MESSAGE);
    const linhas = linhasDe<{
      id: string;
      name: string;
      price_cents: number | null;
      active: boolean;
      linked: boolean;
      type: StoredRule['type'] | null;
      value: number | null;
      updated_at: Date | null;
    }>(
      await manager.query(
        `SELECT s.id, s.name, s.price_cents, s.active,
                EXISTS (SELECT 1 FROM professional_services ps WHERE ps.tenant_id = s.tenant_id
                  AND ps.professional_id = $2 AND ps.service_id = s.id) AS linked,
                cr.type::text AS type, cr.value, cr.updated_at
           FROM services s
           LEFT JOIN commission_rules cr ON cr.tenant_id = s.tenant_id AND cr.professional_id = $2 AND cr.service_id = s.id
          WHERE s.tenant_id = $1
            AND (cr.id IS NOT NULL OR EXISTS (SELECT 1 FROM professional_services ps WHERE ps.tenant_id = s.tenant_id
              AND ps.professional_id = $2 AND ps.service_id = s.id))
          ORDER BY s.name, s.id`,
        [tenantId, professionalId],
      ),
    );
    return {
      professional: profissional,
      services: linhas.map((l) => ({
        service: {
          id: l.id,
          name: l.name,
          priceCents: l.price_cents === null ? null : Number(l.price_cents),
          active: l.active,
        },
        linked: l.linked,
        rule: l.type === null ? null : ruleToView({ type: l.type, value: Number(l.value) }),
        updatedAt: l.updated_at ? new Date(l.updated_at).toISOString() : null,
      })),
    };
  }
}
