// Base das notificações automáticas (confirmação e lembretes pelo WhatsApp).
// Ver docs/plans/agendamento-publico-e-notificacoes.md, seção "Lote E".
//
// 1. `consumers`: autorização de contato pelo WhatsApp. As três colunas nascem
//    NULAS para TODO cliente existente: ninguém é considerado autorizado por
//    migration. Sem `whatsapp_opt_in_at`, nada é enviado (o envio confere isso
//    na hora, ver notification-dispatcher.ts).
//
// 2. `notification_jobs`: cada linha é UMA mensagem programada para UMA
//    reserva. É gravada na MESMA transação da mudança da reserva (criação
//    confirmada, confirmação, cancelamento, remarcação, mudança de status) e
//    lida depois por um executor — nenhuma chamada externa acontece dentro
//    daquela transação.
//
//    - `dedupe_key` UNIQUE: confirmar duas vezes, ou o mesmo lembrete
//      programado de novo, nunca vira duas linhas.
//    - `appointment_start_at`: o início da reserva PARA O QUAL a mensagem foi
//      programada. Antes de enviar, o executor confere que ainda é o início
//      vigente.
//    - `not_after`: prazo. Executor atrasado (serviço hibernado, fila parada)
//      não manda lembrete fora de hora.
//    - `status` distingue programada (`SCHEDULED`), reservada por um executor
//      (`PROCESSING`), em envio (`SENDING`), aceita pelo provedor (`SENT`),
//      entrega confirmada (`DELIVERED`), resultado incerto (`UNCERTAIN`),
//      falha (`FAILED`), pulada na conferência (`SKIPPED`) e invalidada por
//      mudança na reserva (`CANCELED`).
//    - `locked_by`/`locked_until`: concessão por tempo. Executor que morre
//      no meio libera a linha quando a concessão vence.
//
//    FK composta `(tenant_id, appointment_id)`, como as demais tabelas filhas
//    de `appointments`: uma tarefa nunca aponta para reserva de outro
//    estabelecimento.
//
// Sem entidade TypeORM de propósito: o acesso é por SQL explícito em
// src/notifications/notification-jobs.repository.ts. As specs estruturais do
// Lote 3 comparam CADA entidade com a migration inicial; esta tabela é
// infraestrutura de envio, não domínio, e é provada contra o PostgreSQL real
// (test/notifications-postgres.db-e2e-spec.ts).
import type { MigrationInterface, QueryRunner } from 'typeorm';

const NOTIFICATION_KINDS = ['CONFIRMATION', 'REMINDER_DAY_BEFORE', 'REMINDER_2H'] as const;
const NOTIFICATION_STATUSES = [
  'SCHEDULED',
  'PROCESSING',
  'SENDING',
  'SENT',
  'DELIVERED',
  'UNCERTAIN',
  'FAILED',
  'SKIPPED',
  'CANCELED',
] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export class NotificationJobs1792540800000 implements MigrationInterface {
  name = 'NotificationJobs1792540800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE consumers
        ADD COLUMN whatsapp_opt_in_at timestamptz(3) NULL,
        ADD COLUMN whatsapp_opt_in_source varchar(40) NULL,
        ADD COLUMN whatsapp_opt_out_at timestamptz(3) NULL
    `);

    await queryRunner.query(`
      CREATE TABLE notification_jobs (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        appointment_id varchar(30) NOT NULL,
        kind varchar(30) NOT NULL,
        channel varchar(20) NOT NULL DEFAULT 'WHATSAPP',
        appointment_start_at timestamptz(3) NOT NULL,
        scheduled_for timestamptz(3) NOT NULL,
        not_after timestamptz(3) NOT NULL,
        dedupe_key varchar(160) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'SCHEDULED',
        attempts integer NOT NULL DEFAULT 0,
        locked_by varchar(80) NULL,
        locked_until timestamptz(3) NULL,
        provider_message_id varchar(160) NULL,
        outcome_reason varchar(40) NULL,
        last_error varchar(500) NULL,
        sent_at timestamptz(3) NULL,
        delivered_at timestamptz(3) NULL,
        finished_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_notification_jobs PRIMARY KEY (id),
        CONSTRAINT uq_notification_jobs_dedupe_key UNIQUE (dedupe_key),
        CONSTRAINT fk_notification_jobs_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT fk_notification_jobs_tenant_appointment FOREIGN KEY (tenant_id, appointment_id)
          REFERENCES appointments (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT ck_notification_jobs_kind CHECK (kind IN (${lista(NOTIFICATION_KINDS)})),
        CONSTRAINT ck_notification_jobs_status CHECK (status IN (${lista(NOTIFICATION_STATUSES)})),
        CONSTRAINT ck_notification_jobs_attempts CHECK (attempts >= 0),
        CONSTRAINT ck_notification_jobs_window CHECK (not_after >= scheduled_for)
      )
    `);

    // Busca do executor: o que está vencido, em ordem.
    await queryRunner.query(
      `CREATE INDEX idx_notification_jobs_status_scheduled_for ON notification_jobs (status, scheduled_for)`,
    );
    // Invalidação ao mudar a reserva.
    await queryRunner.query(
      `CREATE INDEX idx_notification_jobs_tenant_appointment ON notification_jobs (tenant_id, appointment_id)`,
    );
    // Retorno do provedor (entrega) localiza a linha pelo id da mensagem.
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_notification_jobs_provider_message_id ON notification_jobs (provider_message_id) WHERE provider_message_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE notification_jobs`);
    await queryRunner.query(`
      ALTER TABLE consumers
        DROP COLUMN whatsapp_opt_out_at,
        DROP COLUMN whatsapp_opt_in_source,
        DROP COLUMN whatsapp_opt_in_at
    `);
  }
}
