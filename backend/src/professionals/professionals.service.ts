// Gestão real de profissionais por estabelecimento (Lote 6D.2) — espelha a
// estrutura de services/services.service.ts.
//
// REGRA CENTRAL DE ISOLAMENTO: nenhuma consulta e nenhuma alteração aqui usa
// um id sozinho. Todo acesso a `Professional`/`Service` é feito por
// `{ id, tenantId }`, com o `tenantId` vindo SEMPRE de
// `resolveAuthorizedTenant` (que prova a Membership no servidor), nunca do
// corpo/query/path sem passar por essa prova. Um `professionalId` ou
// `serviceId` de outro estabelecimento simplesmente não é encontrado.
//
// Profissional NUNCA é confundido com usuário autenticado: nada aqui cria
// conta, senha, convite ou Membership. O vínculo opcional
// `Membership.professionalId` (ligar um login a uma agenda) é de outro fluxo
// e nunca é tocado por este serviço.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { isTenantUsableForSession } from '../auth/tenant-access.js';
import { Membership } from '../entities/membership.entity.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import { Professional } from '../entities/professional.entity.js';
import { ProfessionalService } from '../entities/professional-service.entity.js';
import { Service } from '../entities/service.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { deriveAvatar } from './avatar.js';
import { canManageProfessionals, canViewProfessionals } from './professional-access.js';
import type {
  CreateProfessionalDto,
  SetProfessionalServicesDto,
  UpdateProfessionalDto,
} from './professional.dto.js';

const TENANT_NOT_FOUND_MESSAGE = 'Estabelecimento não encontrado.';
const PROFESSIONAL_NOT_FOUND_MESSAGE = 'Profissional não encontrado.';
const FORBIDDEN_MESSAGE =
  'Você não tem permissão para gerenciar os profissionais deste estabelecimento.';
const INVALID_SERVICES_MESSAGE =
  'Um ou mais serviços informados não existem, estão inativos ou pertencem a outro estabelecimento.';
const DUPLICATE_SERVICE_MESSAGE = 'Este serviço já está vinculado ao profissional.';

/** Vínculo já PROVADO no servidor: existe Membership deste usuário neste
 * tenant, e o tenant está utilizável. Única origem aceitável de `tenantId`. */
export interface AuthorizedTenant {
  tenantId: string;
  membershipId: string;
  role: EstablishmentRole;
}

/** Serviço vinculado, na forma exposta pela API — inclui se o SERVIÇO em si
 * está ativo, para a UI marcar vínculos com serviço desativado sem escondê-los. */
export interface ProfessionalServiceLinkView {
  id: string;
  serviceId: string;
  serviceName: string;
  serviceActive: boolean;
}

export interface ProfessionalView {
  id: string;
  name: string;
  avatarInitials: string;
  avatarColor: string;
  active: boolean;
  createdAt: Date;
  services: ProfessionalServiceLinkView[];
}

@Injectable()
export class ProfessionalsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Prova, no servidor e a cada requisição, que este usuário pode operar
   * neste tenant — espelho de ServicesService.resolveAuthorizedTenant.
   * `NotFoundException` (não 403) quando não há vínculo ou o tenant está
   * inativo: um 403 confirmaria que o estabelecimento existe. */
  private async resolveAuthorizedTenant(
    manager: EntityManager,
    userId: string,
    tenantId: string,
    operation: 'view' | 'manage',
  ): Promise<AuthorizedTenant> {
    const membership = await manager.findOne(Membership, { where: { userId, tenantId } });
    if (!membership) {
      throw new NotFoundException(TENANT_NOT_FOUND_MESSAGE);
    }

    const tenant = await manager.findOne(Tenant, { where: { id: tenantId } });
    if (!tenant || !isTenantUsableForSession(tenant.status)) {
      throw new NotFoundException(TENANT_NOT_FOUND_MESSAGE);
    }

    const overrides = await manager.find(MembershipPermissionOverride, {
      where: { tenantId, membershipId: membership.id },
    });

    const permitted =
      operation === 'manage'
        ? canManageProfessionals(membership.role, overrides)
        : canViewProfessionals(membership.role, overrides);
    if (!permitted) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    return { tenantId, membershipId: membership.id, role: membership.role };
  }

  /** Busca SEMPRE por `{ id, tenantId }` — nunca só pelo id. */
  private async findScopedProfessional(
    manager: EntityManager,
    tenantId: string,
    professionalId: string,
  ): Promise<Professional> {
    const professional = await manager.findOne(Professional, {
      where: { id: professionalId, tenantId },
    });
    if (!professional) {
      throw new NotFoundException(PROFESSIONAL_NOT_FOUND_MESSAGE);
    }
    return professional;
  }

  /** Monta a view de um conjunto de profissionais + seus vínculos de
   * serviço, numa única leitura de cada tabela (nunca N+1). */
  private async toViews(
    manager: EntityManager,
    tenantId: string,
    professionals: Professional[],
  ): Promise<ProfessionalView[]> {
    if (professionals.length === 0) return [];

    const professionalIds = professionals.map((p) => p.id);
    const links = await manager.find(ProfessionalService, {
      where: { tenantId, professionalId: In(professionalIds) },
    });

    const serviceIds = [...new Set(links.map((link) => link.serviceId))];
    const services =
      serviceIds.length > 0
        ? await manager.find(Service, { where: { tenantId, id: In(serviceIds) } })
        : [];
    const serviceById = new Map(services.map((service) => [service.id, service]));

    const linksByProfessional = new Map<string, ProfessionalService[]>();
    for (const link of links) {
      const lista = linksByProfessional.get(link.professionalId) ?? [];
      lista.push(link);
      linksByProfessional.set(link.professionalId, lista);
    }

    return professionals.map((professional) => ({
      id: professional.id,
      name: professional.name,
      avatarInitials: professional.avatarInitials,
      avatarColor: professional.avatarColor,
      active: professional.active,
      createdAt: professional.createdAt,
      services: (linksByProfessional.get(professional.id) ?? []).map((link) => {
        const service = serviceById.get(link.serviceId);
        return {
          id: link.id,
          serviceId: link.serviceId,
          serviceName: service?.name ?? '',
          serviceActive: service?.active ?? false,
        };
      }),
    }));
  }

  /** Valida que todos os ids pedidos existem, pertencem ao tenant e estão
   * ATIVOS — usada só para vínculos NOVOS (ver cabeçalho de `setServices`).
   * Tudo ou nada: um id inexistente/inativo/de outro tenant rejeita o pedido
   * inteiro, sem gravar nada. */
  private async validateEligibleServiceIds(
    manager: EntityManager,
    tenantId: string,
    serviceIds: readonly string[],
  ): Promise<void> {
    if (serviceIds.length === 0) return;

    const encontrados = await manager.find(Service, {
      where: { tenantId, id: In(serviceIds), active: true },
    });
    if (encontrados.length !== serviceIds.length) {
      throw new BadRequestException(INVALID_SERVICES_MESSAGE);
    }
  }

  async list(userId: string, tenantId: string): Promise<ProfessionalView[]> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'view');

    const professionals = await manager.find(Professional, {
      where: { tenantId: authorized.tenantId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return this.toViews(manager, authorized.tenantId, professionals);
  }

  /** Criação — transacional quando há serviços iniciais: o profissional e
   * seus vínculos nascem juntos, ou nenhum dos dois nasce. */
  async create(
    userId: string,
    tenantId: string,
    dto: CreateProfessionalDto,
  ): Promise<ProfessionalView> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'manage');

    const serviceIds = [...new Set(dto.serviceIds)];
    await this.validateEligibleServiceIds(manager, authorized.tenantId, serviceIds);

    const { avatarInitials, avatarColor } = deriveAvatar(dto.name);

    const saved = await this.dataSource.transaction(async (tx) => {
      const professional = await tx.save(
        tx.create(Professional, {
          tenantId: authorized.tenantId,
          name: dto.name,
          avatarInitials,
          avatarColor,
          active: true,
        }),
      );

      if (serviceIds.length > 0) {
        await tx.save(
          serviceIds.map((serviceId) =>
            tx.create(ProfessionalService, {
              tenantId: authorized.tenantId,
              professionalId: professional.id,
              serviceId,
            }),
          ),
        );
      }

      return professional;
    });

    const [view] = await this.toViews(manager, authorized.tenantId, [saved]);
    return view;
  }

  async update(
    userId: string,
    tenantId: string,
    professionalId: string,
    dto: UpdateProfessionalDto,
  ): Promise<ProfessionalView> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'manage');
    const professional = await this.findScopedProfessional(
      manager,
      authorized.tenantId,
      professionalId,
    );

    if (dto.name !== undefined) {
      professional.name = dto.name;
      // Recalculado junto com o nome — nunca fica preso às iniciais/cor do
      // nome antigo (ver avatar.ts).
      const { avatarInitials, avatarColor } = deriveAvatar(dto.name);
      professional.avatarInitials = avatarInitials;
      professional.avatarColor = avatarColor;
    }

    const saved = await manager.save(professional);
    const [view] = await this.toViews(manager, authorized.tenantId, [saved]);
    return view;
  }

  /** Desativação — NUNCA exclusão física, NUNCA cascade sobre os vínculos de
   * serviço. O registro e todos os `professional_services` continuam
   * intactos; só a coluna `active` do profissional muda. Idempotente. */
  async deactivate(
    userId: string,
    tenantId: string,
    professionalId: string,
  ): Promise<ProfessionalView> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'manage');
    const professional = await this.findScopedProfessional(
      manager,
      authorized.tenantId,
      professionalId,
    );

    if (professional.active) {
      professional.active = false;
      await manager.save(professional);
    }

    const [view] = await this.toViews(manager, authorized.tenantId, [professional]);
    return view;
  }

  /** Reativação — espelho exato de `deactivate`. Nunca recria vínculo nenhum:
   * os `professional_services` nunca foram tocados pela desativação, então
   * não há nada para "devolver" aqui além da coluna `active`. Idempotente. */
  async reactivate(
    userId: string,
    tenantId: string,
    professionalId: string,
  ): Promise<ProfessionalView> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'manage');
    const professional = await this.findScopedProfessional(
      manager,
      authorized.tenantId,
      professionalId,
    );

    if (!professional.active) {
      professional.active = true;
      await manager.save(professional);
    }

    const [view] = await this.toViews(manager, authorized.tenantId, [professional]);
    return view;
  }

  /**
   * Define o conjunto final de serviços vinculados ao profissional.
   *
   * O servidor calcula o diff contra o que já existe:
   *  - vínculos que já existem e continuam no conjunto pedido: preservados
   *    sem qualquer nova validação (um serviço vinculado que foi desativado
   *    DEPOIS continua elegível para permanecer vinculado — só não pode ser
   *    escolhido como vínculo NOVO, ver `validateEligibleServiceIds`);
   *  - vínculos que já existem e saíram do conjunto pedido: removidos;
   *  - ids do conjunto pedido que ainda não existem como vínculo: são
   *    vínculos NOVOS, e precisam ser de um serviço ativo do mesmo tenant —
   *    tudo ou nada, um id inválido rejeita o pedido inteiro sem gravar nada.
   *
   * Tudo em uma transação: remoções e inclusões acontecem juntas ou nenhuma
   * acontece. A constraint única do banco
   * (`uq_professional_services_tenant_professional_service`) é a proteção
   * final contra duplicata em corrida concorrente — nunca só a checagem
   * feita aqui antes de gravar.
   */
  async setServices(
    userId: string,
    tenantId: string,
    professionalId: string,
    dto: SetProfessionalServicesDto,
  ): Promise<ProfessionalView> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'manage');
    const professional = await this.findScopedProfessional(
      manager,
      authorized.tenantId,
      professionalId,
    );

    const desired = [...new Set(dto.serviceIds)];
    const existentes = await manager.find(ProfessionalService, {
      where: { tenantId: authorized.tenantId, professionalId: professional.id },
    });
    const existentesPorServico = new Map(existentes.map((link) => [link.serviceId, link]));

    const paraAdicionar = desired.filter((serviceId) => !existentesPorServico.has(serviceId));
    const paraRemover = existentes.filter((link) => !desired.includes(link.serviceId));

    await this.validateEligibleServiceIds(manager, authorized.tenantId, paraAdicionar);

    try {
      await this.dataSource.transaction(async (tx) => {
        if (paraRemover.length > 0) {
          await tx.remove(paraRemover);
        }
        if (paraAdicionar.length > 0) {
          await tx.save(
            paraAdicionar.map((serviceId) =>
              tx.create(ProfessionalService, {
                tenantId: authorized.tenantId,
                professionalId: professional.id,
                serviceId,
              }),
            ),
          );
        }
      });
    } catch (error) {
      // Backstop contra corrida concorrente (duas requisições vinculando o
      // mesmo serviço ao mesmo tempo): a checagem acima já evita o caso
      // comum, mas é a constraint única do banco que garante de verdade.
      if (isUniqueViolation(error)) {
        throw new ConflictException(DUPLICATE_SERVICE_MESSAGE);
      }
      throw error;
    }

    const [view] = await this.toViews(manager, authorized.tenantId, [professional]);
    return view;
  }
}

/** Código `23505` do Postgres = unique_violation. TypeORM propaga o driver
 * error original dentro de `QueryFailedError`. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: string }).code === '23505';
}
