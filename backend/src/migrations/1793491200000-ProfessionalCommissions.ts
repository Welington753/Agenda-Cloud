// Comissão por profissional e serviço (ver
// docs/plans/comissoes-profissional-servico.md). Reaproveita as duas tabelas
// que a migration inicial já criou e que nenhum código gravava até aqui:
//
// - `commission_rules` fica como está: uma regra por (estabelecimento,
//   profissional, serviço), `PERCENTAGE` em pontos-base ou `FIXED` em
//   centavos. "Sem comissão" é uma regra gravada com `PERCENTAGE` 0; "não
//   configurada" é a ausência de regra.
// - `commission_entries` passa a ter UMA LINHA POR SERVIÇO DA RESERVA
//   (`appointment_item_id`), não uma por reserva: uma reserva com vários
//   serviços soma as comissões dos itens. Cada linha é a fotografia do que
//   valia na conclusão (preço do item, regra aplicada e valor calculado) e
//   nunca é recalculada.
//
// O que muda em `commission_entries`:
// 1. `appointment_item_id` (anulável, FK composta com o tenant). Uma linha
//    por item, garantida por índice único. Linhas antigas, sem item,
//    continuam limitadas a uma por reserva (o índice único anterior vira
//    parcial, só para elas).
// 2. Preço, regra e valores passam a aceitar NULL, para gravar o que de fato
//    houve na conclusão sem inventar número: item "sob consulta" (sem preço),
//    serviço sem regra ("não configurada") e comissão que não dá para
//    calcular (percentual sobre preço desconhecido). Regra tudo-ou-nada:
//    tipo e valor juntos.
//
// `audit_action` ganha `COMMISSION_RULE_CHANGED`, e `permission` ganha
// `COMISSOES_PROPRIAS_VISUALIZAR` (concessão do dono ao funcionário para ver
// só as próprias comissões, separada de `COMISSOES_VISUALIZAR`, que só
// restringe o dono). `ADD VALUE` não é usado na mesma transação, como nas
// migrations anteriores, e não pode ser desfeito: o `down` deixa os valores.
//
// Nenhuma linha existente muda. O `down` só é seguro sem linhas novas (sem
// item ou com valores nulos): ele recusa em vez de apagar histórico.
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const COMMISSION_AUDIT_ACTIONS = ['COMMISSION_RULE_CHANGED'] as const;
export const COMMISSION_PERMISSIONS = ['COMISSOES_PROPRIAS_VISUALIZAR'] as const;

export class ProfessionalCommissions1793491200000 implements MigrationInterface {
  name = 'ProfessionalCommissions1793491200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of COMMISSION_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }
    for (const permission of COMMISSION_PERMISSIONS) {
      await queryRunner.query(`ALTER TYPE permission ADD VALUE IF NOT EXISTS '${permission}'`);
    }
    await queryRunner.query(
      `ALTER TABLE appointment_items ADD CONSTRAINT uq_appointment_items_tenant_id UNIQUE (tenant_id, id)`,
    );
    await queryRunner.query(`ALTER TABLE commission_entries ADD COLUMN appointment_item_id varchar(30) NULL`);
    await queryRunner.query(
      `ALTER TABLE commission_entries ADD CONSTRAINT fk_commission_entries_tenant_appointment_item
        FOREIGN KEY (tenant_id, appointment_item_id) REFERENCES appointment_items (tenant_id, id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(`DROP INDEX uq_commission_entries_appointment_id`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_commission_entries_appointment_id ON commission_entries (appointment_id)
        WHERE appointment_item_id IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_commission_entries_appointment_item_id ON commission_entries (appointment_item_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_commission_entries_tenant_id_appointment_id ON commission_entries (tenant_id, appointment_id)`,
    );
    for (const coluna of ['price_cents_snapshot', 'applied_type', 'applied_value', 'professional_cents', 'establishment_cents']) {
      await queryRunner.query(`ALTER TABLE commission_entries ALTER COLUMN ${coluna} DROP NOT NULL`);
    }
    await queryRunner.query(
      `ALTER TABLE commission_entries ADD CONSTRAINT ck_commission_entries_rule_snapshot
        CHECK ((applied_type IS NULL) = (applied_value IS NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [novas] = (await queryRunner.query(
      `SELECT count(*)::int AS total FROM commission_entries
        WHERE appointment_item_id IS NOT NULL OR price_cents_snapshot IS NULL OR applied_type IS NULL
          OR professional_cents IS NULL OR establishment_cents IS NULL`,
    )) as { total: number }[];
    if (novas.total > 0) {
      throw new Error('commission_entries tem apurações por item; o down apagaria histórico e foi recusado.');
    }
    await queryRunner.query(`ALTER TABLE commission_entries DROP CONSTRAINT ck_commission_entries_rule_snapshot`);
    for (const coluna of ['price_cents_snapshot', 'applied_type', 'applied_value', 'professional_cents', 'establishment_cents']) {
      await queryRunner.query(`ALTER TABLE commission_entries ALTER COLUMN ${coluna} SET NOT NULL`);
    }
    await queryRunner.query(`DROP INDEX idx_commission_entries_tenant_id_appointment_id`);
    await queryRunner.query(`DROP INDEX uq_commission_entries_appointment_item_id`);
    await queryRunner.query(`DROP INDEX uq_commission_entries_appointment_id`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_commission_entries_appointment_id ON commission_entries (appointment_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE commission_entries DROP CONSTRAINT fk_commission_entries_tenant_appointment_item`,
    );
    await queryRunner.query(`ALTER TABLE commission_entries DROP COLUMN appointment_item_id`);
    await queryRunner.query(`ALTER TABLE appointment_items DROP CONSTRAINT uq_appointment_items_tenant_id`);
    // Os valores novos de `audit_action` e `permission` ficam: o Postgres não
    // remove valor de enum, e o histórico pode citá-los.
  }
}
