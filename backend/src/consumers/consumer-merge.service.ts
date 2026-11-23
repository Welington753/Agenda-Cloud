// Prévia e unificação de cadastros de clientes (ver
// docs/plans/clientes-ficha-e-duplicados.md).
//
// - SÓ o dono unifica (`canMergeConsumers`), e só cadastros sugeridos (mesmo
//   WhatsApp, número parecido ou mesmo nome). Nada é unificado sozinho.
// - O cadastro do caminho é o SECUNDÁRIO: vira lápide
//   (`merged_into_consumer_id`, `merged_at`, `merged_by_user_id`). Nada é
//   apagado. Os agendamentos dele passam para o principal com os snapshots
//   intactos; recebimentos, comissões e pedidos públicos seguem pelo
//   agendamento. Telefone, nome e preferências de mensagem do principal não
//   mudam; os eventos de preferência ficam no número ao qual foram dados.
// - A confirmação confere a versão da prévia DEPOIS de travar tudo o que
//   entra nela; versão diferente: 409 `PREVIA_DESATUALIZADA`, nada
//   transferido.
//
// Travas, nesta ordem:
// 1. os dois cadastros e as lápides que apontam para o secundário, por ordem
//    de id (`FOR UPDATE`). O gatilho `trg_appointments_consumer_active` pede
//    `FOR SHARE` no cadastro: nenhum agendamento novo entra no secundário
//    até o fim; quem chega depois encontra a lápide (409 `CLIENTE_UNIFICADO`);
// 2. todos os agendamentos do secundário (`FOR UPDATE`). Quem grava
//    recebimento, estorno, conclusão (com a comissão) ou muda a situação
//    trava o agendamento antes; quem já estava gravando termina antes e
//    entra na versão recalculada.
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { linhasDe } from '../common/linhas-de.js';
import { resolveAuthorizedTenant } from '../common/tenant-authorization.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { canMergeConsumers, CONSUMERS_MERGE_FORBIDDEN_MESSAGE } from './consumer-access.js';
import type { MergeConsumersDto } from './consumer.dto.js';
import {
  mesmoCadastro,
  naoSugerido,
  previaDe,
  previaDesatualizada,
  relacoesEntre,
  resumoDaTransferencia,
  versaoDaPrevia,
  type CadastroNaPrevia,
  type ConteudoDaUnificacao,
  type PreviaDaUnificacao,
  type ResumoDaTransferencia,
} from './consumer-merge-rules.js';
import { clienteUnificado } from './consumer-rules.js';
import { CONSUMER_NOT_FOUND_MESSAGE } from './consumers.service.js';

interface LinhaDoCadastro {
  id: string;
  name: string;
  whatsapp: string;
  whatsapp_normalized: string;
  email: string | null;
  name_key: string;
  phone_match_key: string | null;
  merged_into_consumer_id: string | null;
  merged_at: Date | null;
}

const COLUNAS = `id, name, whatsapp, whatsapp_normalized, email, name_key, phone_match_key,
                 merged_into_consumer_id, merged_at`;

export interface ResultadoDaUnificacao {
  principal: Omit<CadastroNaPrevia, 'unificado'>;
  secundarioId: string;
  mergedAt: string;
  /** A mesma unificação já tinha sido gravada (reenvio). */
  repeated: boolean;
  transferido: ResumoDaTransferencia;
}

const RESUMO_VAZIO: ResumoDaTransferencia = {
  agendamentos: 0,
  concluidos: 0,
  cancelados: 0,
  faltas: 0,
  outros: 0,
  recebimentos: 0,
  comissoes: 0,
  pedidosPublicos: 0,
};

function naPrevia(linha: LinhaDoCadastro): CadastroNaPrevia {
  return {
    id: linha.id,
    name: linha.name,
    whatsapp: linha.whatsapp,
    email: linha.email ?? null,
    unificado: linha.merged_into_consumer_id !== null,
  };
}

const semMarca = ({ unificado: _unificado, ...resto }: CadastroNaPrevia) => resto;

@Injectable()
export class ConsumerMergeService {
  constructor(private readonly dataSource: DataSource) {}

  private autorizar(manager: EntityManager, userId: string, tenantId: string) {
    return resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: canMergeConsumers,
      mensagemProibido: CONSUMERS_MERGE_FORBIDDEN_MESSAGE,
      recurso: FeatureKey.CONSUMIDORES,
    });
  }

  /** Prévia, só leitura, numa fotografia única do banco. */
  async preview(
    userId: string,
    tenantId: string,
    secundarioId: string,
    principalId: string,
  ): Promise<PreviaDaUnificacao> {
    const { tenantId: tenant } = await this.autorizar(this.dataSource.manager, userId, tenantId);
    if (secundarioId === principalId) throw mesmoCadastro();
    return this.dataSource.transaction('REPEATABLE READ', async (tx) => {
      const linhas = linhasDe<LinhaDoCadastro>(
        await tx.query(`SELECT ${COLUNAS} FROM consumers WHERE tenant_id = $1 AND id = ANY($2::varchar[])`, [
          tenant,
          [secundarioId, principalId],
        ]),
      );
      const { principal, secundario } = this.conferirPar(linhas, secundarioId, principalId);
      if (secundario.merged_into_consumer_id) throw clienteUnificado(secundario.merged_into_consumer_id);
      const relacoes = relacoesEntre(principal, secundario);
      if (relacoes.length === 0) throw naoSugerido();
      return previaDe(await this.lerConteudo(tx, tenant, principal, secundario), relacoes);
    });
  }

  /** Unificação confirmada. Uma transação; idempotente pelo estado. */
  async merge(
    userId: string,
    tenantId: string,
    secundarioId: string,
    dto: MergeConsumersDto,
  ): Promise<ResultadoDaUnificacao> {
    const { tenantId: tenant } = await this.autorizar(this.dataSource.manager, userId, tenantId);
    const principalId = dto.principalId;
    if (secundarioId === principalId) throw mesmoCadastro();

    return this.dataSource.transaction(async (tx) => {
      const travados = linhasDe<LinhaDoCadastro>(
        await tx.query(
          `SELECT ${COLUNAS} FROM consumers
            WHERE tenant_id = $1 AND (id = ANY($2::varchar[]) OR merged_into_consumer_id = $3)
            ORDER BY id
            FOR UPDATE`,
          [tenant, [secundarioId, principalId], secundarioId],
        ),
      );
      const { principal, secundario } = this.conferirPar(travados, secundarioId, principalId, true);

      // Idempotência antes da checagem de lápide: o reenvio da mesma
      // unificação devolve o que foi gravado.
      if (secundario.merged_into_consumer_id === principalId) {
        return {
          principal: semMarca(naPrevia(principal)),
          secundarioId,
          mergedAt: new Date(secundario.merged_at ?? Date.now()).toISOString(),
          repeated: true,
          transferido: await this.transferidoGravado(tx, tenant, secundarioId, principalId),
        };
      }
      if (secundario.merged_into_consumer_id) throw clienteUnificado(secundario.merged_into_consumer_id);
      if (principal.merged_into_consumer_id) throw clienteUnificado(principal.merged_into_consumer_id);
      const relacoes = relacoesEntre(principal, secundario);
      if (relacoes.length === 0) throw naoSugerido();

      await tx.query(
        `SELECT id FROM appointments WHERE tenant_id = $1 AND consumer_id = $2 ORDER BY id FOR UPDATE`,
        [tenant, secundarioId],
      );
      // Depois das travas: o conteúdo de agora contra o que a pessoa revisou.
      const conteudo = await this.lerConteudo(tx, tenant, principal, secundario);
      if (versaoDaPrevia(conteudo) !== dto.versaoDaPrevia) throw previaDesatualizada(previaDe(conteudo, relacoes));

      const agora = new Date();
      await tx.query(`UPDATE appointments SET consumer_id = $3 WHERE tenant_id = $1 AND consumer_id = $2`, [
        tenant,
        secundarioId,
        principalId,
      ]);
      // Lápides antigas do secundário passam a apontar para o principal (sem
      // cadeia de lápides).
      const redirecionadas = linhasDe<{ id: string }>(
        await tx.query(
          `UPDATE consumers SET merged_into_consumer_id = $3, updated_at = $4
            WHERE tenant_id = $1 AND merged_into_consumer_id = $2
            RETURNING id`,
          [tenant, secundarioId, principalId, agora],
        ),
      ).length;
      await tx.query(
        `UPDATE consumers
            SET merged_into_consumer_id = $3, merged_at = $4, merged_by_user_id = $5, updated_at = $4
          WHERE tenant_id = $1 AND id = $2`,
        [tenant, secundarioId, principalId, agora, userId],
      );
      await tx.query(`UPDATE consumers SET updated_at = $3 WHERE tenant_id = $1 AND id = $2`, [tenant, principalId, agora]);

      const transferido = resumoDaTransferencia(conteudo);
      await recordAudit(
        tx,
        {
          action: 'CONSUMER_MERGED',
          actor: await loadActor(tx, userId),
          tenantId: tenant,
          summary: 'Cadastros de cliente unificados.',
          previousData: { secundarioId, principalId, secundarioAtivo: true },
          newData: {
            secundarioId,
            principalId,
            secundarioAtivo: false,
            versaoDaPrevia: dto.versaoDaPrevia,
            transferido,
            lapidesRedirecionadas: redirecionadas,
          },
        },
        agora,
      );
      return {
        principal: semMarca(naPrevia(principal)),
        secundarioId,
        mergedAt: agora.toISOString(),
        repeated: false,
        transferido,
      };
    });
  }

  /** Os dois cadastros do par; ausente neste estabelecimento: 404. */
  private conferirPar(
    linhas: LinhaDoCadastro[],
    secundarioId: string,
    principalId: string,
    principalPodeSerLapide = false,
  ): { principal: LinhaDoCadastro; secundario: LinhaDoCadastro } {
    const secundario = linhas.find((l) => l.id === secundarioId);
    const principal = linhas.find((l) => l.id === principalId);
    if (!secundario || !principal) throw new NotFoundException(CONSUMER_NOT_FOUND_MESSAGE);
    if (!principalPodeSerLapide && principal.merged_into_consumer_id) {
      throw clienteUnificado(principal.merged_into_consumer_id);
    }
    return { principal, secundario };
  }

  /** O que a unificação transfere (agendamentos do secundário e o que segue
   * por eles) e os dados dos dois cadastros. Centavos inteiros. */
  private async lerConteudo(
    manager: EntityManager,
    tenantId: string,
    principal: LinhaDoCadastro,
    secundario: LinhaDoCadastro,
  ): Promise<ConteudoDaUnificacao> {
    const agendamentos = linhasDe<{ id: string; status: string; start_at: Date; precos: (string | null)[] | null }>(
      await manager.query(
        `SELECT a.id, a.status::text AS status, a.start_at,
                (SELECT array_agg(i.price_cents_snapshot::text ORDER BY i.position, i.id)
                   FROM appointment_items i
                  WHERE i.tenant_id = a.tenant_id AND i.appointment_id = a.id) AS precos
           FROM appointments a
          WHERE a.tenant_id = $1 AND a.consumer_id = $2
          ORDER BY a.id`,
        [tenantId, secundario.id],
      ),
    );
    const doSecundario = `SELECT id FROM appointments WHERE tenant_id = $1 AND consumer_id = $2`;
    const recebimentos = linhasDe<{
      id: string;
      appointment_id: string;
      amount_cents: string;
      method: string;
      received_on: string;
      refunded: boolean;
    }>(
      await manager.query(
        `SELECT id, appointment_id, amount_cents::text AS amount_cents, method::text AS method,
                to_char(received_on, 'YYYY-MM-DD') AS received_on, refunded_at IS NOT NULL AS refunded
           FROM appointment_payments
          WHERE tenant_id = $1 AND appointment_id IN (${doSecundario})
          ORDER BY id`,
        [tenantId, secundario.id],
      ),
    );
    const comissoes = linhasDe<{
      id: string;
      appointment_id: string;
      professional_cents: string;
      establishment_cents: string;
      status: string;
    }>(
      await manager.query(
        `SELECT id, appointment_id, professional_cents::text AS professional_cents,
                establishment_cents::text AS establishment_cents, status::text AS status
           FROM commission_entries
          WHERE tenant_id = $1 AND appointment_id IN (${doSecundario})
          ORDER BY id`,
        [tenantId, secundario.id],
      ),
    );
    const pedidos = linhasDe<{ id: string }>(
      await manager.query(
        `SELECT id FROM public_booking_requests
          WHERE tenant_id = $1 AND appointment_id IN (${doSecundario})
          ORDER BY id`,
        [tenantId, secundario.id],
      ),
    );
    return {
      principal: naPrevia(principal),
      secundario: naPrevia(secundario),
      agendamentos: agendamentos.map((a) => ({
        id: a.id,
        status: a.status,
        startAt: new Date(a.start_at).toISOString(),
        precos: (a.precos ?? []).map((p) => (p === null ? null : Number(p))),
      })),
      recebimentos: recebimentos.map((r) => ({
        id: r.id,
        appointmentId: r.appointment_id,
        amountCents: Number(r.amount_cents),
        method: r.method,
        receivedOn: r.received_on,
        refunded: r.refunded,
      })),
      comissoes: comissoes.map((c) => ({
        id: c.id,
        appointmentId: c.appointment_id,
        professionalCents: Number(c.professional_cents),
        establishmentCents: Number(c.establishment_cents),
        status: c.status,
      })),
      pedidosPublicos: pedidos.map((p) => p.id),
    };
  }

  /** O resumo gravado na auditoria da unificação (para o reenvio). */
  private async transferidoGravado(
    manager: EntityManager,
    tenantId: string,
    secundarioId: string,
    principalId: string,
  ): Promise<ResumoDaTransferencia> {
    const [linha] = linhasDe<{ transferido: ResumoDaTransferencia | null }>(
      await manager.query(
        `SELECT new_data -> 'transferido' AS transferido FROM audit_logs
          WHERE tenant_id = $1 AND action = 'CONSUMER_MERGED'
            AND new_data ->> 'secundarioId' = $2 AND new_data ->> 'principalId' = $3
          ORDER BY occurred_at DESC, id DESC
          LIMIT 1`,
        [tenantId, secundarioId, principalId],
      ),
    );
    return linha?.transferido ?? RESUMO_VAZIO;
  }
}
