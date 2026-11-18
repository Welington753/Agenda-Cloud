// Estoque v1, parte 2 de 2 (ver docs/plans/estoque-v1.md). Exige a parte 1
// (`StockEnumValues1794009600000`) JÁ CONFIRMADA: a primeira instrução usa os
// valores novos dos enums e, se a 21 rodou na mesma transação (modo `all`
// com as duas pendentes) ou não rodou, falha com mensagem clara e nada fica
// gravado.
//
// 1. Tabelas do estoque, todas com `tenant_id` e FK composta com o
//    estabelecimento (um id de outro estabelecimento nunca fecha a FK):
//    - `stock_categories` e `stock_subcategories` (um nível só, pela
//      estrutura: a subcategoria aponta para a categoria, nunca para outra
//      subcategoria);
//    - `stock_products`: categoria OBRIGATÓRIA
//      (`fk_stock_products_category`) e subcategoria opcional DA MESMA
//      categoria (`fk_stock_products_subcategory`, composta com a
//      categoria); saldo copiado no produto, nunca negativo;
//    - `stock_movements` (só inserção), `stock_counts` e
//      `stock_count_items` (só inserção).
//    Quantidades em milésimos (`*_milli bigint`); unidade de contagem só
//    aceita múltiplos de 1000.
// 2. O recurso `ESTOQUE` em `features` e o vínculo do adicional ESTOQUE do
//    catálogo com ele, já disponível para contratação. Nome, descrição e
//    preço do adicional NÃO mudam. Nenhum plano ganha o recurso
//    (`plan_features`) e nenhum estabelecimento ganha override: o estoque só
//    liga pela assinatura, no portal.
//
// Tipos em `varchar` com CHECK (sem enum novo), como em `addon_modules`.
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { STOCK_AUDIT_ACTIONS, STOCK_FEATURE_KEY, STOCK_PERMISSIONS } from './1794009600000-StockEnumValues.js';

export const STOCK_FEATURE_ID = 'feat_estoque';
export const STOCK_FEATURE_LABEL = 'Controle de estoque';
export const STOCK_ADDON_CODE = 'ESTOQUE';

/** Unidades e casas decimais permitidas (sem conversão entre elas). */
export const STOCK_UNITS = ['UN', 'CX', 'PCT', 'FR', 'G', 'ML', 'KG', 'L'] as const;
export const STOCK_DECIMAL_UNITS = ['KG', 'L'] as const;
export const STOCK_PURPOSES = ['VENDA', 'CONSUMO_INTERNO', 'AMBOS'] as const;
export const STOCK_MOVEMENT_KINDS = [
  'SALDO_INICIAL',
  'ENTRADA_COMPRA',
  'SAIDA_VENDA',
  'SAIDA_CONSUMO',
  'SAIDA_PERDA',
  'AJUSTE_CONFERENCIA',
  'ESTORNO',
] as const;

/** Milésimos por unidade: 1 UN = 1000; 1,5 KG = 1500. */
export const MILLI = 1000;
/** Teto de uma movimentação: 1.000.000 unidades. */
export const MAX_MOVEMENT_MILLI = 1_000_000 * MILLI;
/** Teto do saldo e do estoque mínimo: 1.000.000.000 unidades. */
export const MAX_BALANCE_MILLI = 1_000_000_000 * MILLI;

export const STOCK_TABLES = [
  'stock_count_items',
  'stock_movements',
  'stock_counts',
  'stock_products',
  'stock_subcategories',
  'stock_categories',
] as const;

export const STOCK_ENUMS_NOT_COMMITTED_MESSAGE =
  'A migration StockEnumValues1794009600000 precisa estar confirmada antes desta; ' +
  "use o modo de transação 'each' ou aplique uma migration por vez.";

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');
const decimais = lista(STOCK_DECIMAL_UNITS);
/** Quantidade inteira quando a unidade não aceita casas. */
const inteiraNaUnidade = (coluna: string) => `(unit IN (${decimais}) OR ${coluna} % ${MILLI} = 0)`;

export class StockModule1794096000000 implements MigrationInterface {
  name = 'StockModule1794096000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await conferirEnumsConfirmados(queryRunner);

    await queryRunner.query(`
      CREATE TABLE stock_categories (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        name varchar(60) NOT NULL,
        archived_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_stock_categories PRIMARY KEY (id),
        CONSTRAINT uq_stock_categories_tenant_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_stock_categories_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT ck_stock_categories_name CHECK (length(btrim(name)) >= 1)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_stock_categories_name ON stock_categories (tenant_id, lower(name))`,
    );

    await queryRunner.query(`
      CREATE TABLE stock_subcategories (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        category_id varchar(30) NOT NULL,
        name varchar(60) NOT NULL,
        archived_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_stock_subcategories PRIMARY KEY (id),
        CONSTRAINT uq_stock_subcategories_tenant_category_id UNIQUE (tenant_id, category_id, id),
        CONSTRAINT fk_stock_subcategories_category FOREIGN KEY (tenant_id, category_id)
          REFERENCES stock_categories (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_stock_subcategories_name CHECK (length(btrim(name)) >= 1)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_stock_subcategories_name ON stock_subcategories (tenant_id, category_id, lower(name))`,
    );

    await queryRunner.query(`
      CREATE TABLE stock_products (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        category_id varchar(30) NOT NULL,
        subcategory_id varchar(30) NULL,
        name varchar(80) NOT NULL,
        description varchar(500) NULL,
        internal_code varchar(40) NULL,
        purpose varchar(20) NOT NULL,
        unit varchar(4) NOT NULL,
        min_quantity_milli bigint NOT NULL DEFAULT 0,
        balance_milli bigint NOT NULL DEFAULT 0,
        balance_version integer NOT NULL DEFAULT 0,
        archived_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        created_by_user_id varchar(30) NOT NULL,
        request_key varchar(80) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        CONSTRAINT pk_stock_products PRIMARY KEY (id),
        CONSTRAINT uq_stock_products_tenant_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_stock_products_category FOREIGN KEY (tenant_id, category_id)
          REFERENCES stock_categories (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_products_subcategory FOREIGN KEY (tenant_id, category_id, subcategory_id)
          REFERENCES stock_subcategories (tenant_id, category_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_products_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_stock_products_name CHECK (length(btrim(name)) >= 1),
        CONSTRAINT ck_stock_products_purpose CHECK (purpose IN (${lista(STOCK_PURPOSES)})),
        CONSTRAINT ck_stock_products_unit CHECK (unit IN (${lista(STOCK_UNITS)})),
        CONSTRAINT ck_stock_products_balance CHECK (balance_milli >= 0 AND balance_milli <= ${MAX_BALANCE_MILLI}),
        CONSTRAINT ck_stock_products_min CHECK (min_quantity_milli >= 0 AND min_quantity_milli <= ${MAX_BALANCE_MILLI}),
        CONSTRAINT ck_stock_products_precision CHECK (${inteiraNaUnidade('balance_milli')} AND ${inteiraNaUnidade('min_quantity_milli')}),
        CONSTRAINT ck_stock_products_version CHECK (balance_version >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_stock_products_internal_code ON stock_products (tenant_id, lower(internal_code))
        WHERE internal_code IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_stock_products_request_key ON stock_products (created_by_user_id, request_key)`,
    );
    await queryRunner.query(`CREATE INDEX idx_stock_products_tenant_name ON stock_products (tenant_id, lower(name))`);
    await queryRunner.query(
      `CREATE INDEX idx_stock_products_tenant_category ON stock_products (tenant_id, category_id, subcategory_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE stock_counts (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        note varchar(300) NULL,
        recorded_by_user_id varchar(30) NOT NULL,
        recorded_at timestamptz(3) NOT NULL DEFAULT now(),
        request_key varchar(80) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        CONSTRAINT pk_stock_counts PRIMARY KEY (id),
        CONSTRAINT uq_stock_counts_tenant_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_stock_counts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_counts_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES users (id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_stock_counts_request_key ON stock_counts (recorded_by_user_id, request_key)`,
    );
    await queryRunner.query(`CREATE INDEX idx_stock_counts_tenant_recorded ON stock_counts (tenant_id, recorded_at DESC, id DESC)`);

    await queryRunner.query(`
      CREATE TABLE stock_movements (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        product_id varchar(30) NOT NULL,
        kind varchar(30) NOT NULL,
        quantity_milli bigint NOT NULL,
        delta_milli bigint NOT NULL,
        balance_before_milli bigint NOT NULL,
        balance_after_milli bigint NOT NULL,
        unit varchar(4) NOT NULL,
        reason varchar(300) NULL,
        reverses_movement_id varchar(30) NULL,
        count_id varchar(30) NULL,
        recorded_by_user_id varchar(30) NOT NULL,
        recorded_at timestamptz(3) NOT NULL DEFAULT now(),
        request_key varchar(80) NULL,
        request_fingerprint char(64) NULL,
        CONSTRAINT pk_stock_movements PRIMARY KEY (id),
        CONSTRAINT uq_stock_movements_tenant_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_stock_movements_product FOREIGN KEY (tenant_id, product_id)
          REFERENCES stock_products (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_movements_reverses FOREIGN KEY (tenant_id, reverses_movement_id)
          REFERENCES stock_movements (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_movements_count FOREIGN KEY (tenant_id, count_id)
          REFERENCES stock_counts (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_movements_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_stock_movements_kind CHECK (kind IN (${lista(STOCK_MOVEMENT_KINDS)})),
        CONSTRAINT ck_stock_movements_unit CHECK (unit IN (${lista(STOCK_UNITS)})),
        CONSTRAINT ck_stock_movements_quantity CHECK (
          quantity_milli > 0 AND quantity_milli <= ${MAX_BALANCE_MILLI} AND quantity_milli = abs(delta_milli)
        ),
        CONSTRAINT ck_stock_movements_balance CHECK (
          balance_after_milli = balance_before_milli + delta_milli
          AND balance_before_milli >= 0 AND balance_after_milli >= 0 AND balance_after_milli <= ${MAX_BALANCE_MILLI}
        ),
        CONSTRAINT ck_stock_movements_precision CHECK (${inteiraNaUnidade('quantity_milli')}),
        CONSTRAINT ck_stock_movements_sign CHECK (
          (kind IN ('SALDO_INICIAL', 'ENTRADA_COMPRA') AND delta_milli > 0)
          OR (kind IN ('SAIDA_VENDA', 'SAIDA_CONSUMO', 'SAIDA_PERDA') AND delta_milli < 0)
          OR (kind IN ('AJUSTE_CONFERENCIA', 'ESTORNO') AND delta_milli <> 0)
        ),
        CONSTRAINT ck_stock_movements_reason CHECK (
          kind NOT IN ('SAIDA_PERDA', 'AJUSTE_CONFERENCIA', 'ESTORNO') OR (reason IS NOT NULL AND length(btrim(reason)) >= 3)
        ),
        CONSTRAINT ck_stock_movements_reversal CHECK ((kind = 'ESTORNO') = (reverses_movement_id IS NOT NULL)),
        CONSTRAINT ck_stock_movements_count CHECK ((kind = 'AJUSTE_CONFERENCIA') = (count_id IS NOT NULL)),
        CONSTRAINT ck_stock_movements_request CHECK ((request_key IS NULL) = (request_fingerprint IS NULL))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_stock_movements_reverses ON stock_movements (reverses_movement_id)
        WHERE reverses_movement_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_stock_movements_initial ON stock_movements (product_id) WHERE kind = 'SALDO_INICIAL'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_stock_movements_request_key ON stock_movements (recorded_by_user_id, request_key)
        WHERE request_key IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_stock_movements_tenant_product ON stock_movements (tenant_id, product_id, recorded_at DESC, id DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_stock_movements_tenant_recorded ON stock_movements (tenant_id, recorded_at DESC, id DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE stock_count_items (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        count_id varchar(30) NOT NULL,
        product_id varchar(30) NOT NULL,
        expected_unit varchar(4) NOT NULL,
        expected_balance_version integer NOT NULL,
        expected_milli bigint NOT NULL,
        counted_milli bigint NOT NULL,
        difference_milli bigint NOT NULL,
        movement_id varchar(30) NULL,
        CONSTRAINT pk_stock_count_items PRIMARY KEY (id),
        CONSTRAINT uq_stock_count_items_product UNIQUE (count_id, product_id),
        CONSTRAINT fk_stock_count_items_count FOREIGN KEY (tenant_id, count_id)
          REFERENCES stock_counts (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_count_items_product FOREIGN KEY (tenant_id, product_id)
          REFERENCES stock_products (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_count_items_movement FOREIGN KEY (tenant_id, movement_id)
          REFERENCES stock_movements (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_stock_count_items_unit CHECK (expected_unit IN (${lista(STOCK_UNITS)})),
        CONSTRAINT ck_stock_count_items_amounts CHECK (
          expected_milli >= 0 AND counted_milli >= 0 AND counted_milli <= ${MAX_BALANCE_MILLI}
          AND difference_milli = counted_milli - expected_milli AND expected_balance_version >= 0
        ),
        CONSTRAINT ck_stock_count_items_movement CHECK ((difference_milli = 0) = (movement_id IS NULL))
      )
    `);

    // Histórico só de inserção: corrigir é lançar de novo (estorno, nova
    // conferência), nunca reescrever.
    await queryRunner.query(`
      CREATE FUNCTION stock_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Histórico de estoque não pode ser alterado nem apagado; corrija com um novo lançamento.'
          USING ERRCODE = 'restrict_violation';
      END $$
    `);
    for (const tabela of ['stock_movements', 'stock_counts', 'stock_count_items']) {
      await queryRunner.query(
        `CREATE TRIGGER trg_${tabela}_append_only BEFORE UPDATE OR DELETE ON ${tabela}
          FOR EACH ROW EXECUTE FUNCTION stock_history_append_only()`,
      );
    }

    await queryRunner.query(`INSERT INTO features (id, key, label) VALUES ($1, $2, $3)`, [
      STOCK_FEATURE_ID,
      STOCK_FEATURE_KEY,
      STOCK_FEATURE_LABEL,
    ]);

    // Só recurso e disponibilidade: nome, descrição e preço ficam como o
    // portal deixou.
    const ligados = (await queryRunner.query(
      `UPDATE addon_modules SET feature_key = $1, availability = 'AVAILABLE'
        WHERE code = $2 AND feature_key IS NULL AND availability = 'PLANNED' RETURNING code`,
      [STOCK_FEATURE_KEY, STOCK_ADDON_CODE],
    )) as unknown;
    if (linhasAfetadas(ligados) !== 1) {
      throw new Error(
        'O adicional ESTOQUE não está no estado esperado (planejado e sem recurso); nada foi alterado.',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [uso] = (await queryRunner.query(
      `SELECT
         (SELECT count(*)::int FROM stock_categories) + (SELECT count(*)::int FROM stock_products)
           + (SELECT count(*)::int FROM stock_movements) + (SELECT count(*)::int FROM stock_counts) AS dados,
         (SELECT count(*)::int FROM tenant_feature_overrides WHERE feature_id = $1) AS overrides,
         (SELECT count(*)::int FROM plan_features WHERE feature_id = $1) AS planos,
         (SELECT count(*)::int FROM membership_permission_overrides WHERE permission::text IN (${lista(STOCK_PERMISSIONS)})) AS permissoes,
         (SELECT count(*)::int FROM audit_logs WHERE action::text IN (${lista(STOCK_AUDIT_ACTIONS)})) AS auditoria`,
      [STOCK_FEATURE_ID],
    )) as { dados: number; overrides: number; planos: number; permissoes: number; auditoria: number }[];
    if (uso.dados > 0 || uso.overrides > 0 || uso.planos > 0 || uso.permissoes > 0 || uso.auditoria > 0) {
      throw new Error(
        'Há dado de estoque, contratação, concessão ou histórico gravado; o down apagaria dados e foi recusado.',
      );
    }
    await queryRunner.query(
      `UPDATE addon_modules SET feature_key = NULL, availability = 'PLANNED' WHERE code = $1 AND feature_key = $2`,
      [STOCK_ADDON_CODE, STOCK_FEATURE_KEY],
    );
    await queryRunner.query(`DELETE FROM features WHERE id = $1`, [STOCK_FEATURE_ID]);
    for (const tabela of STOCK_TABLES) {
      await queryRunner.query(`DROP TABLE ${tabela}`);
    }
    await queryRunner.query(`DROP FUNCTION stock_history_append_only()`);
  }
}

/** Usa os valores novos dos enums. Na mesma transação em que foram criados,
 * o PostgreSQL recusa (55P04); sem eles, também (22P02). Nos dois casos a
 * transação é desfeita por inteiro. */
async function conferirEnumsConfirmados(queryRunner: QueryRunner): Promise<void> {
  try {
    await queryRunner.query(
      `SELECT '${STOCK_FEATURE_KEY}'::feature_key AS recurso, ${STOCK_PERMISSIONS.map(
        (p, i) => `'${p}'::permission AS permissao_${i}`,
      ).join(', ')}, ${STOCK_AUDIT_ACTIONS.map((a, i) => `'${a}'::audit_action AS auditoria_${i}`).join(', ')}`,
    );
  } catch (error) {
    const codigo = (error as { driverError?: { code?: string }; code?: string }).driverError?.code
      ?? (error as { code?: string }).code;
    if (codigo === '55P04' || codigo === '22P02') {
      throw new Error(STOCK_ENUMS_NOT_COMMITTED_MESSAGE, { cause: error });
    }
    throw error;
  }
}

/** `UPDATE … RETURNING` pelo driver `pg` volta como `[linhas, quantidade]`. */
function linhasAfetadas(resultado: unknown): number {
  if (Array.isArray(resultado) && resultado.length === 2 && typeof resultado[1] === 'number') return resultado[1];
  return Array.isArray(resultado) ? resultado.length : 0;
}
