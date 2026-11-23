// Clientes reais do estabelecimento (Lote 6D.5): buscar, listar, cadastrar
// e editar. Ficha, histórico e lista agrupada: consumer-profile.service.ts.
//
// IDENTIDADE: `consumers.id`. Telefone e nome são critérios de
// correspondência; trocar o telefone não muda o id nem o histórico. Cadastro
// unificado (lápide, `merged_into_consumer_id`) não aparece na busca nem na
// lista e não recebe agendamento (ver docs/plans/clientes-ficha-e-duplicados.md).
//
// CLIENTE NÃO É USUÁRIO. `consumers` não tem senha, credencial, sessão nem
// Membership (ver consumer.entity.ts) — cadastrar um cliente aqui nunca cria
// login, nunca manda convite e nunca dá acesso ao sistema a ninguém. O
// schema não exige nada disso, então nada disso é feito.
//
// ISOLAMENTO E ENUMERAÇÃO: toda consulta leva `tenantId` no `where`. A busca
// exige um termo de no mínimo 2 caracteres e devolve no máximo
// `LIMITE_DE_BUSCA` linhas. A listagem da tela de Clientes (`listPage`) é
// paginada no servidor: no máximo `MAIOR_PAGINA_DE_CLIENTES` por vez, sempre
// do tenant provado. Existe em `consumers` um
// índice cross-tenant (`idx_consumers_whatsapp_normalized`, para uso de
// Master responder "este telefone existe em qual tenant?"); ele NUNCA é
// usado por estas rotas. A identidade global (o mesmo telefone pode ser
// cliente de vários estabelecimentos) fica separada do vínculo local: daqui
// não sai nenhuma informação sobre o cliente existir em outro tenant.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
import type { ConsumerPageDto, CreateConsumerDto, UpdateConsumerDto } from './consumer.dto.js';
import {
  chaveReutilizada,
  clienteAlterado,
  clienteUnificado,
  impressaoDoPedido,
  telefoneEmUso,
  travarTelefoneDoCliente,
} from './consumer-rules.js';
import { loadActor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { linhasDe } from '../common/linhas-de.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';

/** Teto duro da busca. Existe para a rota nunca virar um dump da base de
 * clientes — quem procura alguém específico acha nas primeiras linhas. */
export const LIMITE_DE_BUSCA = 20;

/** `%`, `_` e a barra digitados viram texto, não curinga do LIKE. */
export function escaparLike(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface PosicaoNaLista {
  nome: string;
  id: string;
}

function escreverCursor(posicao: PosicaoNaLista): string {
  return Buffer.from(JSON.stringify([posicao.nome, posicao.id]), 'utf8').toString('base64url');
}

/** Cursor inválido é recusado (400), nunca tratado como "do começo". */
export function lerCursor(cursor: string): PosicaoNaLista {
  try {
    const valor: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(valor) &&
      valor.length === 2 &&
      typeof valor[0] === 'string' &&
      typeof valor[1] === 'string' &&
      valor[1].length > 0 &&
      valor[1].length <= 30
    ) {
      return { nome: valor[0], id: valor[1] };
    }
  } catch {
    // cai na recusa abaixo
  }
  throw new BadRequestException('Página inválida. Recarregue a lista de clientes.');
}

export const CONSUMER_NOT_FOUND_MESSAGE = 'Cliente não encontrado.';

export interface ConsumerView {
  id: string;
  name: string;
  whatsapp: string;
  email: string | null;
}

/** Resultado do cadastro pela tela. `repeated`: a chave de pedido já
 * tinha criado este cadastro (reenvio). `principal`: quando o cadastro
 * original virou lápide depois, o cadastro ativo que ficou com o histórico. */
export interface CreateConsumerResult {
  consumer: ConsumerView;
  repeated: boolean;
  principal?: ConsumerView;
}

/** O que a edição devolve (a ficha relê o resto). */
export interface UpdatedConsumerView extends ConsumerView {
  updatedAt: string;
}

interface LinhaDoCliente {
  id: string;
  name: string;
  whatsapp: string;
  whatsapp_normalized: string;
  email: string | null;
  updated_at: Date;
  merged_into_consumer_id: string | null;
}

function viewDaLinha(linha: Pick<LinhaDoCliente, 'id' | 'name' | 'whatsapp' | 'email'>): ConsumerView {
  return { id: linha.id, name: linha.name, whatsapp: linha.whatsapp, email: linha.email ?? null };
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
      recurso: FeatureKey.CONSUMIDORES,
    });

    const parametros: unknown[] = [authorized.tenantId, `%${escaparLike(termo)}%`];
    const condicoes = [`name ILIKE $2 ESCAPE '\\'`];
    const digitos = termo.replace(/\D/g, '');
    if (digitos.length >= 4) {
      parametros.push(`%${digitos}%`);
      condicoes.push(`whatsapp_normalized LIKE $3`);
    }
    parametros.push(LIMITE_DE_BUSCA);
    const linhas = linhasDe<LinhaDoCliente>(
      await manager.query(
        `SELECT id, name, whatsapp, email FROM consumers
          WHERE tenant_id = $1 AND merged_into_consumer_id IS NULL AND (${condicoes.join(' OR ')})
          ORDER BY name, id
          LIMIT $${parametros.length}`,
        parametros,
      ),
    );
    return linhas.map(viewDaLinha);
  }

  /**
   * Listagem paginada da tela de Clientes: a primeira página aparece ao
   * abrir, e a busca filtra a MESMA listagem (nome, ou telefone com 4 dígitos
   * ou mais, como em `search`).
   *
   * Ordem estável por nome sem diferenciar maiúsculas e, no empate, por id.
   * A paginação é por cursor (o último nome e id da página anterior), então
   * um cadastro novo entre duas páginas não repete nem pula ninguém da
   * ordem já vista. `total` conta todos os que passam no filtro, no
   * servidor, sem depender de quantas páginas a tela já pediu.
   */
  async listPage(
    userId: string,
    tenantId: string,
    query: ConsumerPageDto,
  ): Promise<{ consumers: ConsumerView[]; nextCursor: string | null; total: number }> {
    const manager = this.dataSource.manager;
    const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: canViewConsumers,
      mensagemProibido: CONSUMERS_FORBIDDEN_MESSAGE,
      recurso: FeatureKey.CONSUMIDORES,
    });

    const parametros: unknown[] = [authorized.tenantId];
    let filtro = '';
    if (query.q) {
      parametros.push(`%${escaparLike(query.q)}%`);
      const condicoes = [`name ILIKE $${parametros.length} ESCAPE '\\'`];
      const digitos = query.q.replace(/\D/g, '');
      if (digitos.length >= 4) {
        parametros.push(`%${digitos}%`);
        condicoes.push(`whatsapp_normalized LIKE $${parametros.length}`);
      }
      filtro = ` AND (${condicoes.join(' OR ')})`;
    }

    const [contagem] = linhasDe<{ total: string }>(
      await manager.query(
        `SELECT count(*)::text AS total FROM consumers
          WHERE tenant_id = $1 AND merged_into_consumer_id IS NULL${filtro}`,
        parametros,
      ),
    );

    const posicao = query.cursor ? lerCursor(query.cursor) : null;
    const parametrosDaPagina = [...parametros];
    let depoisDe = '';
    if (posicao) {
      parametrosDaPagina.push(posicao.nome, posicao.id);
      const n = parametrosDaPagina.length;
      depoisDe = ` AND (lower(name), id) > ($${n - 1}, $${n})`;
    }
    parametrosDaPagina.push(query.limit + 1);
    const linhas = linhasDe<{ id: string; name: string; chave: string; whatsapp: string; email: string | null }>(
      await manager.query(
        `SELECT id, name, lower(name) AS chave, whatsapp, email FROM consumers
          WHERE tenant_id = $1 AND merged_into_consumer_id IS NULL${filtro}${depoisDe}
          ORDER BY lower(name), id
          LIMIT $${parametrosDaPagina.length}`,
        parametrosDaPagina,
      ),
    );

    const pagina = linhas.slice(0, query.limit);
    const ultima = pagina.at(-1);
    return {
      consumers: pagina.map((linha) => ({
        id: linha.id,
        name: linha.name,
        whatsapp: linha.whatsapp,
        email: linha.email ?? null,
      })),
      nextCursor:
        linhas.length > query.limit && ultima
          ? escreverCursor({ nome: ultima.chave, id: ultima.id })
          : null,
      total: Number(contagem?.total ?? 0),
    };
  }

  /**
   * Cadastro pela tela de Clientes.
   *
   * - Trava o telefone (mesma chave do agendamento público), então dois
   *   cadastros simultâneos do mesmo número se enfileiram.
   * - Com `requestKey`: a chave já gravada com a MESMA impressão devolve o
   *   cadastro original (`repeated: true`), mesmo que ele tenha sido editado
   *   depois; com outra impressão, 409 `CHAVE_REUTILIZADA`. Duas chamadas
   *   simultâneas com a mesma chave e telefones diferentes não se esperam:
   *   a PK de `consumer_create_requests` barra a segunda, que relê a chave.
   * - Telefone já usado por um cadastro ativo: 409 `TELEFONE_EM_USO`,
   *   conferido aqui, sob a trava (com ou sem o UNIQUE antigo no banco).
   */
  async create(userId: string, tenantId: string, dto: CreateConsumerDto): Promise<ConsumerView> {
    return (await this.register(userId, tenantId, dto)).consumer;
  }

  /** O cadastro com o resultado completo (a rota usa este). */
  async register(userId: string, tenantId: string, dto: CreateConsumerDto): Promise<CreateConsumerResult> {
    const authorized = await resolveAuthorizedTenant(this.dataSource.manager, userId, tenantId, {
      permitido: canManageConsumers,
      mensagemProibido: CONSUMERS_FORBIDDEN_MESSAGE,
      recurso: FeatureKey.CONSUMIDORES,
    });
    const tenant = authorized.tenantId;
    const telefone = normalizePhone(dto.whatsapp);
    const chave = dto.requestKey;
    const impressao = chave
      ? impressaoDoPedido({ name: dto.name, whatsappNormalized: telefone, email: dto.email, outraPessoa: false })
      : null;

    try {
      return await this.dataSource.transaction(async (tx) => {
        await travarTelefoneDoCliente(tx, tenant, telefone);
        if (chave && impressao) {
          const repetido = await this.pedidoPelaChave(tx, tenant, chave, impressao);
          if (repetido) return repetido;
        }
        const consumer = await this.gravarNovo(tx, tenant, dto, telefone);
        if (chave && impressao) {
          await tx.query(
            `INSERT INTO consumer_create_requests (tenant_id, request_key, request_fingerprint, consumer_id)
             VALUES ($1, $2, $3, $4)`,
            [tenant, chave, impressao, consumer.id],
          );
        }
        return { consumer, repeated: false };
      });
    } catch (error) {
      if (chave && impressao && isUniqueViolation(error, 'pk_consumer_create_requests')) {
        const repetido = await this.pedidoPelaChave(this.dataSource.manager, tenant, chave, impressao);
        if (repetido) return repetido;
      }
      throw error;
    }
  }

  /** A chave já usada: o cadastro original (e o principal, se ele virou
   * lápide) quando a impressão confere; 409 quando não; `null` se a chave é
   * nova. Compara SÓ com a impressão gravada. */
  private async pedidoPelaChave(
    manager: EntityManager,
    tenantId: string,
    chave: string,
    impressao: string,
  ): Promise<CreateConsumerResult | null> {
    const [pedido] = linhasDe<{ request_fingerprint: string; consumer_id: string }>(
      await manager.query(
        `SELECT request_fingerprint, consumer_id FROM consumer_create_requests
          WHERE tenant_id = $1 AND request_key = $2`,
        [tenantId, chave],
      ),
    );
    if (!pedido) return null;
    if (pedido.request_fingerprint !== impressao) throw chaveReutilizada();

    const [original] = linhasDe<LinhaDoCliente>(
      await manager.query(
        `SELECT id, name, whatsapp, email, merged_into_consumer_id FROM consumers WHERE tenant_id = $1 AND id = $2`,
        [tenantId, pedido.consumer_id],
      ),
    );
    const resultado: CreateConsumerResult = { consumer: viewDaLinha(original), repeated: true };
    if (original.merged_into_consumer_id) {
      const [principal] = linhasDe<LinhaDoCliente>(
        await manager.query(`SELECT id, name, whatsapp, email FROM consumers WHERE tenant_id = $1 AND id = $2`, [
          tenantId,
          original.merged_into_consumer_id,
        ]),
      );
      if (principal) resultado.principal = viewDaLinha(principal);
    }
    return resultado;
  }

  /**
   * Gravação de um cliente novo com `manager` recebido de fora — é o que
   * permite o agendamento criar cliente e reserva na MESMA transação (ver
   * appointments.service.ts). Sem isso, uma falha ao gravar o agendamento
   * deixaria para trás um cliente órfão criado só por uma tentativa que não
   * deu certo.
   *
   * A autorização NÃO é refeita aqui: quem chama já provou o tenant. O
   * parâmetro é `tenantId` já autorizado, nunca o do caminho da requisição.
   * Trava o telefone (repetir a trava na mesma transação não espera).
   */
  async createWith(
    manager: EntityManager,
    tenantId: string,
    dto: Pick<CreateConsumerDto, 'name' | 'whatsapp' | 'email'>,
  ): Promise<ConsumerView> {
    const telefone = normalizePhone(dto.whatsapp);
    await travarTelefoneDoCliente(manager, tenantId, telefone);
    return this.gravarNovo(manager, tenantId, dto, telefone);
  }

  /** Grava o cadastro, já sob a trava do telefone. Telefone de um cadastro
   * ativo: 409 `TELEFONE_EM_USO` (o UNIQUE antigo, enquanto existir, dá a
   * mesma resposta). */
  private async gravarNovo(
    manager: EntityManager,
    tenantId: string,
    dto: Pick<CreateConsumerDto, 'name' | 'whatsapp' | 'email'>,
    whatsappNormalized: string,
  ): Promise<ConsumerView> {
    const [emUso] = linhasDe<{ id: string }>(
      await manager.query(
        `SELECT id FROM consumers
          WHERE tenant_id = $1 AND whatsapp_normalized = $2 AND merged_into_consumer_id IS NULL
          LIMIT 1`,
        [tenantId, whatsappNormalized],
      ),
    );
    if (emUso) throw telefoneEmUso();

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
      if (isUniqueViolation(error, 'uq_consumers_tenant_whatsapp')) throw telefoneEmUso();
      throw error;
    }
  }

  /**
   * Cliente deste tenant para um agendamento se ligar a ele, travado
   * (`FOR SHARE`) até o fim da transação de quem chama. `null` quando não
   * existe NESTE tenant — de propósito indistinguível de "não existe em lugar
   * nenhum". Cadastro unificado: 409 `CLIENTE_UNIFICADO` com o principal (o
   * gatilho do banco recusaria do mesmo jeito).
   */
  async findForLink(
    manager: EntityManager,
    tenantId: string,
    consumerId: string,
  ): Promise<ConsumerView | null> {
    const [linha] = linhasDe<LinhaDoCliente>(
      await manager.query(
        `SELECT id, name, whatsapp, email, merged_into_consumer_id FROM consumers
          WHERE tenant_id = $1 AND id = $2
          FOR SHARE`,
        [tenantId, consumerId],
      ),
    );
    if (!linha) return null;
    if (linha.merged_into_consumer_id) throw clienteUnificado(linha.merged_into_consumer_id);
    return viewDaLinha(linha);
  }

  /**
   * Edição de nome, WhatsApp e e-mail. O id e o histórico não mudam; os
   * snapshots dos agendamentos ficam como estavam. As preferências de
   * mensagem ficam com o número ao qual foram dadas
   * (`whatsapp_consent_events`): o número novo começa sem autorização.
   *
   * Ordem das travas: telefone novo (advisory, a mesma do cadastro e do
   * público) e depois a linha (`FOR UPDATE`). Lápide: 409
   * `CLIENTE_UNIFICADO`. Versão lida diferente da atual: 409
   * `CLIENTE_ALTERADO`. Telefone de outro cadastro ativo: 409
   * `TELEFONE_EM_USO`.
   */
  async update(
    userId: string,
    tenantId: string,
    consumerId: string,
    dto: UpdateConsumerDto,
  ): Promise<UpdatedConsumerView> {
    const authorized = await resolveAuthorizedTenant(this.dataSource.manager, userId, tenantId, {
      permitido: canManageConsumers,
      mensagemProibido: CONSUMERS_FORBIDDEN_MESSAGE,
      recurso: FeatureKey.CONSUMIDORES,
    });
    const tenant = authorized.tenantId;
    const telefoneNovo = dto.whatsapp !== undefined ? normalizePhone(dto.whatsapp) : undefined;

    try {
      return await this.dataSource.transaction(async (tx) => {
        if (telefoneNovo) await travarTelefoneDoCliente(tx, tenant, telefoneNovo);
        const [atual] = linhasDe<LinhaDoCliente>(
          await tx.query(
            `SELECT id, name, whatsapp, whatsapp_normalized, email, updated_at, merged_into_consumer_id
               FROM consumers WHERE tenant_id = $1 AND id = $2
               FOR UPDATE`,
            [tenant, consumerId],
          ),
        );
        if (!atual) throw new NotFoundException(CONSUMER_NOT_FOUND_MESSAGE);
        if (atual.merged_into_consumer_id) throw clienteUnificado(atual.merged_into_consumer_id);
        if (new Date(atual.updated_at).getTime() !== new Date(dto.expectedUpdatedAt).getTime()) {
          throw clienteAlterado();
        }

        const novo = {
          name: dto.name ?? atual.name,
          whatsapp: dto.whatsapp ?? atual.whatsapp,
          whatsappNormalized: telefoneNovo ?? atual.whatsapp_normalized,
          email: dto.email === undefined ? atual.email : dto.email,
        };
        const campos = [
          novo.name !== atual.name ? 'name' : null,
          novo.whatsapp !== atual.whatsapp || novo.whatsappNormalized !== atual.whatsapp_normalized ? 'whatsapp' : null,
          (novo.email ?? null) !== (atual.email ?? null) ? 'email' : null,
        ].filter((campo): campo is string => campo !== null);
        if (campos.length === 0) {
          return { ...viewDaLinha(atual), updatedAt: new Date(atual.updated_at).toISOString() };
        }

        if (novo.whatsappNormalized !== atual.whatsapp_normalized) {
          const [outro] = linhasDe<{ id: string }>(
            await tx.query(
              `SELECT id FROM consumers
                WHERE tenant_id = $1 AND whatsapp_normalized = $2 AND id <> $3 AND merged_into_consumer_id IS NULL
                LIMIT 1`,
              [tenant, novo.whatsappNormalized, consumerId],
            ),
          );
          if (outro) throw telefoneEmUso();
        }

        const [salvo] = linhasDe<LinhaDoCliente>(
          await tx.query(
            `UPDATE consumers
                SET name = $3, whatsapp = $4, whatsapp_normalized = $5, email = $6, updated_at = now()
              WHERE tenant_id = $1 AND id = $2
              RETURNING id, name, whatsapp, email, updated_at`,
            [tenant, consumerId, novo.name, novo.whatsapp, novo.whatsappNormalized, novo.email ?? null],
          ),
        );
        // Só os NOMES dos campos alterados: a auditoria registra quem mudou o
        // quê, sem copiar contato do cliente para outro lugar.
        await recordAudit(
          tx,
          {
            action: 'CONSUMER_UPDATED',
            actor: await loadActor(tx, userId),
            tenantId: tenant,
            summary: 'Cadastro de cliente alterado.',
            previousData: { consumerId },
            newData: { consumerId, campos },
          },
          new Date(),
        );
        return { ...viewDaLinha(salvo), updatedAt: new Date(salvo.updated_at).toISOString() };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'uq_consumers_tenant_whatsapp')) throw telefoneEmUso();
      throw error;
    }
  }
}
