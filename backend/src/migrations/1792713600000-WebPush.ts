// Notificações Web Push de NOVAS solicitações do agendamento online para a
// equipe (ver docs/plans/agendamento-publico-e-notificacoes.md, "Web Push").
//
// 1. `push_subscriptions`: UMA inscrição de navegador (o `endpoint` que o
//    serviço de push do aparelho entregou) para UM usuário num estabelecimento
//    em que ele TEM vínculo, criada a partir de UMA sessão.
//    - FK composta `(user_id, tenant_id)` → `memberships (user_id, tenant_id)`
//      com CASCADE: remover o vínculo apaga a inscrição.
//    - `session_id` → `sessions` com CASCADE: o envio só vale enquanto a
//      sessão que ativou estiver viva (não revogada, não vencida). Sair da
//      conta desliga as notificações daquele aparelho sem depender do
//      navegador avisar.
//    - `endpoint_hash` (SHA-256 do endpoint) é a chave de busca: o endpoint
//      é uma credencial de entrega e nunca aparece em log nem em índice.
//      `(endpoint_hash, tenant_id)` UNIQUE: o mesmo aparelho tem uma linha
//      por estabelecimento; outro usuário no mesmo aparelho TOMA o endpoint
//      (as linhas do anterior são revogadas pelo serviço).
//
// 2. `booking_request_alerts`: o EVENTO "chegou uma solicitação nova",
//    gravado na MESMA transação do pedido público. Rollback do pedido = sem
//    evento. `dedupe_key` UNIQUE: repetir o envio com a mesma chave de
//    idempotência devolve o mesmo pedido e não cria outro evento. O envio
//    acontece depois do commit; `not_after` é o prazo (evento velho expira
//    em vez de avisar fora de hora); `locked_by`/`locked_until` é a
//    concessão de quem está enviando (processo que morre libera a linha).
//
// 3. `push_deliveries`: cada tentativa para cada aparelho, com o resultado.
//    `ACCEPTED` = o serviço de push ACEITOU a mensagem (HTTP 201). NÃO é
//    prova de que o aparelho exibiu a notificação.
//
// Sem entidade TypeORM, como `notification_jobs` e `public_booking_*`: as
// specs estruturais comparam cada entidade com a migration inicial. Acesso
// por SQL explícito em src/push/, provado contra o PostgreSQL descartável
// (test/push-postgres.db-e2e-spec.ts).
import type { MigrationInterface, QueryRunner } from 'typeorm';

const STATUS_DA_INSCRICAO = ['ACTIVE', 'REVOKED', 'EXPIRED'] as const;
const STATUS_DO_ALERTA = ['PENDING', 'PROCESSING', 'DONE', 'EXPIRED'] as const;
const STATUS_DA_ENTREGA = ['SENDING', 'ACCEPTED', 'RETRY', 'FAILED', 'GONE', 'SKIPPED'] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export class WebPush1792713600000 implements MigrationInterface {
  name = 'WebPush1792713600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE push_subscriptions (
        id varchar(30) NOT NULL,
        user_id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        session_id varchar(30) NOT NULL,
        endpoint varchar(2048) NOT NULL,
        endpoint_hash char(64) NOT NULL,
        p256dh varchar(200) NOT NULL,
        auth varchar(100) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'ACTIVE',
        revoked_reason varchar(40) NULL,
        failure_count integer NOT NULL DEFAULT 0,
        last_success_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_push_subscriptions PRIMARY KEY (id),
        CONSTRAINT uq_push_subscriptions_endpoint_tenant UNIQUE (endpoint_hash, tenant_id),
        CONSTRAINT fk_push_subscriptions_membership FOREIGN KEY (user_id, tenant_id)
          REFERENCES memberships (user_id, tenant_id) ON DELETE CASCADE,
        CONSTRAINT fk_push_subscriptions_session FOREIGN KEY (session_id)
          REFERENCES sessions (id) ON DELETE CASCADE,
        CONSTRAINT ck_push_subscriptions_status CHECK (status IN (${lista(STATUS_DA_INSCRICAO)})),
        CONSTRAINT ck_push_subscriptions_failure_count CHECK (failure_count >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_push_subscriptions_tenant_status ON push_subscriptions (tenant_id, status)`,
    );
    await queryRunner.query(`CREATE INDEX idx_push_subscriptions_endpoint_hash ON push_subscriptions (endpoint_hash)`);
    await queryRunner.query(`CREATE INDEX idx_push_subscriptions_session ON push_subscriptions (session_id)`);

    await queryRunner.query(`
      CREATE TABLE booking_request_alerts (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        appointment_id varchar(30) NOT NULL,
        dedupe_key varchar(160) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'PENDING',
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz(3) NOT NULL,
        not_after timestamptz(3) NOT NULL,
        locked_by varchar(80) NULL,
        locked_until timestamptz(3) NULL,
        outcome_reason varchar(40) NULL,
        finished_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_booking_request_alerts PRIMARY KEY (id),
        CONSTRAINT uq_booking_request_alerts_dedupe_key UNIQUE (dedupe_key),
        CONSTRAINT fk_booking_request_alerts_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT fk_booking_request_alerts_tenant_appointment FOREIGN KEY (tenant_id, appointment_id)
          REFERENCES appointments (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT ck_booking_request_alerts_status CHECK (status IN (${lista(STATUS_DO_ALERTA)})),
        CONSTRAINT ck_booking_request_alerts_attempts CHECK (attempts >= 0),
        CONSTRAINT ck_booking_request_alerts_window CHECK (not_after >= next_attempt_at)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_booking_request_alerts_status_next ON booking_request_alerts (status, next_attempt_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE push_deliveries (
        id varchar(30) NOT NULL,
        alert_id varchar(30) NOT NULL,
        subscription_id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        status varchar(20) NOT NULL,
        attempts integer NOT NULL DEFAULT 1,
        http_status integer NULL,
        outcome_reason varchar(40) NULL,
        accepted_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_push_deliveries PRIMARY KEY (id),
        CONSTRAINT uq_push_deliveries_alert_subscription UNIQUE (alert_id, subscription_id),
        CONSTRAINT fk_push_deliveries_alert FOREIGN KEY (alert_id)
          REFERENCES booking_request_alerts (id) ON DELETE CASCADE,
        CONSTRAINT fk_push_deliveries_subscription FOREIGN KEY (subscription_id)
          REFERENCES push_subscriptions (id) ON DELETE CASCADE,
        CONSTRAINT ck_push_deliveries_status CHECK (status IN (${lista(STATUS_DA_ENTREGA)})),
        CONSTRAINT ck_push_deliveries_attempts CHECK (attempts >= 1)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE push_deliveries`);
    await queryRunner.query(`DROP TABLE booking_request_alerts`);
    await queryRunner.query(`DROP TABLE push_subscriptions`);
  }
}
