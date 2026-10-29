// Agendamento público real (Lote A): a página do estabelecimento pelo slug,
// os horários livres e o PEDIDO, que nasce sempre `PENDING`.
//
// O QUE O PÚBLICO VÊ: nome do estabelecimento, fuso, serviços ativos no
// online (nome, descrição curta, duração e preço só quando visível) e
// profissionais ativos no online (nome e iniciais). Nunca: clientes,
// contatos, reservas, ocupação com nomes, observações, ids de unidade ou
// qualquer dado de membro da equipe.
//
// QUANDO A PÁGINA EXISTE: slug de um estabelecimento utilizável (mesma regra
// da sessão) que LIGOU o agendamento online. Qualquer outro caso é o MESMO
// 404 genérico — não dá para distinguir "não existe" de "não habilitou" ou
// "suspenso".
//
// O PEDIDO, numa transação só:
//  1. relê a configuração `FOR SHARE` (desligar a página no mesmo instante
//     serializa com o pedido);
//  2. trava o telefone (advisory lock): pedidos do mesmo número no mesmo
//     estabelecimento passam um de cada vez;
//  3. mesma chave de envio já gravada → devolve o MESMO pedido (resposta
//     perdida, clique duplo). Chave igual com dados diferentes → 409;
//  4. limites por telefone: 3 pedidos por 24 h e 2 pendentes futuros;
//  5. cliente pelo telefone, sem alterar cadastro existente;
//  6. reserva `PENDING` revalidada com o motor real (AppointmentsService);
//  7. linha em `public_booking_requests`;
//  8. evento "solicitação nova" em `booking_request_alerts` (Web Push).
//     Só DEPOIS do commit o executor tenta enviar (push-dispatcher.ts):
//     rollback = sem evento, e falha no push nunca desfaz nem transforma em
//     erro um pedido já gravado.
// A constraint de sobreposição continua sendo a proteção final: dois
// pedidos para o mesmo horário passam pela validação ao mesmo tempo, um
// commita e o outro recebe 409.
//
// A resposta é IGUAL para cliente novo e já cadastrado: nada nela depende do
// cadastro existir.
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import type { EntityManager } from 'typeorm';
import {
  AppointmentsService,
  OVERLAP_CONSTRAINT,
  PUBLIC_UNAVAILABLE_MESSAGE,
  type AppointmentView,
} from '../appointments/appointments.service.js';
import { normalizePhone } from '../auth/phone-normalizer.js';
import { isTenantUsableForSession } from '../auth/tenant-access.js';
import { featureEnabled, tenantAccessSituation } from '../commercial/commercial-gate.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { AvailabilityService } from '../availability/availability.service.js';
import type { MotivoSemHorario } from '../availability/availability-rules.js';
import { dataLocalDe, horaLocalDe } from '../availability/time-zone.js';
import { isExclusionViolation } from '../common/exclusion-violation.js';
import { resolveAuthorizedTenant } from '../common/tenant-authorization.js';
import { Appointment } from '../entities/appointment.entity.js';
import { AppointmentItem } from '../entities/appointment-item.entity.js';
import { AppointmentStatus } from '../entities/enums/appointment-status.enum.js';
import { Professional } from '../entities/professional.entity.js';
import { ProfessionalService } from '../entities/professional-service.entity.js';
import { Service } from '../entities/service.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { Unit } from '../entities/unit.entity.js';
import { registrarAlerta } from '../push/booking-alerts.repository.js';
import { DisparadorDePush } from '../push/push-dispatcher.js';
import {
  canManagePublicBooking,
  PUBLIC_BOOKING_FORBIDDEN_MESSAGE,
} from './public-booking-access.js';
import type {
  PublicAvailabilityQueryDto,
  PublicBookingRequestDto,
} from './public-booking.dto.js';
import {
  clienteDoTelefone,
  configuracaoDo,
  gravarConfiguracao,
  origemPublica,
  pedidoPelaChave,
  pedidosRecentes,
  pendentesFuturos,
  registrarPedido,
  travarProfissional,
  travarTelefone,
} from './public-booking.repository.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';

export const PUBLIC_NOT_FOUND_MESSAGE = 'Página de agendamento não encontrada.';
export const SLOT_TAKEN_PUBLIC_MESSAGE =
  'Este horário acabou de ser ocupado. Escolha outro horário disponível.';
export const KEY_REUSED_MESSAGE =
  'Este envio já foi registrado com outros dados. Recarregue a página para fazer um novo pedido.';
export const DAILY_LIMIT_MESSAGE =
  'Este WhatsApp já fez muitos pedidos hoje neste estabelecimento. Tente novamente amanhã ou fale direto com o estabelecimento.';
export const PENDING_LIMIT_MESSAGE =
  'Este WhatsApp já tem pedidos aguardando confirmação neste estabelecimento. Aguarde a resposta antes de pedir outro horário.';

/** Pedidos por telefone, por estabelecimento, em 24 h (qualquer estado). */
export const LIMITE_DIARIO_POR_TELEFONE = 3;
/** Pedidos `PENDING` com início futuro, por telefone e estabelecimento. */
export const LIMITE_PENDENTES_POR_TELEFONE = 2;

export interface PublicProfileView {
  establishment: { name: string; slug: string; timezone: string };
  services: {
    id: string;
    name: string;
    description: string;
    durationMinutes: number;
    /** `null` quando o preço não é exibido OU é "sob consulta". */
    priceCents: number | null;
    priceVisible: boolean;
  }[];
  professionals: { id: string; name: string; initials: string; serviceIds: string[] }[];
}

export interface PublicAvailabilityView {
  date: string;
  timezone: string;
  slots: { startAt: string; localStart: string; offsetLabel: string }[];
  emptyReason: MotivoSemHorario | null;
}

/** Recibo do pedido. Sem id de reserva, de cliente ou de unidade. */
export interface PublicReceiptView {
  status: AppointmentStatus;
  startAt: string;
  localDate: string;
  localStart: string;
  timezone: string;
  serviceName: string;
  professionalName: string;
  establishmentName: string;
  /** `true` quando este envio repetiu uma chave já gravada: é o MESMO
   * pedido, nada novo foi criado. */
  replayed: boolean;
}

export type PendingRequestView = AppointmentView & {
  origin: 'PUBLIC' | 'INTERNAL';
  requestedAt: string | null;
};

const RESERVA_NAO_ENCONTRADA = 'Pedido não encontrado.';

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly availability: AvailabilityService,
    private readonly appointments: AppointmentsService,
    @Optional()
    private readonly agora: () => Date = () => new Date(),
    @Optional()
    private readonly disparador?: DisparadorDePush,
  ) {}

  // ------------------------------------------------------------- público

  async profile(slug: string): Promise<PublicProfileView> {
    const manager = this.dataSource.manager;
    const tenant = await this.tenantPublico(manager, slug);

    const services = await manager.find(Service, {
      where: { tenantId: tenant.id, active: true, activeInPublicBooking: true },
      order: { name: 'ASC', id: 'ASC' },
    });
    const professionals = await manager.find(Professional, {
      where: { tenantId: tenant.id, active: true, onlineBookingActive: true },
      order: { name: 'ASC', id: 'ASC' },
    });
    const links =
      services.length > 0 && professionals.length > 0
        ? await manager.find(ProfessionalService, {
            where: {
              tenantId: tenant.id,
              serviceId: In(services.map((s) => s.id)),
              professionalId: In(professionals.map((p) => p.id)),
            },
          })
        : [];

    const servicosComProfissional = new Set(links.map((l) => l.serviceId));
    return {
      establishment: {
        name: await this.nomeDo(manager, tenant),
        slug: tenant.slug,
        timezone: tenant.timezone,
      },
      services: services
        .filter((s) => servicosComProfissional.has(s.id))
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.shortDescription,
          durationMinutes: s.durationMinutes,
          priceCents: s.priceVisible ? s.priceCents : null,
          priceVisible: s.priceVisible,
        })),
      professionals: professionals
        .map((p) => ({
          id: p.id,
          name: p.name,
          initials: p.avatarInitials,
          serviceIds: links.filter((l) => l.professionalId === p.id).map((l) => l.serviceId),
        }))
        .filter((p) => p.serviceIds.length > 0),
    };
  }

  async availabilityFor(
    slug: string,
    query: PublicAvailabilityQueryDto,
  ): Promise<PublicAvailabilityView> {
    const manager = this.dataSource.manager;
    const tenant = await this.tenantPublico(manager, slug);

    const calculo = await this.calcularPublico(manager, tenant.id, query);
    return {
      date: query.date,
      timezone: calculo.timezone,
      // Só o instante e a hora local: nada da ocupação que produziu a lista.
      slots: calculo.resultado.slots.map((slot) => ({
        startAt: slot.startAt.toISOString(),
        localStart: slot.localStart,
        offsetLabel: slot.offsetLabel,
      })),
      emptyReason: calculo.resultado.motivo,
    };
  }

  async request(slug: string, dto: PublicBookingRequestDto): Promise<PublicReceiptView> {
    const recibo = await this.gravarPedido(slug, dto);
    // Depois do commit. Nunca lança: o pedido já está gravado.
    try {
      if (recibo.replayed) this.disparador?.aproveitarTrafego();
      else this.disparador?.depoisDoPedido();
    } catch {
      // O evento está no banco; a retomada envia depois.
    }
    return recibo;
  }

  private async gravarPedido(slug: string, dto: PublicBookingRequestDto): Promise<PublicReceiptView> {
    const agora = this.agora();
    const telefone = normalizePhone(dto.whatsapp);
    const startAt = new Date(dto.startAt);
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify([dto.serviceId, dto.professionalId, startAt.toISOString(), dto.name, telefone]),
      )
      .digest('hex');

    try {
      return await this.dataSource.transaction(async (tx) => {
        const tenant = await this.tenantPublico(tx, slug, true);
        await travarTelefone(tx, tenant.id, telefone);

        const repetido = await pedidoPelaChave(tx, tenant.id, dto.idempotencyKey);
        if (repetido) {
          if (repetido.payloadHash !== payloadHash) throw new ConflictException(KEY_REUSED_MESSAGE);
          return this.recibo(tx, tenant, repetido.appointmentId, true);
        }

        const umDiaAtras = new Date(agora.getTime() - 24 * 60 * 60_000);
        if ((await pedidosRecentes(tx, tenant.id, telefone, umDiaAtras)) >= LIMITE_DIARIO_POR_TELEFONE) {
          throw new HttpException(
            { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: DAILY_LIMIT_MESSAGE },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        if ((await pendentesFuturos(tx, tenant.id, telefone, agora)) >= LIMITE_PENDENTES_POR_TELEFONE) {
          throw new HttpException(
            { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: PENDING_LIMIT_MESSAGE },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        await travarProfissional(tx, tenant.id, dto.professionalId);

        const consumerId = await clienteDoTelefone(tx, tenant.id, {
          nome: dto.name,
          whatsapp: dto.whatsapp,
          telefone,
        });

        const criado = await this.appointments.criarPedidoPublico(tx, {
          tenantId: tenant.id,
          professionalId: dto.professionalId,
          serviceId: dto.serviceId,
          startAt,
          consumerId,
          nomeInformado: dto.name,
          whatsappInformado: dto.whatsapp,
        });

        await registrarPedido(tx, {
          tenantId: tenant.id,
          appointmentId: criado.appointment.id,
          telefone,
          chave: dto.idempotencyKey,
          payloadHash,
          agora,
        });

        await registrarAlerta(tx, { tenantId: tenant.id, appointmentId: criado.appointment.id, inicio: startAt }, agora);

        return {
          status: criado.appointment.status,
          startAt: startAt.toISOString(),
          localDate: dataLocalDe(startAt, criado.timezone),
          localStart: horaLocalDe(startAt, criado.timezone),
          timezone: criado.timezone,
          serviceName: criado.serviceName,
          professionalName: criado.professionalName,
          establishmentName: await this.nomeDo(tx, tenant),
          replayed: false,
        };
      });
    } catch (error) {
      // Só a constraint de sobreposição vira "horário ocupado"; só a chave
      // de envio repetida (corrida entre telefones diferentes com a mesma
      // chave) vira o 409 de chave. Qualquer outro erro sobe como está.
      if (isExclusionViolation(error, OVERLAP_CONSTRAINT)) {
        throw new ConflictException(SLOT_TAKEN_PUBLIC_MESSAGE);
      }
      if (isUniqueViolation(error, 'uq_public_booking_requests_tenant_key')) {
        throw new ConflictException(KEY_REUSED_MESSAGE);
      }
      throw error;
    }
  }

  // ------------------------------------------------------------- privado

  async settings(userId: string, tenantId: string) {
    const manager = this.dataSource.manager;
    const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: canManagePublicBooking,
      mensagemProibido: PUBLIC_BOOKING_FORBIDDEN_MESSAGE,
      recurso: FeatureKey.AGENDAMENTO_PUBLICO,
    });
    const config = await configuracaoDo(manager, authorized.tenantId);
    return this.settingsView(manager, authorized.tenantId, config);
  }

  async updateSettings(userId: string, tenantId: string, enabled: boolean) {
    const manager = this.dataSource.manager;
    const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: canManagePublicBooking,
      mensagemProibido: PUBLIC_BOOKING_FORBIDDEN_MESSAGE,
      recurso: FeatureKey.AGENDAMENTO_PUBLICO,
    });
    const config = await gravarConfiguracao(manager, authorized.tenantId, enabled, userId);
    return this.settingsView(manager, authorized.tenantId, config);
  }

  /** Solicitações pendentes (futuras), com a origem de cada uma. A
   * autorização é a da agenda, feita por `listPending`. */
  async pendingRequests(
    userId: string,
    tenantId: string,
  ): Promise<{ requests: PendingRequestView[]; complete: boolean }> {
    const { appointments, complete } = await this.appointments.listPending(userId, tenantId);
    // Carona: a área real consultando a lista retoma avisos pendentes.
    this.disparador?.aproveitarTrafego();
    const origem = await origemPublica(
      this.dataSource.manager,
      tenantId,
      appointments.map((a) => a.id),
    );
    return {
      requests: appointments.map((a) => {
        const pedidoEm = origem.get(a.id);
        return {
          ...a,
          origin: pedidoEm ? 'PUBLIC' : 'INTERNAL',
          requestedAt: pedidoEm ? pedidoEm.toISOString() : null,
        };
      }),
      complete,
    };
  }

  // ------------------------------------------------------------- apoio

  private async settingsView(
    manager: EntityManager,
    tenantId: string,
    config: { enabled: boolean; updatedAt: Date | null },
  ) {
    const tenant = await manager.findOneOrFail(Tenant, { where: { id: tenantId } });
    return {
      enabled: config.enabled,
      slug: tenant.slug,
      updatedAt: config.updatedAt ? config.updatedAt.toISOString() : null,
    };
  }

  /** Tenant pelo slug, utilizável e com o online LIGADO — senão o mesmo
   * 404 para todos os casos. */
  private async tenantPublico(manager: EntityManager, slug: string, travar = false): Promise<Tenant> {
    const tenant = await manager.findOne(Tenant, { where: { slug } });
    if (!tenant || !isTenantUsableForSession(tenant.status)) {
      throw new NotFoundException(PUBLIC_NOT_FOUND_MESSAGE);
    }
    // Acesso vencido ou agendamento público fora do plano: a mesma resposta
    // de indisponível. As reservas já feitas continuam valendo.
    const situacao = await tenantAccessSituation(manager, tenant.id, new Date());
    if (situacao.blocked || !(await featureEnabled(manager, tenant.id, FeatureKey.AGENDAMENTO_PUBLICO))) {
      throw new NotFoundException(PUBLIC_NOT_FOUND_MESSAGE);
    }
    const config = await configuracaoDo(manager, tenant.id, travar);
    if (!config.enabled) throw new NotFoundException(PUBLIC_NOT_FOUND_MESSAGE);
    return tenant;
  }

  private async calcularPublico(
    manager: EntityManager,
    tenantId: string,
    query: PublicAvailabilityQueryDto,
  ) {
    const [service, professional] = await Promise.all([
      manager.findOne(Service, { where: { id: query.serviceId, tenantId } }),
      manager.findOne(Professional, { where: { id: query.professionalId, tenantId } }),
    ]);
    if (!service?.activeInPublicBooking || !professional?.onlineBookingActive) {
      throw new BadRequestException(PUBLIC_UNAVAILABLE_MESSAGE);
    }
    try {
      return await this.availability.calcular(
        manager,
        tenantId,
        query.professionalId,
        query.serviceId,
        query.date,
      );
    } catch (erro) {
      if (erro instanceof NotFoundException || erro instanceof BadRequestException) {
        throw new BadRequestException(PUBLIC_UNAVAILABLE_MESSAGE);
      }
      throw erro;
    }
  }

  private async nomeDo(manager: EntityManager, tenant: Tenant): Promise<string> {
    const unit =
      (await manager.findOne(Unit, { where: { tenantId: tenant.id, isPrimary: true } })) ??
      (await manager.findOne(Unit, { where: { tenantId: tenant.id }, order: { createdAt: 'ASC' } }));
    return unit?.name ?? tenant.slug;
  }

  private async recibo(
    manager: EntityManager,
    tenant: Tenant,
    appointmentId: string,
    replayed: boolean,
  ): Promise<PublicReceiptView> {
    const appointment = await manager.findOne(Appointment, {
      where: { id: appointmentId, tenantId: tenant.id },
    });
    const item = await manager.findOne(AppointmentItem, {
      where: { tenantId: tenant.id, appointmentId },
      order: { position: 'ASC' },
    });
    if (!appointment || !item) throw new NotFoundException(RESERVA_NAO_ENCONTRADA);
    const [service, professional] = await Promise.all([
      manager.findOne(Service, { where: { id: item.serviceId, tenantId: tenant.id } }),
      manager.findOne(Professional, { where: { id: appointment.professionalId, tenantId: tenant.id } }),
    ]);
    return {
      status: appointment.status,
      startAt: appointment.startAt.toISOString(),
      localDate: dataLocalDe(appointment.startAt, tenant.timezone),
      localStart: horaLocalDe(appointment.startAt, tenant.timezone),
      timezone: tenant.timezone,
      serviceName: service?.name ?? '',
      professionalName: professional?.name ?? '',
      establishmentName: await this.nomeDo(manager, tenant),
      replayed,
    };
  }
}

