// Consulta autenticada de disponibilidade (Lote 6D.4).
//
// ESCOPO: só LEITURA. Nada aqui cria, altera ou cancela agendamento, e a
// resposta é uma fotografia — consultar NÃO reserva. Entre esta consulta e
// uma gravação futura outro agendamento pode ocupar o mesmo horário; quem
// garante exclusividade é a constraint `appointments_no_overlap_excl` no
// momento da gravação, que não existe neste lote.
//
// SEPARAÇÃO: este arquivo só CARREGA os dados reais e traduz erro de domínio
// em erro HTTP. Toda a regra de cálculo está em `availability-rules.ts`
// (pura, com relógio injetado) e toda a conversão de fuso em `time-zone.ts`.
//
// ISOLAMENTO: o `tenantId` vem sempre de `resolveAuthorizedTenant`, nunca do
// caminho sem prova. Profissional, serviço, vínculo, jornada, agendamentos e
// bloqueios são TODOS buscados com `tenantId` no `where` — um id de outro
// estabelecimento simplesmente não é encontrado.
//
// PRIVACIDADE: os agendamentos entram no cálculo apenas como janelas
// `[start_at, end_at)`. Nome, contato, snapshot de consumidor e observações
// nunca são lidos para a resposta nem devolvidos.
//
// UNIDADE: `professionals.unit_id` é opcional e `professional_schedules` não
// tem unidade; a ocupação de uma pessoa vale em qualquer unidade em que ela
// atenda, então filtrar por unidade aqui esconderia conflito real. O fuso
// aplicado é `tenants.timezone`, o MESMO em que a jornada semanal foi
// definida no Lote 6D.3 — usar `units.timezone` reinterpretaria horas já
// gravadas.
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataSource, In, LessThan, MoreThan } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { resolveAuthorizedTenant } from '../common/tenant-authorization.js';
import { Appointment } from '../entities/appointment.entity.js';
import { AppointmentStatus } from '../entities/enums/appointment-status.enum.js';
import { BookingPolicy } from '../entities/booking-policy.entity.js';
import { Professional } from '../entities/professional.entity.js';
import { ProfessionalSchedule } from '../entities/professional-schedule.entity.js';
import { ProfessionalService } from '../entities/professional-service.entity.js';
import { Service } from '../entities/service.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { TimeBlock } from '../entities/time-block.entity.js';
import { paraIntervalos } from '../professionals/working-hours.js';
import { AVAILABILITY_FORBIDDEN_MESSAGE, canViewAvailability } from './availability-access.js';
import {
  calcularHorariosDisponiveis,
  diaDaSemanaDe,
  PASSO_PADRAO_MINUTOS,
  type JanelaOcupada,
  type MotivoSemHorario,
} from './availability-rules.js';
import type { AvailabilityQueryDto } from './availability.dto.js';
import { ErroDeFuso, janelaDeCarregamento, type DataLocal } from './time-zone.js';

const PROFESSIONAL_NOT_FOUND_MESSAGE = 'Profissional não encontrado.';
const SERVICE_NOT_FOUND_MESSAGE = 'Serviço não encontrado.';
const INACTIVE_PROFESSIONAL_MESSAGE = 'Este profissional está desativado.';
const INACTIVE_SERVICE_MESSAGE = 'Este serviço está desativado.';
const MISSING_LINK_MESSAGE = 'Este profissional não realiza o serviço selecionado.';
const INVALID_DURATION_MESSAGE =
  'O serviço não tem duração válida cadastrada — corrija a duração antes de consultar.';
const TENANT_TIMEZONE_MESSAGE =
  'O fuso horário do estabelecimento está inválido — corrija-o antes de consultar.';

/**
 * Estados que OCUPAM a agenda. `CANCELED` e `NO_SHOW` liberam — a mesma
 * regra que a constraint anti-sobreposição do banco aplica para `CANCELED`
 * (ver appointment.entity.ts e appointment-status.enum.ts).
 */
export const STATUS_QUE_OCUPAM: readonly AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
];

export interface HorarioDisponivelView {
  /** Instante inequívoco (ISO 8601 em UTC). */
  startAt: string;
  endAt: string;
  /** Hora de relógio no fuso do estabelecimento. */
  localStart: string;
  localEnd: string;
  /** Distingue dois horários com a MESMA hora local no dia em que o relógio
   * volta — sem isto a lista teria entradas indistinguíveis. */
  offsetMinutes: number;
  offsetLabel: string;
}

export interface AvailabilityView {
  professionalId: string;
  serviceId: string;
  /** Data de calendário consultada, no fuso abaixo. */
  date: string;
  timezone: string;
  durationMinutes: number;
  bufferAfterMinutes: number;
  slotStepMinutes: number;
  /** Regras comerciais efetivamente aplicadas. `null` quando o
   * estabelecimento não tem `booking_policies` gravada — e então nenhuma
   * antecedência ou limite futuro é inventado. */
  minLeadMinutes: number | null;
  maxFutureDays: number | null;
  slots: HorarioDisponivelView[];
  /** Preenchido SÓ quando `slots` está vazio, para a lista vazia legítima
   * nunca se confundir com falha. Erro de banco não chega aqui: sobe como
   * exceção e vira 5xx. */
  emptyReason: MotivoSemHorario | null;
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly dataSource: DataSource,
    /** Relógio injetável: nenhum teste depende da hora em que roda.
     * `@Optional()` é o que faz o Nest NÃO tentar resolver este parâmetro no
     * container — em produção ele fica com o padrão, o relógio real. */
    @Optional()
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async consult(
    userId: string,
    tenantId: string,
    professionalId: string,
    query: AvailabilityQueryDto,
  ): Promise<AvailabilityView> {
    const manager = this.dataSource.manager;

    const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: canViewAvailability,
      mensagemProibido: AVAILABILITY_FORBIDDEN_MESSAGE,
    });

    const professional = await manager.findOne(Professional, {
      where: { id: professionalId, tenantId: authorized.tenantId },
    });
    if (!professional) throw new NotFoundException(PROFESSIONAL_NOT_FOUND_MESSAGE);
    if (!professional.active) throw new BadRequestException(INACTIVE_PROFESSIONAL_MESSAGE);

    const service = await manager.findOne(Service, {
      where: { id: query.serviceId, tenantId: authorized.tenantId },
    });
    if (!service) throw new NotFoundException(SERVICE_NOT_FOUND_MESSAGE);
    if (!service.active) throw new BadRequestException(INACTIVE_SERVICE_MESSAGE);

    // O vínculo é elegibilidade: sem ele, o profissional não realiza o
    // serviço e não há horário nenhum a oferecer.
    const vinculo = await manager.findOne(ProfessionalService, {
      where: {
        tenantId: authorized.tenantId,
        professionalId: professional.id,
        serviceId: service.id,
      },
    });
    if (!vinculo) throw new BadRequestException(MISSING_LINK_MESSAGE);

    // A coluna é NOT NULL, mas nada no banco impede `0` ou negativo: uma
    // duração assim geraria horários infinitos ou sem sentido, então é
    // recusada explicitamente em vez de virar lista vazia silenciosa.
    if (!Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) {
      throw new BadRequestException(INVALID_DURATION_MESSAGE);
    }

    const timezone = await this.timezoneDoTenant(manager, authorized.tenantId);
    const data = this.dataPedida(query.date);

    const intervalos = await this.jornadaDoDia(
      manager,
      authorized.tenantId,
      professional.id,
      diaDaSemanaDe(data),
    );

    const policy = await manager.findOne(BookingPolicy, {
      where: { tenantId: authorized.tenantId },
    });

    const ocupados = await this.conflitosDoDia(
      manager,
      authorized.tenantId,
      professional.id,
      data,
    );

    const agora = this.agora();
    let resultado;
    try {
      resultado = calcularHorariosDisponiveis({
        data,
        timeZone: timezone,
        intervalos,
        duracaoMinutos: service.durationMinutes,
        bufferMinutos: service.bufferAfterMinutes,
        passoMinutos: PASSO_PADRAO_MINUTOS,
        ocupados,
        agora,
        antecedenciaMinimaMinutos: policy?.minLeadMinutes ?? 0,
        limiteDiasFuturos: policy?.maxFutureDays ?? null,
      });
    } catch (erro) {
      if (erro instanceof ErroDeFuso) throw new BadRequestException(TENANT_TIMEZONE_MESSAGE);
      throw erro;
    }

    return {
      professionalId: professional.id,
      serviceId: service.id,
      date: query.date,
      timezone,
      durationMinutes: service.durationMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
      slotStepMinutes: PASSO_PADRAO_MINUTOS,
      minLeadMinutes: policy?.minLeadMinutes ?? null,
      maxFutureDays: policy?.maxFutureDays ?? null,
      slots: resultado.slots.map((slot) => ({
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
        localStart: slot.localStart,
        localEnd: slot.localEnd,
        offsetMinutes: slot.offsetMinutes,
        offsetLabel: slot.offsetLabel,
      })),
      emptyReason: resultado.motivo,
    };
  }

  /** `"YYYY-MM-DD"` já validado pelo DTO vira data de calendário — sem hora e
   * sem fuso, porque o fuso é decidido no servidor. */
  private dataPedida(valor: string): DataLocal {
    const [year, month, day] = valor.split('-').map(Number);
    return { year, month, day };
  }

  private async timezoneDoTenant(manager: EntityManager, tenantId: string): Promise<string> {
    const tenant = await manager.findOne(Tenant, { where: { id: tenantId } });
    if (!tenant) {
      // Inalcançável na prática: a autorização já provou o tenant. Nunca
      // devolver um fuso "padrão" inventado no lugar do real.
      throw new NotFoundException(PROFESSIONAL_NOT_FOUND_MESSAGE);
    }
    return tenant.timezone;
  }

  /**
   * Jornada do dia da semana pedido. Linha ausente OU `active = false` é dia
   * SEM atendimento — nunca "disponível sem restrição". As colunas viram
   * intervalos com a MESMA função do Lote 6D.3, para as duas telas jamais
   * discordarem sobre o que está gravado.
   */
  private async jornadaDoDia(
    manager: EntityManager,
    tenantId: string,
    professionalId: string,
    weekday: number,
  ) {
    const linha = await manager.findOne(ProfessionalSchedule, {
      where: { tenantId, professionalId, weekday },
    });
    if (!linha || !linha.active) return [];
    return paraIntervalos(linha);
  }

  /**
   * Agendamentos e bloqueios que SOBREPÕEM a janela do dia consultado.
   *
   * O filtro é por sobreposição (`start_at < fim da janela` E `end_at > início
   * da janela`), nunca por "data de início igual ao dia": um atendimento que
   * começou ontem à noite e termina hoje de manhã ocupa hoje, e filtrar pelo
   * dia de início o deixaria de fora.
   *
   * A janela é um superconjunto folgado do dia local (ver
   * `janelaDeCarregamento`): trazer alguns registros a mais é inofensivo,
   * trazer de menos ofereceria horário ocupado. O recorte exato é feito pela
   * comparação instante a instante no cálculo.
   */
  private async conflitosDoDia(
    manager: EntityManager,
    tenantId: string,
    professionalId: string,
    data: DataLocal,
  ): Promise<JanelaOcupada[]> {
    const janela = janelaDeCarregamento(data);

    const agendamentos = await manager.find(Appointment, {
      where: {
        tenantId,
        professionalId,
        status: In([...STATUS_QUE_OCUPAM]),
        startAt: LessThan(janela.fim),
        endAt: MoreThan(janela.inicio),
      },
      // Só as colunas de tempo: nada de consumidor, snapshot ou observação.
      select: { id: true, startAt: true, endAt: true },
    });

    const bloqueios = await manager.find(TimeBlock, {
      where: {
        tenantId,
        professionalId,
        startAt: LessThan(janela.fim),
        endAt: MoreThan(janela.inicio),
      },
      select: { id: true, startAt: true, endAt: true },
    });

    return [
      ...agendamentos.map((a) => ({
        inicio: a.startAt,
        fim: a.endAt,
        origem: 'agendamento' as const,
      })),
      ...bloqueios.map((b) => ({
        inicio: b.startAt,
        fim: b.endAt,
        origem: 'bloqueio' as const,
      })),
    ];
  }
}
