// "Recebe comissão" e regra geral por profissional (ver
// docs/plans/comissoes-regra-geral.md). Só acréscimos: nenhuma linha
// existente muda e nada de ProfessionalCommissions1793491200000 é alterado.
//
// 1. `professional_commission_settings`: no máximo uma linha por
//    (estabelecimento, profissional).
//    - `receives_commission`: o dono decide se o profissional recebe.
//      Desligado, nenhuma apuração nova é gravada para ele, mesmo com regras
//      por serviço guardadas.
//    - `default_type`/`default_value`: a regra geral, opcional, na mesma
//      representação de `commission_rules` (`PERCENTAGE` em pontos-base,
//      `FIXED` em centavos por serviço realizado). Não existe regra geral
//      "sem comissão": para isso, desligar.
//
//    SEM LINHA = estado de antes desta migration: recebe, sem regra geral.
//    Não há preenchimento: todo profissional existente continua exatamente
//    como estava, e "não configurada" continua sem valor (nunca zero). Só o
//    cadastro de profissional pela API nova grava, na mesma transação, a
//    linha desligada. Um profissional criado pela API anterior (janela entre
//    a migration e a publicação da API) fica sem linha, como a API anterior
//    o tratava.
//
// 2. `commission_entries.applied_rule_scope`: de onde veio a regra aplicada
//    na apuração (`SERVICE` = exceção do serviço, `DEFAULT` = regra geral).
//    Linhas anteriores ficam NULL: regra por serviço do modelo antigo (com
//    `applied_type`) ou item sem regra (sem `applied_type`). Não há escopo
//    sem regra aplicada.
//
// O `down` só é seguro sem dado novo: recusa se houver configuração gravada
// ou apuração com escopo, em vez de apagar histórico.
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const COMMISSION_SETTINGS_TABLE = 'professional_commission_settings';

export class ProfessionalCommissionSettings1793577600000 implements MigrationInterface {
  name = 'ProfessionalCommissionSettings1793577600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE professional_commission_settings (
        tenant_id varchar(30) NOT NULL,
        professional_id varchar(30) NOT NULL,
        receives_commission boolean NOT NULL,
        default_type commission_type NULL,
        default_value integer NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_professional_commission_settings PRIMARY KEY (tenant_id, professional_id),
        CONSTRAINT fk_professional_commission_settings_tenant_professional
          FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE CASCADE,
        CONSTRAINT ck_professional_commission_settings_default_pair
          CHECK ((default_type IS NULL) = (default_value IS NULL)),
        CONSTRAINT ck_professional_commission_settings_default_range
          CHECK (default_type IS NULL OR (default_type = 'PERCENTAGE' AND default_value BETWEEN 1 AND 10000)
            OR (default_type = 'FIXED' AND default_value BETWEEN 1 AND 100000000))
      )`,
    );
    await queryRunner.query(`ALTER TABLE commission_entries ADD COLUMN applied_rule_scope varchar(10) NULL`);
    await queryRunner.query(
      `ALTER TABLE commission_entries ADD CONSTRAINT ck_commission_entries_applied_rule_scope
        CHECK (applied_rule_scope IS NULL OR (applied_rule_scope IN ('SERVICE', 'DEFAULT') AND applied_type IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [novas] = (await queryRunner.query(
      `SELECT (SELECT count(*) FROM professional_commission_settings)::int
            + (SELECT count(*) FROM commission_entries WHERE applied_rule_scope IS NOT NULL)::int AS total`,
    )) as { total: number }[];
    if (novas.total > 0) {
      throw new Error('Há configuração de comissão por profissional ou apuração com escopo; o down apagaria histórico e foi recusado.');
    }
    await queryRunner.query(`ALTER TABLE commission_entries DROP CONSTRAINT ck_commission_entries_applied_rule_scope`);
    await queryRunner.query(`ALTER TABLE commission_entries DROP COLUMN applied_rule_scope`);
    await queryRunner.query(`DROP TABLE professional_commission_settings`);
  }
}
