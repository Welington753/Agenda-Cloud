// Clientes reais do estabelecimento (Lote 6D.5) — só o mínimo para o
// primeiro agendamento existir: buscar e cadastrar.
//
// CLIENTE NÃO É USUÁRIO. `consumers` não tem senha, credencial, sessão nem
// Membership (ver consumer.entity.ts) — cadastrar um cliente aqui nunca cria
// login, nunca manda convite e nunca dá acesso ao sistema a ninguém. O
// schema não exige nada disso, então nada disso é feito.
//
// ISOLAMENTO E ENUMERAÇÃO: toda consulta leva `tenantId` no `where`. A busca
// exige um termo de no mínimo 2 caracteres e devolve no máximo
// `LIMITE_DE_BUSCA` linhas — nunca "liste todos". Existe em `consumers` um
// índice cross-tenant (`idx_consumers_whatsapp_normalized`, para uso de
// Master responder "este telefone existe em qual tenant?"); ele NUNCA é
// usado por estas rotas. A identidade global (o mesmo telefone pode ser
// cliente de vários estabelecimentos) fica separada do vínculo local: daqui
// não sai nenhuma informação sobre o cliente existir em outro tenant.
import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, ILike } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { normalizePhone } from '../auth/phone-normalizer.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { resolveAuthorizedTenant } from '../common/tenant-authorization.js';
import { Consumer } from '../entities/consumer.entity.js';
import {
  canManageConsumers,
  canViewConsumers,
  CONSUMERS_FORBIDDEN_MESSAGE,
} from './consumer-access.js';
import type { CreateConsumerDto } from './consumer.dto.js';

/** Teto duro da busca. Existe para a rota nunca virar um dump da base de
 * clientes — quem procura alguém específico acha nas primeiras linhas. */
export const LIMITE_DE_BUSCA = 20;

const WHATSAPP_EM_USO_MESSAGE =
  'Já existe um cliente com este WhatsApp neste estabelecimento. Busque por ele em vez de cadastrar de novo.';

export interface ConsumerView {
  id: string;
  name: string;
  whatsapp: string;
  email: string | null;
}

function toView(consumer: Consumer): ConsumerView {
  return {
    id: consumer.id,
    name: consumer.name,
    whatsapp: consumer.whatsapp,
    email: consumer.email ?? null,
  };
}

@Injectable()
export class ConsumersService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Busca por nome OU telefone, sempre dentro do tenant provado.
   *
   * O termo é comparado também contra o telefone NORMALIZADO, para quem
   * digita "(11) 90000-0000" achar quem foi salvo como "+5511900000000".
   * Só dígitos são aproveitados nessa segunda comparação — um termo sem
   * dígito nenhum nunca vira uma busca de telefone vazia (que casaria com
   * todo mundo).
   */
  async search(userId: string, tenantId: string, termo: string): Promise<ConsumerView[]> {
    const manager = this.dataSource.manager;
    const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: canViewConsumers,
      mensagemProibido: CONSUMERS_FORBIDDEN_MESSAGE,
    });

    const digitos = termo.replace(/\D/g, '');
    const where: Record<string, unknown>[] = [
      { tenantId: authorized.tenantId, name: ILike(`%${termo}%`) },
    ];
    if (digitos.length >= 4) {
      where.push({ tenantId: authorized.tenantId, whatsappNormalized: ILike(`%${digitos}%`) });
    }

    const encontrados = await manager.find(Consumer, {
      where,
      order: { name: 'ASC', id: 'ASC' },
      take: LIMITE_DE_BUSCA,
    });
    return encontrados.map(toView);
  }

  async create(userId: string, tenantId: string, dto: CreateConsumerDto): Promise<ConsumerView> {
    const manager = this.dataSource.manager;
    const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: canManageConsumers,
      mensagemProibido: CONSUMERS_FORBIDDEN_MESSAGE,
    });

    return this.createWith(manager, authorized.tenantId, dto);
  }

  /**
   * Gravação em si, com `manager` recebido de fora — é o que permite o
   * agendamento criar cliente e reserva na MESMA transação (ver
   * appointments.service.ts). Sem isso, uma falha ao gravar o agendamento
   * deixaria para trás um cliente órfão criado só por uma tentativa que não
   * deu certo.
   *
   * A autorização NÃO é refeita aqui: quem chama já provou o tenant. O
   * parâmetro é `tenantId` já autorizado, nunca o do caminho da requisição.
   */
  async createWith(
    manager: EntityManager,
    tenantId: string,
    dto: CreateConsumerDto,
  ): Promise<ConsumerView> {
    const whatsappNormalized = normalizePhone(dto.whatsapp);

    try {
      const salvo = await manager.save(
        manager.create(Consumer, {
          tenantId,
          name: dto.name,
          whatsapp: dto.whatsapp,
          whatsappNormalized,
          email: dto.email,
        }),
      );
      return toView(salvo);
    } catch (error) {
      // `uq_consumers_tenant_whatsapp` é o que impede dois cadastros do mesmo
      // telefone no mesmo estabelecimento. Só ESSA constraint vira 409 —
      // qualquer outro erro sobe como está.
      if (isUniqueViolation(error, 'uq_consumers_tenant_whatsapp')) {
        throw new ConflictException(WHATSAPP_EM_USO_MESSAGE);
      }
      throw error;
    }
  }

  /** Cliente deste tenant, para o agendamento provar elegibilidade dentro da
   * própria transação. `null` quando não existe NESTE tenant — de propósito
   * indistinguível de "não existe em lugar nenhum". */
  async findScoped(
    manager: EntityManager,
    tenantId: string,
    consumerId: string,
  ): Promise<Consumer | null> {
    return manager.findOne(Consumer, { where: { id: consumerId, tenantId } });
  }
}
