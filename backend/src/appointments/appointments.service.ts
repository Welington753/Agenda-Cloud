// Criação e consulta de agendamentos reais (Lote 6D.5).
//
// ESCOPO: um profissional e um serviço por agendamento. Sem cancelamento,
// remarcação, mudança manual de status, pagamento ou rota pública — nada
// disso existe neste lote.
//
// O QUE O SERVIDOR DECIDE (nunca o navegador): tenant, unidade, duração,
// fim, buffer, preço, snapshots e estado inicial. O DTO nem tem esses campos
// (ver appointment.dto.ts) — o cliente manda escolhas e um instante.
//
// ---------------------------------------------------------------------------
// OCUPAÇÃO PERSISTIDA E BUFFER
//
// `end_at` grava `início + duração + buffer`: é a janela que o profissional
// fica REALMENTE indisponível. `appointment_items.duration_minutes_snapshot`
// guarda só a duração do atendimento, então a tela mostra a janela do
// serviço a partir do snapshot, e a agenda respeita a janela cheia.
//
// É isto que faz o GET de disponibilidade e o POST concordarem: o motor lê
// `[start_at, end_at)` como ocupado (ver availability.service.ts,
// `conflitosDoDia`) e a constraint `appointments_no_overlap_excl` usa
// exatamente o mesmo intervalo. O buffer fica CONGELADO na janela no momento
// da reserva — mudar `services.buffer_after_minutes` depois não reescreve
// ocupação histórica nenhuma.
//
// ---------------------------------------------------------------------------
// CONCORRÊNCIA
//
// A disponibilidade é revalidada DENTRO da transação que grava, com a mesma
// função da consulta (`AvailabilityService.calcular`, com `travar: true`) —
// nunca "consultar livre, depois inserir" com a validação fora da transação.
//
// Dois níveis, porque cada um cobre uma corrida diferente:
//
//  1. `FOR SHARE` em serviço, profissional e vínculo: impede que uma
//     desativação ou uma remoção de vínculo commite entre a validação e o
//     INSERT. Também serializa contra a troca de jornada, que pega
//     `FOR UPDATE` na linha do profissional (working-hours.service.ts).
//  2. `appointments_no_overlap_excl`: dois `FOR SHARE` não conflitam entre
//     si, então duas reservas simultâneas para o mesmo horário passam as
//     duas pela validação. Quem decide é a constraint — uma commita, a outra
//     recebe `23P01` e vira 409. Essa é a garantia real de exclusividade,
//     não a validação em si.
//
// DIVERGÊNCIA CONHECIDA (pré-existente, documentada na migration): a
// constraint só ignora `CANCELED`, enquanto o motor de disponibilidade
// também trata `NO_SHOW` como horário livre. Um horário liberado por um
// `NO_SHOW` pode então ser oferecido pelo GET e recusado no INSERT com 409.
// Corrigir isso exige decisão de negócio e migration — não é feito aqui, e o
// 409 resultante é honesto em vez de silencioso.
//
// IDEMPOTÊNCIA: o schema não tem chave de idempotência (nem coluna, nem
// tabela). Nenhuma é inventada aqui, e memória de processo não seria
// garantia nenhuma. Consequência assumida: se a resposta do POST se perder
// na rede, o cliente não sabe se gravou — quem chama precisa CONFERIR a
// lista antes de tentar de novo, nunca reenviar automaticamente.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In, LessThan, MoreThan } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { AvailabilityService } from '../availability/availability.service.js';
import { STATUS_QUE_OCUPAM } from '../availability/availability.service.js';
import {
  dataLocalDe,
  horaLocalDe,
  janelaDeCarregamento,
  type DataLocal,
} from '../availability/time-zone.js';
import { isExclusionViolation } from '../common/exclusion-violation.js';
import { resolveAuthorizedTenant } from '../common/tenant-authorization.js';
import { ConsumersService } from '../consumers/consumers.service.js';
import { Appointment } from '../entities/appointment.entity.js';
import { AppointmentItem } from '../entities/appointment-item.entity.js';
import { AppointmentStatus } from '../entities/enums/appointment-status.enum.js';
import { Professional } from '../entities/professional.entity.js';
import { Service } from '../entities/service.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { Unit } from '../entities/unit.entity.js';
import {
  APPOINTMENT_CREATE_FORBIDDEN_MESSAGE,
  APPOINTMENTS_FORBIDDEN_MESSAGE,
  canCreateAppointments,
  canViewAppointments,
} from './appointment-access.js';
import type { CreateAppointmentDto, ListAppointmentsDto } from './appointment.dto.js';

/** Nome exato da constraint do banco (ver 1788782400000-InitialSchema.ts).
 * Só ela vira 409 — qualquer outro erro sobe como está. */
export const OVERLAP_CONSTRAINT = 'appointments_no_overlap_excl';

/** Teto duro da listagem de um dia. Existe para a rota nunca virar um dump
 * da agenda — um dia real de um estabelecimento não chega perto disto. */
export const LIMITE_DO_DIA = 200;

const CONSUMER_NOT_FOUND_MESSAGE = 'Cliente não encontrado.';
const APPOINTMENT_NOT_FOUND_MESSAGE = 'Agendamento não encontrado.';
const SLOT_TAKEN_MESSAGE =
  'Este horário acabou de ser ocupado. Consulte os horários disponíveis novamente.';
const SLOT_NOT_OFFERED_MESSAGE =
  'Este horário não está disponível para o serviço escolhido. Consulte os horários disponíveis e escolha um deles.';
const MISSING_UNIT_MESSAGE =
  'Este estabelecimento não tem unidade cadastrada — cadastre uma antes de agendar.';

export interface AppointmentView {
  id: string;
  /** Início do atendimento (instante inequívoco, ISO 8601 em UTC). */
  startAt: string;
  /** Fim do ATENDIMENTO, derivado do snapshot de duração — é o que a pessoa
   * entende como "termina às". */
  serviceEndAt: string;
  /** Fim da OCUPAÇÃO (atendimento + buffer congelado). É este intervalo que
   * bloqueia a agenda e a constraint do banco. */
  occupancyEndAt: string;
  localStart: string;
  localServiceEnd: string;
  timezone: string;
  status: AppointmentStatus;
  durationMinutes: number;
  /** `null` = serviço sem preço definido ("sob consulta"). NUNCA zero: zero
   * seria "de graça", que é outra coisa. */
  priceCents: number | null;
  notes: string | null;
  professional: { id: string; name: string };
  service: { id: string; name: string };
  /** Snapshot congelado no momento da reserva — nunca relido do cadastro
   * atual do cliente. */
  consumer: { id: string; name: string; whatsapp: string };
  unitId: string;
  createdAt: string;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly availability: AvailabilityService,
    private readonly consumers: ConsumersService,
  ) {}

  /**
   * Cria a reserva. Tudo numa transação só: cliente novo (quando houver),
   * agendamento e item. Uma falha em qualquer ponto desfaz os três — nunca
   * sobra agendamento sem item nem cliente órfão criado por uma tentativa
   * que não deu certo.
   */
  async create(
    userId: string,
    tenantId: string,
    dto: CreateAppointmentDto,
  ): Promise<AppointmentView> {
    const authorized = await resolveAuthorizedTenant(
      this.dataSource.manager,
      userId,
      tenantId,
      { permitido: canCreateAppointments, mensagemProibido: APPOINTMENT_CREATE_FORBIDDEN_MESSAGE },
    );

    const startAt = new Date(dto.startAt);

    try {
      const salvo = await this.dataSource.transaction(async (tx) => {
        const timezone = await this.timezoneDoTenant(tx, authorized.tenantId);

        // A data de calendário é derivada do instante NO FUSO DO
        // ESTABELECIMENTO — nunca do relógio do servidor nem de um campo de
        // data enviado pelo cliente (que poderia discordar do instante).
        const date = dataLocalDe(startAt, timezone);

        // Revalidação dentro da transação, com as MESMAS regras da consulta
        // e travando serviço, profissional e vínculo.
        const calculo = await this.availability.calcular(
          tx,
          authorized.tenantId,
          dto.professionalId,
          dto.serviceId,
          date,
          { travar: true },
        );

        const slot = calculo.resultado.slots.find(
          (candidato) => candidato.startAt.getTime() === startAt.getTime(),
        );
        if (!slot) {
          throw this.recusaDeHorario(startAt, calculo);
        }

        const consumer = await this.resolverCliente(tx, authorized.tenantId, dto);
        const unitId = await this.resolverUnidade(tx, authorized.tenantId, calculo.professional);

        const duracao = calculo.service.durationMinutes;
        const buffer = calculo.service.bufferAfterMinutes;

        const appointment = await tx.save(
          tx.create(Appointment, {
            tenantId: authorized.tenantId,
            unitId,
            consumerId: consumer.id,
            // Snapshots: histórico imutável do que era verdade agora.
            consumerNameSnapshot: consumer.name,
            consumerWhatsappSnapshot: consumer.whatsapp,
            professionalId: calculo.professional.id,
            startAt,
            endAt: new Date(startAt.getTime() + (duracao + buffer) * 60_000),
            // Estado inicial vem de uma coluna REAL do serviço, não de uma
            // regra inventada aqui.
            status: calculo.service.requiresManualConfirmation
              ? AppointmentStatus.PENDING
              : AppointmentStatus.CONFIRMED,
            notes: dto.notes,
          }),
        );

        await tx.save(
          tx.create(AppointmentItem, {
            tenantId: authorized.tenantId,
            appointmentId: appointment.id,
            serviceId: calculo.service.id,
            // `priceCents` nulo é "sob consulta" e continua nulo: zero seria
            // afirmar que o atendimento é gratuito.
            priceCentsSnapshot: calculo.service.priceCents ?? undefined,
            durationMinutesSnapshot: duracao,
            position: 0,
          }),
        );

        return appointment;
      });

      const [view] = await this.toViews(this.dataSource.manager, salvo.tenantId, [salvo]);
      return view;
    } catch (error) {
      // SÓ a constraint de sobreposição vira 409. Um erro de FK, de conexão
      // ou um deadlock nunca pode se disfarçar de "horário ocupado" — o
      // usuário tentaria resolver trocando de horário, para sempre.
      if (isExclusionViolation(error, OVERLAP_CONSTRAINT)) {
        throw new ConflictException(SLOT_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Por que o instante pedido não foi aceito.
   *
   * Sobrepor algo já ocupado é 409 (a agenda mudou); qualquer outro motivo é
   * 400 (o horário nunca foi válido: fora da jornada, fora da grade, no
   * passado, antes da antecedência mínima ou além do limite futuro). Os dois
   * exigem ações diferentes de quem chamou, então nunca viram a mesma
   * resposta.
   */
  private recusaDeHorario(
    startAt: Date,
    calculo: { ocupados: readonly { inicio: Date; fim: Date }[] },
  ): BadRequestException | ConflictException {
    const dentroDeOcupado = calculo.ocupados.some(
      (ocupado) => startAt >= ocupado.inicio && startAt < ocupado.fim,
    );
    return dentroDeOcupado
      ? new ConflictException(SLOT_TAKEN_MESSAGE)
      : new BadRequestException(SLOT_NOT_OFFERED_MESSAGE);
  }

  /** Cliente existente (sempre reconferido no tenant) ou cliente novo gravado
   * na MESMA transação da reserva. */
  private async resolverCliente(
    tx: EntityManager,
    tenantId: string,
    dto: CreateAppointmentDto,
  ): Promise<{ id: string; name: string; whatsapp: string }> {
    if (dto.consumer.mode === 'existing') {
      const consumer = await this.consumers.findScoped(tx, tenantId, dto.consumer.consumerId);
      // Id de cliente de outro estabelecimento é indistinguível de
      // inexistente — nunca confirma que o cadastro existe em outro lugar.
      if (!consumer) throw new NotFoundException(CONSUMER_NOT_FOUND_MESSAGE);
      return { id: consumer.id, name: consumer.name, whatsapp: consumer.whatsapp };
    }

    const criado = await this.consumers.createWith(tx, tenantId, dto.consumer.data);
    return { id: criado.id, name: criado.name, whatsapp: criado.whatsapp };
  }

  /**
   * `appointments.unit_id` é NOT NULL, mas `professionals.unit_id` é
   * opcional: usa a unidade do profissional quando ele tem uma, senão a
   * unidade primária do estabelecimento (criada no cadastro, ver
   * auth.service.ts). Sem nenhuma das duas, recusa explicitamente — nunca
   * inventa um id para satisfazer a coluna.
   */
  private async resolverUnidade(
    tx: EntityManager,
    tenantId: string,
    professional: Professional,
  ): Promise<string> {
    if (professional.unitId) return professional.unitId;

    const primaria = await tx.findOne(Unit, { where: { tenantId, isPrimary: true } });
    if (primaria) return primaria.id;

    const qualquer = await tx.findOne(Unit, { where: { tenantId }, order: { createdAt: 'ASC' } });
    if (!qualquer) throw new BadRequestException(MISSING_UNIT_MESSAGE);
    return qualquer.id;
  }

  /**
   * Agenda de UM dia, no fuso do estabelecimento.
   *
   * O dia é decidido pelo INÍCIO do atendimento: um agendamento que começa
   * 23:00 e termina depois da meia-noite pertence ao dia em que começou. É a
   * leitura que a pessoa espera de "agenda de hoje", e evita depender de
   * meia-noite existir no fuso (ela não existe em toda virada de horário de
   * verão).
   */
  async list(
    userId: string,
    tenantId: string,
    query: ListAppointmentsDto,
  ): Promise<{ timezone: string; date: string; appointments: AppointmentView[] }> {
    const manager = this.dataSource.manager;
    const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: canViewAppointments,
      mensagemProibido: APPOINTMENTS_FORBIDDEN_MESSAGE,
    });

    const timezone = await this.timezoneDoTenant(manager, authorized.tenantId);
    const [year, month, day] = query.date.split('-').map(Number);
    const data: DataLocal = { year, month, day };

    // Janela folgada no SQL (superconjunto do dia local, ver
    // `janelaDeCarregamento`) e recorte exato depois, comparando a data
    // local de cada início — trazer alguns registros a mais é inofensivo.
    const janela = janelaDeCarregamento(data);
    const encontrados = await manager.find(Appointment, {
      where: {
        tenantId: authorized.tenantId,
        ...(query.professionalId ? { professionalId: query.professionalId } : {}),
        startAt: LessThan(janela.fim),
        endAt: MoreThan(janela.inicio),
      },
      order: { startAt: 'ASC', id: 'ASC' },
      take: LIMITE_DO_DIA,
    });

    const doDia = encontrados.filter(
      (appointment) => dataLocalDe(appointment.startAt, timezone) === query.date,
    );

    return {
      timezone,
      date: query.date,
      appointments: await this.toViews(manager, authorized.tenantId, doDia),
    };
  }

  /** Detalhe de uma reserva — é o que permite conferir um agendamento pelo
   * id devolvido na criação. */
  async get(userId: string, tenantId: string, appointmentId: string): Promise<AppointmentView> {
    const manager = this.dataSource.manager;
    const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: canViewAppointments,
      mensagemProibido: APPOINTMENTS_FORBIDDEN_MESSAGE,
    });

    const appointment = await manager.findOne(Appointment, {
      where: { id: appointmentId, tenantId: authorized.tenantId },
    });
    if (!appointment) throw new NotFoundException(APPOINTMENT_NOT_FOUND_MESSAGE);

    const [view] = await this.toViews(manager, authorized.tenantId, [appointment]);
    return view;
  }

  private async timezoneDoTenant(manager: EntityManager, tenantId: string): Promise<string> {
    const tenant = await manager.findOne(Tenant, { where: { id: tenantId } });
    // Inalcançável na prática: a autorização já provou o tenant. Nunca
    // devolver um fuso "padrão" inventado no lugar do real.
    if (!tenant) throw new NotFoundException(APPOINTMENT_NOT_FOUND_MESSAGE);
    return tenant.timezone;
  }

  /**
   * Monta as views com os nomes atuais de profissional e serviço, e os
   * SNAPSHOTS do cliente, da duração e do preço. A distinção é proposital:
   * nome de profissional/serviço é rótulo de tela, enquanto duração, preço e
   * dados do cliente são o que valia no momento da reserva.
   *
   * Uma consulta por tabela (nunca uma por agendamento) — carregar item,
   * profissional e serviço dentro do laço viraria N+1 numa agenda cheia.
   */
  private async toViews(
    manager: EntityManager,
    tenantId: string,
    appointments: Appointment[],
  ): Promise<AppointmentView[]> {
    if (appointments.length === 0) return [];

    const timezone = await this.timezoneDoTenant(manager, tenantId);
    const ids = appointments.map((appointment) => appointment.id);

    const items = await manager.find(AppointmentItem, {
      where: { tenantId, appointmentId: In(ids) },
      order: { position: 'ASC' },
    });
    const itemPorAgendamento = new Map<string, AppointmentItem>();
    for (const item of items) {
      if (!itemPorAgendamento.has(item.appointmentId)) {
        itemPorAgendamento.set(item.appointmentId, item);
      }
    }

    const professionals = await manager.find(Professional, {
      where: { tenantId, id: In(appointments.map((a) => a.professionalId)) },
    });
    const nomeDoProfissional = new Map(professionals.map((p) => [p.id, p.name]));

    const serviceIds = [...new Set(items.map((item) => item.serviceId))];
    const services =
      serviceIds.length > 0
        ? await manager.find(Service, { where: { tenantId, id: In(serviceIds) } })
        : [];
    const nomeDoServico = new Map(services.map((s) => [s.id, s.name]));

    return appointments.map((appointment) => {
      const item = itemPorAgendamento.get(appointment.id);
      const duracao = item?.durationMinutesSnapshot ?? 0;
      const serviceEndAt = new Date(appointment.startAt.getTime() + duracao * 60_000);

      return {
        id: appointment.id,
        startAt: appointment.startAt.toISOString(),
        serviceEndAt: serviceEndAt.toISOString(),
        occupancyEndAt: appointment.endAt.toISOString(),
        localStart: horaLocalDe(appointment.startAt, timezone),
        localServiceEnd: horaLocalDe(serviceEndAt, timezone),
        timezone,
        status: appointment.status,
        durationMinutes: duracao,
        priceCents: item?.priceCentsSnapshot ?? null,
        notes: appointment.notes ?? null,
        professional: {
          id: appointment.professionalId,
          name: nomeDoProfissional.get(appointment.professionalId) ?? '',
        },
        service: {
          id: item?.serviceId ?? '',
          name: item ? (nomeDoServico.get(item.serviceId) ?? '') : '',
        },
        consumer: {
          id: appointment.consumerId,
          name: appointment.consumerNameSnapshot,
          whatsapp: appointment.consumerWhatsappSnapshot,
        },
        unitId: appointment.unitId,
        createdAt: appointment.createdAt.toISOString(),
      };
    });
  }
}

/** Reexportado para os testes conferirem que a listagem e o motor de
 * disponibilidade concordam sobre quais estados ocupam a agenda. */
export { STATUS_QUE_OCUPAM };
