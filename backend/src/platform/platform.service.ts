import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { User } from '../entities/user.entity.js';
import {
  computeTrialWindow,
  TRIAL_DURATION_DAYS,
} from '../auth/trial-policy.js';
import {
  canViewEstablishments,
  platformCapabilities,
  requirePlatformAccess,
} from './platform-access.js';
import type { EstablishmentQuery } from './platform.dto.js';
import {
  ESTABLISHMENT_COLUMNS,
  ESTABLISHMENT_FROM,
  establishmentFilter,
} from './platform.queries.js';

export interface EstablishmentRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  timezone: string;
  status: string;
  createdAt: Date;
  plan: {
    id: string;
    code: string;
    name: string;
    catalogPriceCents: number | null;
    maxProfessionals: number;
    maxUnits: number;
  };
  owners: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    status: string;
  }[];
}

@Injectable()
export class PlatformService {
  constructor(private readonly dataSource: DataSource) {}

  async access(userId: string) {
    const user = await this.dataSource.manager.findOne(User, {
      where: { id: userId },
    });
    // `capabilities` diz à tela o que mostrar; o servidor confere de novo em
    // cada operação. O papel só aparece para quem tem acesso.
    const capabilities = platformCapabilities(user);
    return {
      canViewEstablishments: canViewEstablishments(user),
      capabilities,
      platformRole: capabilities.viewDirectory ? (user?.platformRole ?? null) : null,
    };
  }

  /** Autorização relida em TODA consulta. Nenhum papel/tenantId do navegador
   * decide o acesso global; nenhuma sessão de suporte é aberta aqui. */
  private read<T>(
    userId: string,
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      await requirePlatformAccess(manager, userId);
      return operation(manager);
    });
  }

  list(userId: string, query: EstablishmentQuery) {
    return this.read(userId, async (manager) => {
      const filter = establishmentFilter(query);
      const [count] = await manager.query<{ total: number }[]>(
        `SELECT count(*)::int AS total ${ESTABLISHMENT_FROM} ${filter.sql}`,
        filter.values,
      );
      const items = await manager.query<EstablishmentRow[]>(
        `SELECT ${ESTABLISHMENT_COLUMNS} ${ESTABLISHMENT_FROM} ${filter.sql}
         ORDER BY t.created_at DESC, t.id DESC LIMIT $${filter.values.length + 1} OFFSET $${filter.values.length + 2}`,
        [...filter.values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      // Contagens globais do banco, nunca somas da página atual.
      const [summary] = await manager.query<
        { total: number; active: number; trial: number; restricted: number }[]
      >(
        `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
         count(*) FILTER (WHERE status = 'TRIAL')::int AS trial,
         count(*) FILTER (WHERE status IN ('SUSPENDED', 'PAST_DUE', 'CANCELED'))::int AS restricted FROM tenants`,
      );
      const plans = await manager.query<{ id: string; name: string }[]>(
        'SELECT id, name FROM plans ORDER BY name, id',
      );
      return {
        items,
        total: count.total,
        page: query.page,
        pageSize: query.pageSize,
        summary,
        plans,
      };
    });
  }

  detail(userId: string, tenantId: string) {
    return this.read(userId, async (manager) => {
      const [establishment] = await manager.query<EstablishmentRow[]>(
        `SELECT ${ESTABLISHMENT_COLUMNS} ${ESTABLISHMENT_FROM} WHERE t.id = $1`,
        [tenantId],
      );
      if (!establishment)
        throw new NotFoundException('Estabelecimento não encontrado.');
      const units = await manager.query<
        { id: string; name: string; address: string; isPrimary: boolean }[]
      >(
        'SELECT id, name, address, is_primary AS "isPrimary" FROM units WHERE tenant_id = $1 ORDER BY is_primary DESC, name, id',
        [tenantId],
      );
      const [usage] = await manager.query<
        { professionals: number; services: number; consumers: number }[]
      >(
        `SELECT (SELECT count(*)::int FROM professionals WHERE tenant_id = $1 AND active = true) AS professionals,
         (SELECT count(*)::int FROM services WHERE tenant_id = $1 AND active = true) AS services,
         (SELECT count(*)::int FROM consumers WHERE tenant_id = $1) AS consumers`,
        [tenantId],
      );
      return {
        ...establishment,
        units,
        usage,
        trial: {
          ...computeTrialWindow(establishment.createdAt),
          durationDays: TRIAL_DURATION_DAYS,
        },
        billing: { available: false as const },
      };
    });
  }
}
