// Agendamento público real (Lote A) e solicitações pendentes no painel.
// Ver docs/plans/agendamento-publico-e-notificacoes.md, seções 3 e 5.
//
// 1. `public_booking_settings`: o estabelecimento LIGOU o agendamento
//    público? Uma linha por tenant, criada só quando o DONO liga ou desliga
//    pela área real. Ausência de linha = desligado: nenhum estabelecimento
//    existente passa a ter página pública por causa desta migration.
//
//    Por que não `public_settings.is_published`: aquela coluna nasce
//    `DEFAULT true` e a linha exige `operating_days`/`open_time`/
//    `close_time` da demonstração. Reaproveitá-la exporia por padrão quem
//    nunca pediu, e obrigaria a inventar horários que a API real não usa.
//
// 2. `public_booking_requests`: UMA linha por pedido público aceito,
//    gravada na MESMA transação da reserva (`appointments`, sempre
//    `PENDING`). Serve para:
//    - distinguir no painel o pedido online da reserva criada pela agenda;
//    - os limites por telefone (pedidos por dia e pendentes simultâneos),
//      contados no banco — sobrevivem a reinício do processo;
//    - o reenvio honesto: `(tenant_id, idempotency_key)` UNIQUE devolve o
//      MESMO pedido quando o navegador repete um envio cuja resposta se
//      perdeu, em vez de criar outro. `payload_hash` impede que a mesma chave
//      seja usada para um pedido diferente.
//
//    `phone_normalized` é o telefone informado no pedido (normalizado), não
//    uma cópia do cadastro do cliente: o limite vale por quem pede.
//
// Sem entidade TypeORM, mesmo motivo de 1792540800000-NotificationJobs: as
// specs estruturais comparam cada entidade com a migration inicial. Acesso
// por SQL explícito em src/public-booking/public-booking.repository.ts,
// provado contra o PostgreSQL descartável
// (test/public-booking-postgres.db-e2e-spec.ts).
//
// NADA aqui muda a constraint `appointments_no_overlap_excl` nem o que
// ocupa a agenda: um pedido pendente ocupa o horário como qualquer reserva
// `PENDING`, até ser confirmado ou recusado (cancelado).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PublicBooking1792627200000 implements MigrationInterface {
  name = 'PublicBooking1792627200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE public_booking_settings (
        tenant_id varchar(30) NOT NULL,
        enabled boolean NOT NULL DEFAULT false,
        updated_by varchar(30) NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_public_booking_settings PRIMARY KEY (tenant_id),
        CONSTRAINT fk_public_booking_settings_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE public_booking_requests (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        appointment_id varchar(30) NOT NULL,
        phone_normalized varchar(20) NOT NULL,
        idempotency_key varchar(64) NOT NULL,
        payload_hash char(64) NOT NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_public_booking_requests PRIMARY KEY (id),
        CONSTRAINT uq_public_booking_requests_appointment UNIQUE (appointment_id),
        CONSTRAINT uq_public_booking_requests_tenant_key UNIQUE (tenant_id, idempotency_key),
        CONSTRAINT fk_public_booking_requests_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT fk_public_booking_requests_tenant_appointment FOREIGN KEY (tenant_id, appointment_id)
          REFERENCES appointments (tenant_id, id) ON DELETE CASCADE
      )
    `);

    // Limites por telefone: pedidos recentes deste telefone neste tenant.
    await queryRunner.query(
      `CREATE INDEX idx_public_booking_requests_tenant_phone_created ON public_booking_requests (tenant_id, phone_normalized, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE public_booking_requests`);
    await queryRunner.query(`DROP TABLE public_booking_settings`);
  }
}
