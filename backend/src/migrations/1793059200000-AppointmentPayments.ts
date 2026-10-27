// Recebimentos manuais de atendimentos (ver
// docs/plans/operacao-diaria-configuracoes.md, PR 3). Só ACRESCENTA: uma
// tabela nova e valores novos no histórico. Nenhuma linha existente muda.
//
// Um recebimento é a QUITAÇÃO INTEGRAL de um atendimento, registrada à mão
// pelo dono: valor efetivamente pago (centavos, inteiro), forma de pagamento,
// data do recebimento (data local do estabelecimento) e quem registrou. Não
// é cobrança automática, nota fiscal nem integração bancária, e não tem
// relação com a mensalidade que o estabelecimento paga à plataforma.
//
// ESTORNO: integral, com motivo, data e quem estornou, gravado NA MESMA
// LINHA (o lançamento original nunca é apagado nem tem o valor alterado). O
// histórico (`audit_logs`) registra as duas ações.
//
// GARANTIAS NO BANCO:
// - no máximo um recebimento NÃO estornado por atendimento
//   (`uq_appointment_payments_active`): duas quitações simultâneas do mesmo
//   atendimento nunca passam as duas;
// - a chave do formulário é única por quem registrou (reenvio idempotente);
// - FK composta com o tenant (o atendimento é do mesmo estabelecimento);
// - estorno tudo-ou-nada (data, motivo e autor juntos).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const PAYMENT_AUDIT_ACTIONS = ['PAYMENT_RECORDED', 'PAYMENT_REFUNDED'] as const;

/** Formas de pagamento aceitas no registro manual. */
export const PAYMENT_METHODS = ['PIX', 'DINHEIRO', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'TRANSFERENCIA', 'OUTRO'] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export class AppointmentPayments1793059200000 implements MigrationInterface {
  name = 'AppointmentPayments1793059200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of PAYMENT_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }
    await queryRunner.query(`
      CREATE TABLE appointment_payments (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        appointment_id varchar(30) NOT NULL,
        amount_cents bigint NOT NULL,
        method varchar(20) NOT NULL,
        received_on date NOT NULL,
        recorded_at timestamptz(3) NOT NULL DEFAULT now(),
        recorded_by_user_id varchar(30) NOT NULL,
        request_key varchar(80) NOT NULL,
        notes varchar(300) NULL,
        refunded_at timestamptz(3) NULL,
        refunded_on date NULL,
        refund_reason varchar(300) NULL,
        refunded_by_user_id varchar(30) NULL,
        CONSTRAINT pk_appointment_payments PRIMARY KEY (id),
        CONSTRAINT uq_appointment_payments_tenant_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_appointment_payments_appointment FOREIGN KEY (tenant_id, appointment_id)
          REFERENCES appointments (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_appointment_payments_recorded_by FOREIGN KEY (recorded_by_user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT fk_appointment_payments_refunded_by FOREIGN KEY (refunded_by_user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_appointment_payments_amount CHECK (amount_cents > 0 AND amount_cents <= 100000000),
        CONSTRAINT ck_appointment_payments_method CHECK (method IN (${lista(PAYMENT_METHODS)})),
        CONSTRAINT ck_appointment_payments_refund CHECK (
          (refunded_at IS NULL AND refunded_on IS NULL AND refund_reason IS NULL AND refunded_by_user_id IS NULL)
          OR (refunded_at IS NOT NULL AND refunded_on IS NOT NULL AND refund_reason IS NOT NULL
              AND refunded_by_user_id IS NOT NULL AND refunded_on >= received_on)
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_appointment_payments_active ON appointment_payments (tenant_id, appointment_id)
        WHERE refunded_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_appointment_payments_request_key ON appointment_payments (recorded_by_user_id, request_key)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_appointment_payments_tenant_received ON appointment_payments (tenant_id, received_on)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_appointment_payments_tenant_refunded ON appointment_payments (tenant_id, refunded_on)
        WHERE refunded_on IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE appointment_payments`);
    // Os valores novos de `audit_action` ficam: o PostgreSQL não remove valor
    // de enum, e o histórico já gravado continua legível.
  }
}
