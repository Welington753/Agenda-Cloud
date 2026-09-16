// Horários semanais de trabalho do profissional (Lote 6D.3).
//
// ESCOPO: só a configuração recorrente. Nada aqui gera horário disponível,
// cria/reagenda reserva, nem toca em `appointments`, `time_blocks` ou
// exceções — gravar a semana mexe exclusivamente em `professional_schedules`.
//
// ISOLAMENTO: mesma regra dos outros serviços do módulo. O `tenantId` vem
// sempre de `resolveAuthorizedProfessionalsTenant`, nunca do path/corpo sem
// prova, e o profissional é buscado por `{ id, tenantId }` — um id de outro
// estabelecimento simplesmente não é encontrado.
//
// FUSO: `"HH:MM"` é hora local recorrente do estabelecimento. O fuso
// aplicável é lido de `tenants.timezone` (coluna real, populada no cadastro)
// e devolvido junto da semana para a tela poder exibi-lo. Nada é convertido
// aqui: converter exigiria uma data concreta, que uma regra semanal não tem.
// `professional_schedules` não tem `unitId` e `units` não tem horário de
// funcionamento no schema, então não existe herança/interseção com unidade
// para aplicar — e inventar uma seria regra de negócio nova.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Professional } from '../entities/professional.entity.js';
import { ProfessionalSchedule } from '../entities/professional-schedule.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { resolveAuthorizedProfessionalsTenant } from './professional-tenant-access.js';
import type { ReplaceWorkingHoursDto } from './working-hours.dto.js';
import {
  ErroDeHorario,
  normalizarSemana,
  paraColunas,
  paraIntervalos,
  type DiaDeTrabalho,
} from './working-hours.js';

const PROFESSIONAL_NOT_FOUND_MESSAGE = 'Profissional não encontrado.';
const TENANT_NOT_FOUND_MESSAGE = 'Estabelecimento não encontrado.';

/** Semana como a API expõe. `days` traz SÓ os dias com atendimento; dia
 * ausente é dia sem atendimento — nunca "disponível sem restrição". */
export interface WorkingHoursView {
  /** Fuso do estabelecimento (`tenants.timezone`), para a tela dizer a que
   * fuso os horários se referem. */
  timezone: string;
  days: DiaDeTrabalho[];
}

@Injectable()
export class ProfessionalWorkingHoursService {
  constructor(private readonly dataSource: DataSource) {}

  /** Busca SEMPRE por `{ id, tenantId }`. `lock` só é usado na gravação, onde
   * a transação precisa serializar duas edições do mesmo profissional. */
  private async findScopedProfessional(
    manager: EntityManager,
    tenantId: string,
    professionalId: string,
    travar: boolean,
  ): Promise<Professional> {
    const professional = await manager.findOne(Professional, {
      where: { id: professionalId, tenantId },
      ...(travar ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!professional) {
      throw new NotFoundException(PROFESSIONAL_NOT_FOUND_MESSAGE);
    }
    return professional;
  }

  private async timezoneDoTenant(manager: EntityManager, tenantId: string): Promise<string> {
    const tenant = await manager.findOne(Tenant, { where: { id: tenantId } });
    if (!tenant) {
      // Inalcançável na prática: a autorização já provou o tenant. Nunca
      // devolver um fuso "padrão" inventado no lugar do real.
      throw new NotFoundException(TENANT_NOT_FOUND_MESSAGE);
    }
    return tenant.timezone;
  }

  /**
   * Lê a semana configurada. As linhas são devolvidas como estão no banco
   * (ver `paraIntervalos`): uma linha gravada por outro caminho não é
   * corrigida nem escondida aqui — quem recusa dado fora da regra é a
   * gravação, que nomeia o dia. Assim nada some em silêncio.
   *
   * Linha com `active = false` conta como dia SEM atendimento, igual à
   * ausência de linha.
   */
  async get(userId: string, tenantId: string, professionalId: string): Promise<WorkingHoursView> {
    const manager = this.dataSource.manager;
    const authorized = await resolveAuthorizedProfessionalsTenant(manager, userId, tenantId, 'view');
    const professional = await this.findScopedProfessional(
      manager,
      authorized.tenantId,
      professionalId,
      false,
    );

    const linhas = await manager.find(ProfessionalSchedule, {
      where: { tenantId: authorized.tenantId, professionalId: professional.id },
      order: { weekday: 'ASC' },
    });

    const days = linhas
      .filter((linha) => linha.active)
      .map((linha) => ({ weekday: linha.weekday, intervals: paraIntervalos(linha) }))
      .sort((a, b) => a.weekday - b.weekday);

    return { timezone: await this.timezoneDoTenant(manager, authorized.tenantId), days };
  }

  /**
   * Substitui a SEMANA INTEIRA.
   *
   * O contrato é substituição total, nunca alteração parcial: o corpo
   * descreve todos os dias com atendimento, e todo dia que não estiver lá é
   * apagado. É isso que garante que duas gravações simultâneas do mesmo
   * profissional nunca se misturem — cada uma grava uma semana completa e
   * coerente.
   *
   * CONCORRÊNCIA (e o que ela NÃO faz): a transação começa travando a linha
   * do profissional (`FOR UPDATE`, via `pessimistic_write`), então duas
   * requisições para o mesmo profissional são serializadas — a segunda só
   * começa a apagar/inserir depois que a primeira commitou, e o resultado
   * final é sempre uma das duas semanas inteiras, jamais um recorte de cada.
   * É "última gravação vence": NÃO há detecção de formulário desatualizado
   * (a tabela não tem coluna de versão e este lote não inventa uma), então
   * quem salvou por último sobrescreve o outro sem aviso.
   *
   * Ordem de aquisição: esta transação trava `professionals` e só depois
   * escreve em `professional_schedules`; nenhum outro caminho do módulo trava
   * na ordem inversa (a gestão de vínculos trava `services` e nunca espera
   * por `professionals`), então não há ciclo possível. Qualquer erro dentro
   * da transação — inclusive de validação — desfaz tudo: nunca fica meia
   * semana gravada.
   */
  async replace(
    userId: string,
    tenantId: string,
    professionalId: string,
    dto: ReplaceWorkingHoursDto,
  ): Promise<WorkingHoursView> {
    const manager = this.dataSource.manager;
    const authorized = await resolveAuthorizedProfessionalsTenant(
      manager,
      userId,
      tenantId,
      'manage',
    );

    // Validação pura primeiro: não custa conexão nem lock, e o pedido
    // inválido é recusado sem nunca abrir transação.
    const semana = this.normalizarOuRecusar(dto.days);

    await this.dataSource.transaction(async (tx) => {
      const professional = await this.findScopedProfessional(
        tx,
        authorized.tenantId,
        professionalId,
        true,
      );

      // Substituição total: o que não veio no corpo deixa de existir.
      await tx.delete(ProfessionalSchedule, {
        tenantId: authorized.tenantId,
        professionalId: professional.id,
      });

      if (semana.length > 0) {
        await tx.save(
          semana.map((dia) =>
            tx.create(ProfessionalSchedule, {
              tenantId: authorized.tenantId,
              professionalId: professional.id,
              weekday: dia.weekday,
              active: true,
              ...paraColunas(dia.intervals),
            }),
          ),
        );
      }
    });

    return this.get(userId, tenantId, professionalId);
  }

  /** Traduz a regra de domínio (pura) para o erro HTTP do projeto, sem deixar
   * a camada de regra conhecer Nest. */
  private normalizarOuRecusar(days: ReplaceWorkingHoursDto['days']): DiaDeTrabalho[] {
    try {
      return normalizarSemana(days);
    } catch (erro) {
      if (erro instanceof ErroDeHorario) {
        throw new BadRequestException(erro.message);
      }
      throw erro;
    }
  }
}
