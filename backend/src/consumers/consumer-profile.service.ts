// Ficha, histórico e lista agrupada de clientes (ver
// docs/plans/clientes-ficha-e-duplicados.md). Só leitura.
//
// - Tudo dentro do tenant provado por `resolveAuthorizedTenant`; todo SQL
//   filtra por `tenant_id`. Cliente de outro estabelecimento: 404.
// - Os números da ficha são "neste cadastro": contam os agendamentos ligados
//   a este `consumers.id`. Nada é somado entre cadastros.
// - Grupos e sugestões só SUGEREM revisão. Nada aqui une, escolhe ou apaga
//   cadastro:
//   - MESMO_TELEFONE: mesmo `whatsapp_normalized`;
//   - NUMERO_PARECIDO: mesma `phone_match_key` com número diferente (9º
//     dígito ou DDD com zero); chave nula (telefone inválido) nunca agrupa;
//   - MESMO_NOME: mesmo `name_key`, fora do grupo de telefone.
// - Preço só para quem vê dinheiro (`recortarParaQuemPediu`); recebimento só
//   com a consulta de recebimentos e o recurso contratado.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { resolveAuthorizedTenant, type AuthorizedTenant } from '../common/tenant-authorization.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { linhasDe } from '../common/linhas-de.js';
import { managerCan } from '../common/manager-permissions.js';
import { canViewPayments } from '../payments/payment-access.js';
import { featureEnabled } from '../commercial/commercial-gate.js';
import { dataLocalDe, horaLocalDe } from '../availability/time-zone.js';
import { canViewConsumers, CONSUMERS_FORBIDDEN_MESSAGE } from './consumer-access.js';
import type { ConsumerGroupsDto, ConsumerHistoryDto } from './consumer.dto.js';
import { clienteUnificado } from './consumer-rules.js';
import { CONSUMER_NOT_FOUND_MESSAGE, escaparLike, type ConsumerView } from './consumers.service.js';

export type RelacaoEntreCadastros = 'MESMO_TELEFONE' | 'NUMERO_PARECIDO' | 'MESMO_NOME';

export interface MembroDoGrupo extends ConsumerView {
  /** Relações com OUTROS membros do mesmo grupo de telefone. */
  relacoes: Exclude<RelacaoEntreCadastros, 'MESMO_NOME'>[];
  /** Cadastros ativos com o mesmo nome fora deste grupo ("Mesmo nome —
   * confira"). Só a quantidade; a ficha mostra quais. */
  mesmoNome: number;
}

export interface GrupoDeClientes {
  /** Opaca e estável dentro da lista. */
  chave: string;
  membros: MembroDoGrupo[];
}

export interface OutroCadastro extends ConsumerView {
  relacoes: RelacaoEntreCadastros[];
}

export interface AtendimentoResumido {
  id: string;
  startAt: string;
  /** Data (`YYYY-MM-DD`) e hora (`HH:mm`) no fuso do estabelecimento. */
  localDate: string;
  localStart: string;
  status: string;
  professionalName: string;
  services: string[];
}

export interface FichaDoCliente {
  consumer: ConsumerView & { updatedAt: string; createdAt: string; telefoneAgrupavel: boolean };
  /** Tudo "neste cadastro". */
  resumo: {
    total: number;
    concluidos: number;
    cancelados: number;
    faltas: number;
    ultimoConcluido: AtendimentoResumido | null;
    proximo: AtendimentoResumido | null;
  };
  /** Nomes distintos digitados nos agendamentos deste cadastro. */
  nomesUsados: string[];
  historicoPossivelmenteCompartilhado: boolean;
  outrosCadastros: OutroCadastro[];
}

export interface ItemDoHistorico extends AtendimentoResumido {
  /** `null` quando quem pediu não vê dinheiro (ou o item é sob consulta). */
  priceCents: number | null;
  /** Recebimento ativo ou estornado; ausente (`undefined`) para quem não vê
   * recebimentos. */
  payment?: { amountCents: number; method: string; receivedOn: string; refunded: boolean } | null;
  hidden: ('price' | 'payment')[];
}

/** Teto de outros cadastros sugeridos na ficha. */
export const LIMITE_DE_SUGESTOES = 20;

interface LinhaAtiva {
  id: string;
  name: string;
  whatsapp: string;
  whatsapp_normalized: string;
  email: string | null;
  name_key: string;
  chave: string;
  mesmo_nome: string;
}

/**
 * O que o histórico mostra para quem pediu. Preço: a mesma regra das
 * respostas de agendamento (`recortarParaQuemPediu`): o dono vê; o gerente
 * só com `RECEBIMENTOS_VISUALIZAR`. Recebimento: a política de recebimentos
 * (`canViewPayments`) e o recurso contratado.
 */
export function oQueOHistoricoMostra(
  quem: Pick<AuthorizedTenant, 'role' | 'overrides'>,
  recursoDePagamentos: boolean,
): { veDinheiro: boolean; veRecebimentos: boolean } {
  const overrides = quem.overrides ?? [];
  return {
    veDinheiro: quem.role !== 'GERENTE' || managerCan(quem.role, overrides, 'RECEBIMENTOS_VISUALIZAR'),
    veRecebimentos: recursoDePagamentos && canViewPayments(quem.role, overrides),
  };
}

function lerCursorDeTexto<T extends unknown[]>(cursor: string, valido: (valor: unknown[]) => boolean): T {
  try {
    const valor: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(valor) && valido(valor)) return valor as T;
  } catch {
    // cai na recusa abaixo
  }
  throw new BadRequestException('Página inválida. Recarregue a lista de clientes.');
}

function escreverCursor(valor: unknown[]): string {
  return Buffer.from(JSON.stringify(valor), 'utf8').toString('base64url');
}

const ehTexto = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;

@Injectable()
export class ConsumerProfileService {
  constructor(private readonly dataSource: DataSource) {}

  private autorizar(userId: string, tenantId: string): Promise<AuthorizedTenant> {
    return resolveAuthorizedTenant(this.dataSource.manager, userId, tenantId, {
      permitido: canViewConsumers,
      mensagemProibido: CONSUMERS_FORBIDDEN_MESSAGE,
      recurso: FeatureKey.CONSUMIDORES,
    });
  }

  /**
   * Lista agrupada: um item por grupo de `phone_match_key` (ou o cadastro
   * sozinho, quando a chave é nula), só cadastros ativos. Ordem pelo menor
   * `name_key` do grupo e, no empate, pela chave do grupo (única), que vai
   * no cursor. A busca casa nome ou telefone de qualquer membro e devolve o
   * grupo inteiro.
   */
  async groups(
    userId: string,
    tenantId: string,
    query: ConsumerGroupsDto,
  ): Promise<{ groups: GrupoDeClientes[]; nextCursor: string | null; total: number }> {
    const { tenantId: tenant } = await this.autorizar(userId, tenantId);
    const manager = this.dataSource.manager;

    const parametros: unknown[] = [tenant];
    let filtro = '';
    if (query.q) {
      parametros.push(`%${escaparLike(query.q)}%`);
      const condicoes = [`name ILIKE $${parametros.length} ESCAPE '\\'`];
      const digitos = query.q.replace(/\D/g, '');
      if (digitos.length >= 4) {
        parametros.push(`%${digitos}%`);
        condicoes.push(`whatsapp_normalized LIKE $${parametros.length}`);
      }
      filtro = `HAVING bool_or(${condicoes.join(' OR ')})`;
    }
    const grupos = `
      WITH ativos AS (
        SELECT id, name, whatsapp_normalized, name_key, coalesce(phone_match_key, 'c:' || id) AS chave
          FROM consumers
         WHERE tenant_id = $1 AND merged_into_consumer_id IS NULL
      ), grupos AS (
        SELECT chave, min(name_key) AS nome FROM ativos GROUP BY chave ${filtro}
      )`;

    const [contagem] = linhasDe<{ total: string }>(
      await manager.query(`${grupos} SELECT count(*)::text AS total FROM grupos`, parametros),
    );

    const daPagina = [...parametros];
    let depoisDe = '';
    if (query.cursor) {
      const [nome, chave] = lerCursorDeTexto<[string, string]>(
        query.cursor,
        (v) => v.length === 2 && typeof v[0] === 'string' && v[0].length <= 200 && ehTexto(v[1], 40),
      );
      daPagina.push(nome, chave);
      depoisDe = `WHERE (nome, chave) > ($${daPagina.length - 1}, $${daPagina.length})`;
    }
    daPagina.push(query.limit + 1);
    const pagina = linhasDe<{ chave: string; nome: string }>(
      await manager.query(
        `${grupos} SELECT chave, nome FROM grupos ${depoisDe} ORDER BY nome, chave LIMIT $${daPagina.length}`,
        daPagina,
      ),
    );
    const visiveis = pagina.slice(0, query.limit);
    const membros = await this.membrosDosGrupos(
      manager,
      tenant,
      visiveis.map((g) => g.chave),
    );

    const ultima = visiveis.at(-1);
    return {
      groups: visiveis.map((grupo) => ({ chave: grupo.chave, membros: membros.get(grupo.chave) ?? [] })),
      nextCursor: pagina.length > query.limit && ultima ? escreverCursor([ultima.nome, ultima.chave]) : null,
      total: Number(contagem?.total ?? 0),
    };
  }

  private async membrosDosGrupos(
    manager: EntityManager,
    tenantId: string,
    chaves: string[],
  ): Promise<Map<string, MembroDoGrupo[]>> {
    const porGrupo = new Map<string, MembroDoGrupo[]>();
    if (chaves.length === 0) return porGrupo;
    const linhas = linhasDe<LinhaAtiva>(
      await manager.query(
        `WITH ativos AS (
           SELECT id, name, whatsapp, whatsapp_normalized, email, name_key,
                  coalesce(phone_match_key, 'c:' || id) AS chave
             FROM consumers
            WHERE tenant_id = $1 AND merged_into_consumer_id IS NULL
         )
         SELECT a.id, a.name, a.whatsapp, a.whatsapp_normalized, a.email, a.name_key, a.chave,
                (SELECT count(*) FROM ativos o WHERE o.name_key = a.name_key AND o.chave <> a.chave)::text AS mesmo_nome
           FROM ativos a
          WHERE a.chave = ANY($2::text[])
          ORDER BY a.name_key, a.id`,
        [tenantId, chaves],
      ),
    );
    const linhasPorGrupo = new Map<string, LinhaAtiva[]>();
    for (const linha of linhas) {
      linhasPorGrupo.set(linha.chave, [...(linhasPorGrupo.get(linha.chave) ?? []), linha]);
    }
    for (const [chave, grupo] of linhasPorGrupo) {
      porGrupo.set(
        chave,
        grupo.map((linha) => {
          const outros = grupo.filter((o) => o.id !== linha.id);
          const relacoes: MembroDoGrupo['relacoes'] = [];
          if (outros.some((o) => o.whatsapp_normalized === linha.whatsapp_normalized)) relacoes.push('MESMO_TELEFONE');
          if (outros.some((o) => o.whatsapp_normalized !== linha.whatsapp_normalized)) relacoes.push('NUMERO_PARECIDO');
          return {
            id: linha.id,
            name: linha.name,
            whatsapp: linha.whatsapp,
            email: linha.email ?? null,
            relacoes,
            mesmoNome: Number(linha.mesmo_nome),
          };
        }),
      );
    }
    return porGrupo;
  }

  /** Ficha do cliente. Cadastro unificado: 409 `CLIENTE_UNIFICADO` com o
   * principal. */
  async profile(userId: string, tenantId: string, consumerId: string): Promise<FichaDoCliente> {
    const { tenantId: tenant } = await this.autorizar(userId, tenantId);
    const manager = this.dataSource.manager;

    const [cliente] = linhasDe<{
      id: string;
      name: string;
      whatsapp: string;
      whatsapp_normalized: string;
      email: string | null;
      name_key: string;
      phone_match_key: string | null;
      merged_into_consumer_id: string | null;
      updated_at: Date;
      created_at: Date;
    }>(
      await manager.query(
        `SELECT id, name, whatsapp, whatsapp_normalized, email, name_key, phone_match_key,
                merged_into_consumer_id, updated_at, created_at
           FROM consumers WHERE tenant_id = $1 AND id = $2`,
        [tenant, consumerId],
      ),
    );
    if (!cliente) throw new NotFoundException(CONSUMER_NOT_FOUND_MESSAGE);
    if (cliente.merged_into_consumer_id) throw clienteUnificado(cliente.merged_into_consumer_id);

    const [contagens] = linhasDe<{ total: string; concluidos: string; cancelados: string; faltas: string }>(
      await manager.query(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE status = 'COMPLETED')::text AS concluidos,
                count(*) FILTER (WHERE status = 'CANCELED')::text AS cancelados,
                count(*) FILTER (WHERE status = 'NO_SHOW')::text AS faltas
           FROM appointments WHERE tenant_id = $1 AND consumer_id = $2`,
        [tenant, consumerId],
      ),
    );

    const [ultimoConcluido] = await this.atendimentos(
      manager,
      tenant,
      `a.consumer_id = $2 AND a.status = 'COMPLETED'`,
      [consumerId],
      'a.start_at DESC, a.id DESC',
      1,
    );
    const [proximo] = await this.atendimentos(
      manager,
      tenant,
      `a.consumer_id = $2 AND a.status IN ('PENDING', 'CONFIRMED') AND a.start_at > now()`,
      [consumerId],
      'a.start_at ASC, a.id ASC',
      1,
    );

    const nomes = linhasDe<{ nome: string }>(
      await manager.query(
        // Um por nome normalizado, na grafia mais recente; em ordem da chave.
        `SELECT nome FROM (
           SELECT DISTINCT ON (consumer_name_key(consumer_name_snapshot))
                  consumer_name_key(consumer_name_snapshot) AS chave, consumer_name_snapshot AS nome
             FROM appointments WHERE tenant_id = $1 AND consumer_id = $2
            ORDER BY consumer_name_key(consumer_name_snapshot), start_at DESC, id DESC
         ) AS nomes
         ORDER BY chave`,
        [tenant, consumerId],
      ),
    ).map((linha) => linha.nome);

    const outros = linhasDe<{
      id: string;
      name: string;
      whatsapp: string;
      whatsapp_normalized: string;
      email: string | null;
      name_key: string;
      phone_match_key: string | null;
    }>(
      await manager.query(
        `SELECT id, name, whatsapp, whatsapp_normalized, email, name_key, phone_match_key
           FROM consumers
          WHERE tenant_id = $1 AND id <> $2 AND merged_into_consumer_id IS NULL
            AND ((phone_match_key IS NOT NULL AND phone_match_key = $3) OR name_key = $4)
          ORDER BY name_key, id
          LIMIT ${LIMITE_DE_SUGESTOES}`,
        [tenant, consumerId, cliente.phone_match_key, cliente.name_key],
      ),
    );

    return {
      consumer: {
        id: cliente.id,
        name: cliente.name,
        whatsapp: cliente.whatsapp,
        email: cliente.email ?? null,
        updatedAt: new Date(cliente.updated_at).toISOString(),
        createdAt: new Date(cliente.created_at).toISOString(),
        telefoneAgrupavel: cliente.phone_match_key !== null,
      },
      resumo: {
        total: Number(contagens?.total ?? 0),
        concluidos: Number(contagens?.concluidos ?? 0),
        cancelados: Number(contagens?.cancelados ?? 0),
        faltas: Number(contagens?.faltas ?? 0),
        ultimoConcluido: ultimoConcluido ?? null,
        proximo: proximo ?? null,
      },
      nomesUsados: nomes,
      historicoPossivelmenteCompartilhado: nomes.length > 1,
      outrosCadastros: outros.map((outro) => {
        const relacoes: RelacaoEntreCadastros[] = [];
        if (cliente.phone_match_key !== null && outro.phone_match_key === cliente.phone_match_key) {
          relacoes.push(outro.whatsapp_normalized === cliente.whatsapp_normalized ? 'MESMO_TELEFONE' : 'NUMERO_PARECIDO');
        }
        if (outro.name_key === cliente.name_key) relacoes.push('MESMO_NOME');
        return { id: outro.id, name: outro.name, whatsapp: outro.whatsapp, email: outro.email ?? null, relacoes };
      }),
    };
  }

  /**
   * Histórico paginado deste cadastro, do mais recente ao mais antigo
   * (cursor: início e id). Preço só para quem vê dinheiro; recebimento só com
   * a consulta de recebimentos e o recurso contratado. Centavos inteiros.
   */
  async history(
    userId: string,
    tenantId: string,
    consumerId: string,
    query: ConsumerHistoryDto,
  ): Promise<{ appointments: ItemDoHistorico[]; nextCursor: string | null }> {
    const quem = await this.autorizar(userId, tenantId);
    const tenant = quem.tenantId;
    const manager = this.dataSource.manager;

    const [cliente] = linhasDe<{ merged_into_consumer_id: string | null }>(
      await manager.query(`SELECT merged_into_consumer_id FROM consumers WHERE tenant_id = $1 AND id = $2`, [
        tenant,
        consumerId,
      ]),
    );
    if (!cliente) throw new NotFoundException(CONSUMER_NOT_FOUND_MESSAGE);
    if (cliente.merged_into_consumer_id) throw clienteUnificado(cliente.merged_into_consumer_id);

    const { veDinheiro, veRecebimentos } = oQueOHistoricoMostra(
      quem,
      await featureEnabled(manager, tenant, FeatureKey.PAGAMENTOS),
    );

    const parametros: unknown[] = [consumerId];
    let condicao = 'a.consumer_id = $2';
    if (query.cursor) {
      const [inicio, id] = lerCursorDeTexto<[string, string]>(
        query.cursor,
        (v) => v.length === 2 && ehTexto(v[0], 40) && !Number.isNaN(Date.parse(v[0] as string)) && ehTexto(v[1], 30),
      );
      parametros.push(new Date(inicio), id);
      condicao += ` AND (a.start_at, a.id) < ($3, $4)`;
    }
    const linhas = await this.atendimentos(
      manager,
      tenant,
      condicao,
      parametros,
      'a.start_at DESC, a.id DESC',
      query.limit + 1,
      true,
    );
    const pagina = linhas.slice(0, query.limit);

    const recebimentos = new Map<string, NonNullable<ItemDoHistorico['payment']>>();
    if (veRecebimentos && pagina.length > 0) {
      // O recebimento ativo, ou o estorno mais recente quando não há ativo.
      const pagamentos = linhasDe<{
        appointment_id: string;
        amount_cents: string;
        method: string;
        received_on: string;
        refunded: boolean;
      }>(
        await manager.query(
          `SELECT DISTINCT ON (appointment_id) appointment_id, amount_cents::text, method,
                  to_char(received_on, 'YYYY-MM-DD') AS received_on, refunded_at IS NOT NULL AS refunded
             FROM appointment_payments
            WHERE tenant_id = $1 AND appointment_id = ANY($2::varchar[])
            ORDER BY appointment_id, (refunded_at IS NULL) DESC, recorded_at DESC`,
          [tenant, pagina.map((item) => item.id)],
        ),
      );
      for (const p of pagamentos) {
        recebimentos.set(p.appointment_id, {
          amountCents: Number(p.amount_cents),
          method: p.method,
          receivedOn: p.received_on,
          refunded: p.refunded,
        });
      }
    }

    const ultima = pagina.at(-1);
    return {
      appointments: pagina.map((item) => {
        const hidden: ItemDoHistorico['hidden'] = [];
        if (!veDinheiro) hidden.push('price');
        if (!veRecebimentos) hidden.push('payment');
        const { precos, ...resto } = item as AtendimentoResumido & { precos?: (number | null)[] };
        const lista = precos ?? [];
        const total = lista.length === 0 || lista.some((p) => p === null) ? null : lista.reduce<number>((s, p) => s + (p ?? 0), 0);
        return {
          ...resto,
          priceCents: veDinheiro ? total : null,
          ...(veRecebimentos ? { payment: recebimentos.get(item.id) ?? null } : {}),
          hidden,
        };
      }),
      nextCursor:
        linhas.length > query.limit && ultima ? escreverCursor([ultima.startAt, ultima.id]) : null,
    };
  }

  /** Atendimentos deste tenant com profissional e serviços (nomes
   * congelados, ou o atual quando o item é anterior aos snapshots). */
  private async atendimentos(
    manager: EntityManager,
    tenantId: string,
    condicao: string,
    parametros: unknown[],
    ordem: string,
    limite: number,
    comPrecos = false,
  ): Promise<(AtendimentoResumido & { precos?: (number | null)[] })[]> {
    const linhas = linhasDe<{
      id: string;
      start_at: Date;
      timezone: string;
      status: string;
      professional_name: string;
      servicos: string[] | null;
      precos: (number | null)[] | null;
    }>(
      await manager.query(
        `SELECT a.id, a.start_at, t.timezone, a.status, p.name AS professional_name,
                (SELECT array_agg(coalesce(i.service_name_snapshot, s.name, '') ORDER BY i.position, i.id)
                   FROM appointment_items i
                   LEFT JOIN services s ON s.tenant_id = i.tenant_id AND s.id = i.service_id
                  WHERE i.tenant_id = a.tenant_id AND i.appointment_id = a.id) AS servicos,
                (SELECT array_agg(i.price_cents_snapshot ORDER BY i.position, i.id)
                   FROM appointment_items i
                  WHERE i.tenant_id = a.tenant_id AND i.appointment_id = a.id) AS precos
           FROM appointments a
           JOIN professionals p ON p.tenant_id = a.tenant_id AND p.id = a.professional_id
           JOIN tenants t ON t.id = a.tenant_id
          WHERE a.tenant_id = $1 AND ${condicao}
          ORDER BY ${ordem}
          LIMIT ${Number(limite)}`,
        [tenantId, ...parametros],
      ),
    );
    return linhas.map((linha) => ({
      id: linha.id,
      startAt: new Date(linha.start_at).toISOString(),
      localDate: dataLocalDe(new Date(linha.start_at), linha.timezone),
      localStart: horaLocalDe(new Date(linha.start_at), linha.timezone),
      status: linha.status,
      professionalName: linha.professional_name,
      services: (linha.servicos ?? []).filter((nome) => nome !== ''),
      ...(comPrecos ? { precos: linha.precos ?? [] } : {}),
    }));
  }
}
