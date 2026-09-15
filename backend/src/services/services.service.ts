// Gestão real de serviços por estabelecimento (Lote 6D.1).
//
// REGRA CENTRAL DE ISOLAMENTO: nenhuma consulta e nenhuma alteração aqui usa
// um id sozinho. Todo acesso a `Service` é feito por `{ id, tenantId }`, com o
// `tenantId` vindo SEMPRE de `resolveAuthorizedTenant` (que prova a Membership
// no servidor), nunca do corpo/query/path sem passar por essa prova. Um
// `serviceId` de outro estabelecimento simplesmente não é encontrado — nunca é
// encontrado e depois recusado, porque "encontrar" já confirmaria que existe.
//
// A preferência de tenant guardada no navegador (localStorage, ver
// `tenant-preference.ts` no frontend) NUNCA é autorização: ela só decide qual
// `tenantId` o cliente PEDE; quem decide se pode é a Membership consultada
// aqui a cada requisição.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { isTenantUsableForSession } from '../auth/tenant-access.js';
import { Membership } from '../entities/membership.entity.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import { Service } from '../entities/service.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { canManageServices, canViewServices } from './service-access.js';
import type { CreateServiceDto, UpdateServiceDto } from './service.dto.js';

/** Mensagem única para "não existe" e "você não tem vínculo com ele" — nunca
 * distinguir os dois revelaria a existência de estabelecimentos de terceiros. */
const TENANT_NOT_FOUND_MESSAGE = 'Estabelecimento não encontrado.';
const SERVICE_NOT_FOUND_MESSAGE = 'Serviço não encontrado.';
const FORBIDDEN_MESSAGE = 'Você não tem permissão para gerenciar os serviços deste estabelecimento.';

/** Vínculo já PROVADO no servidor: existe Membership deste usuário neste
 * tenant, e o tenant está utilizável. É a única origem aceitável de
 * `tenantId` para qualquer consulta de serviço. */
export interface AuthorizedTenant {
  tenantId: string;
  membershipId: string;
  role: EstablishmentRole;
}

/** Forma exposta na API — espelha as colunas reais de `services`, sem
 * inventar campo nenhum. `priceCents` continua em centavos inteiros (a
 * unidade da coluna); a conversão para exibição é do cliente. */
export interface ServiceView {
  id: string;
  name: string;
  shortDescription: string;
  priceCents: number | null;
  priceVisible: boolean;
  durationMinutes: number;
  bufferAfterMinutes: number;
  modality: string;
  activeInPublicBooking: boolean;
  requiresManualConfirmation: boolean;
  active: boolean;
  createdAt: Date;
}

function toServiceView(service: Service): ServiceView {
  return {
    id: service.id,
    name: service.name,
    shortDescription: service.shortDescription,
    priceCents: service.priceCents,
    priceVisible: service.priceVisible,
    durationMinutes: service.durationMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    modality: service.modality,
    activeInPublicBooking: service.activeInPublicBooking,
    requiresManualConfirmation: service.requiresManualConfirmation,
    active: service.active,
    createdAt: service.createdAt,
  };
}

@Injectable()
export class ServicesService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Prova, no servidor e a cada requisição, que este usuário pode operar
   * neste tenant. Nunca aceita o `tenantId` do cliente como autorização — o
   * cliente só PEDE um tenant; a Membership é que autoriza.
   *
   * `NotFoundException` (não 403) quando não há vínculo ou o tenant está
   * inativo: um 403 confirmaria que o estabelecimento existe.
   */
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

    // Tenant inativo (SUSPENDED/PAST_DUE/CANCELED) usa exatamente a mesma
    // regra do login e do /auth/me — ver auth/tenant-access.ts, nunca
    // reimplementada aqui.
    const tenant = await manager.findOne(Tenant, { where: { id: tenantId } });
    if (!tenant || !isTenantUsableForSession(tenant.status)) {
      throw new NotFoundException(TENANT_NOT_FOUND_MESSAGE);
    }

    const overrides = await manager.find(MembershipPermissionOverride, {
      where: { tenantId, membershipId: membership.id },
    });

    const permitted =
      operation === 'manage'
        ? canManageServices(membership.role, overrides)
        : canViewServices(membership.role, overrides);
    if (!permitted) {
      // Aqui o 403 é correto e não vaza nada: o vínculo já está provado, o
      // usuário sabe que o estabelecimento existe.
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    return { tenantId, membershipId: membership.id, role: membership.role };
  }

  /** Busca SEMPRE por `{ id, tenantId }` — nunca só pelo id. */
  private async findScopedService(
    manager: EntityManager,
    tenantId: string,
    serviceId: string,
  ): Promise<Service> {
    const service = await manager.findOne(Service, { where: { id: serviceId, tenantId } });
    if (!service) {
      throw new NotFoundException(SERVICE_NOT_FOUND_MESSAGE);
    }
    return service;
  }

  /** Lista os serviços do tenant autorizado, ativos e inativos — a UI precisa
   * dos dois para indicar o que está desativado. */
  async list(userId: string, tenantId: string): Promise<ServiceView[]> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'view');

    const services = await manager.find(Service, {
      where: { tenantId: authorized.tenantId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return services.map(toServiceView);
  }

  async create(userId: string, tenantId: string, dto: CreateServiceDto): Promise<ServiceView> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'manage');

    // `tenantId` vem do vínculo provado, NUNCA do dto (que nem tem esse
    // campo — ver service.dto.ts, `.strict()`).
    const service = manager.create(Service, {
      tenantId: authorized.tenantId,
      name: dto.name,
      shortDescription: dto.shortDescription,
      priceCents: dto.priceCents,
      priceVisible: dto.priceVisible,
      durationMinutes: dto.durationMinutes,
      bufferAfterMinutes: dto.bufferAfterMinutes,
      modality: dto.modality,
      activeInPublicBooking: dto.activeInPublicBooking,
      requiresManualConfirmation: dto.requiresManualConfirmation,
      active: true,
    });

    const saved = await manager.save(service);
    return toServiceView(saved);
  }

  async update(
    userId: string,
    tenantId: string,
    serviceId: string,
    dto: UpdateServiceDto,
  ): Promise<ServiceView> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'manage');
    const service = await this.findScopedService(manager, authorized.tenantId, serviceId);

    // Campo a campo, explicitamente — nunca `Object.assign(service, dto)`,
    // que deixaria uma chave inesperada do corpo alcançar a entidade se o
    // schema um dia parasse de ser `.strict()`. `tenantId`, `id`, `active` e
    // `createdAt` não aparecem aqui em hipótese nenhuma.
    if (dto.name !== undefined) service.name = dto.name;
    if (dto.shortDescription !== undefined) service.shortDescription = dto.shortDescription;
    // `null` é significativo (volta para "sob consulta"), então o teste é
    // contra `undefined`, nunca um `if (dto.priceCents)` que perderia o null e o 0.
    if (dto.priceCents !== undefined) service.priceCents = dto.priceCents;
    if (dto.priceVisible !== undefined) service.priceVisible = dto.priceVisible;
    if (dto.durationMinutes !== undefined) service.durationMinutes = dto.durationMinutes;
    if (dto.bufferAfterMinutes !== undefined) service.bufferAfterMinutes = dto.bufferAfterMinutes;
    if (dto.modality !== undefined) service.modality = dto.modality;
    if (dto.activeInPublicBooking !== undefined) {
      service.activeInPublicBooking = dto.activeInPublicBooking;
    }
    if (dto.requiresManualConfirmation !== undefined) {
      service.requiresManualConfirmation = dto.requiresManualConfirmation;
    }

    const saved = await manager.save(service);
    return toServiceView(saved);
  }

  /**
   * Desativação — NUNCA exclusão física. O registro continua inteiro para
   * preservar histórico e as FKs compostas que apontam para
   * `services (tenant_id, id)` (appointment_items, professional_services,
   * commission_rules, commission_entries). Usa a representação de
   * inatividade que já existe no modelo: a coluna `active`.
   *
   * Idempotente: desativar um serviço já inativo devolve o mesmo estado, sem
   * erro — o cliente nunca precisa saber a ordem em que as chamadas chegaram.
   */
  async deactivate(userId: string, tenantId: string, serviceId: string): Promise<ServiceView> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'manage');
    const service = await this.findScopedService(manager, authorized.tenantId, serviceId);

    if (!service.active) {
      return toServiceView(service);
    }

    service.active = false;
    const saved = await manager.save(service);
    return toServiceView(saved);
  }

  /**
   * Reativação — espelho exato de `deactivate`, nunca um caminho novo de
   * autorização. NÃO usa o PATCH genérico: `updateServiceSchema` exclui
   * `active` de propósito (ver service.dto.ts), porque misturar a mudança de
   * estado com a edição de campo abriria espaço para um PATCH silenciosamente
   * reativar um serviço junto de uma edição não relacionada. A ação fica
   * própria e explícita, como `deactivate`.
   *
   * Nunca cria registro novo nem toca em vínculo nenhum (profissionais,
   * comissões, agendamentos) — é a MESMA linha, só a coluna `active` muda de
   * volta. Idempotente: reativar um serviço já ativo devolve o mesmo estado,
   * sem erro.
   */
  async reactivate(userId: string, tenantId: string, serviceId: string): Promise<ServiceView> {
    const manager = this.dataSource.manager;
    const authorized = await this.resolveAuthorizedTenant(manager, userId, tenantId, 'manage');
    const service = await this.findScopedService(manager, authorized.tenantId, serviceId);

    if (service.active) {
      return toServiceView(service);
    }

    service.active = true;
    const saved = await manager.save(service);
    return toServiceView(saved);
  }
}
