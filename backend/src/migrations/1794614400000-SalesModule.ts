// Vendas v1, parte 2 de 2 (ver docs/plans/vendas-v1.md, seções 5.1 a 5.6).
// Exige a parte 1 (`SalesEnumValues1794528000000`) JÁ CONFIRMADA: a primeira
// instrução usa os valores novos dos enums e, se a 27 rodou na mesma
// transação (modo `all` com as duas pendentes) ou não rodou, falha com
// mensagem clara e nada fica gravado.
//
// 1. Tabelas, todas com `tenant_id` e FK composta com o estabelecimento:
//    - `sales`: cliente opcional (balcão), total em centavos, situação
//      `ATIVA` ou `CANCELADA` e o cancelamento (motivo, autor, data) na
//      mesma linha;
//    - `sale_items` (só inserção): nome, unidade, quantidade (milésimos) e
//      preço congelados, total da linha calculado pela fórmula única de
//      arredondamento, e o movimento de estoque que baixou o item;
//    - `sale_payments`: recebimento manual integral de uma venda, com estorno
//      na mesma linha (o molde de `appointment_payments`, sem
//      `appointment_id`).
// 2. `stock_movements.sale_id` (baixa e estorno de uma venda) e
//    `stock_products.sale_price_cents` (preço sugerido, nulo = sem preço).
// 3. Gatilhos (garantia final, inclusive contra código antigo):
//    - `stock_movements_sale_link`: o estorno de uma baixa de venda só entra
//      com o MESMO `sale_id` e a venda já `CANCELADA` na transação; o estorno
//      manual (que nunca leva `sale_id`) é recusado. Baixa nova só para venda
//      `ATIVA`;
//    - `sale_items_movement`: o item aponta para uma `SAIDA_VENDA` da mesma
//      venda, do mesmo produto, quantidade e unidade;
//    - `sales_guard_update`: a venda só muda de `ATIVA` para `CANCELADA`, uma
//      vez e sem recebimento ativo, ou de cliente para o principal de uma
//      unificação; nada mais muda;
//    - `sale_payments_guard`: recebimento só de venda `ATIVA`, com o valor
//      igual ao total; depois, só o estorno muda a linha;
//    - `sales_consumer_active` e `consumers_move_sales`: cadastro unificado
//      não recebe venda, e a unificação (de qualquer versão da API) leva as
//      vendas do secundário para o principal;
//    - `sales_consistency` (CONSTRAINT TRIGGER DEFERRABLE INITIALLY
//      DEFERRED): no commit, a soma dos itens é o total, há pelo menos um
//      item, uma baixa por item e, na venda cancelada, um estorno por item.
//      Uma soma entre tabelas não cabe num CHECK comum.
// 4. O recurso `VENDAS` em `features` e o adicional VENDAS em
//    `addon_modules`, `AVAILABLE` e SEM preço: a contratação recusa com
//    `PRECO_PENDENTE` até o responsável definir o preço em "Planos e
//    adicionais". Nenhum plano ganha o recurso e nenhum estabelecimento ganha
//    override.
//
// Tipos em `varchar` com CHECK (sem enum novo), como no estoque.
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { SALES_AUDIT_ACTIONS, SALES_FEATURE_KEY, SALES_PERMISSIONS } from './1794528000000-SalesEnumValues.js';
import { MAX_MOVEMENT_MILLI, MILLI, STOCK_DECIMAL_UNITS, STOCK_UNITS } from './1794096000000-StockModule.js';
import { PAYMENT_METHODS } from './1793059200000-AppointmentPayments.js';
import { CONSUMER_MERGED_SQLSTATE, INSERT_ONLY_SQLSTATE } from './1794268800000-ConsumerIdentity.js';

export const SALES_FEATURE_ID = 'feat_vendas';
export const SALES_FEATURE_LABEL = 'Vendas';
export const SALES_ADDON_CODE = 'VENDAS';
export const SALES_ADDON_NAME = 'Vendas';
export const SALES_ADDON_DESCRIPTION =
  'Venda de produtos do estoque com recebimento manual. Exige o Controle de estoque.';
export const SALES_ADDON_SORT_ORDER = 45;

export const SALE_STATUSES = ['ATIVA', 'CANCELADA'] as const;
/** Teto do preço de um item (o mesmo dos recebimentos de atendimento). */
export const MAX_UNIT_PRICE_CENTS = 100_000_000;
/** Teto do total de uma venda e do recebimento dela. */
export const MAX_SALE_TOTAL_CENTS = 10_000_000_000;

/** SQLSTATEs próprios (a API traduz pelo `constraint` do erro). */
export const SALE_MOVEMENT_LINK_SQLSTATE = 'AC010';
export const SALE_STATE_SQLSTATE = 'AC011';
export const SALE_ACTIVE_PAYMENT_SQLSTATE = 'AC012';
export const SALE_CONSISTENCY_SQLSTATE = 'AC013';
export const SALE_PAYMENT_SQLSTATE = 'AC014';
export const SALE_ITEM_MOVEMENT_SQLSTATE = 'AC015';

/** Nomes que aparecem em `constraint` no erro do PostgreSQL. */
export const SALE_REVERSAL_CONSTRAINT = 'ck_stock_movements_sale_reversal';
export const SALE_MOVEMENT_CONSTRAINT = 'ck_stock_movements_sale_active';
export const SALE_STATE_CONSTRAINT = 'ck_sales_transition';
export const SALE_ACTIVE_PAYMENT_CONSTRAINT = 'ck_sales_no_active_payment';
export const SALE_CONSISTENCY_CONSTRAINT = 'ck_sales_consistency';
export const SALE_PAYMENT_CONSTRAINT = 'ck_sale_payments_sale';
export const SALE_ITEM_MOVEMENT_CONSTRAINT = 'ck_sale_items_movement';

export const SALES_TABLES = ['sale_payments', 'sale_items', 'sales'] as const;
export const SALES_FUNCTIONS = [
  'sales_consistency',
  'sales_guard_update',
  'sales_append_only',
  'sales_consumer_active',
  'consumers_move_sales',
  'sale_items_movement',
  'sale_payments_guard',
  'stock_movements_sale_link',
] as const;

export const SALES_ENUMS_NOT_COMMITTED_MESSAGE =
  'A migration SalesEnumValues1794528000000 precisa estar confirmada antes desta; ' +
  "use o modo de transação 'each' ou aplique uma migration por vez.";

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');
const decimais = lista(STOCK_DECIMAL_UNITS);
const inteiraNaUnidade = (coluna: string) => `(unit IN (${decimais}) OR ${coluna} % ${MILLI} = 0)`;

export class SalesModule1794614400000 implements MigrationInterface {
  name = 'SalesModule1794614400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await conferirEnumsConfirmados(queryRunner);

    await queryRunner.query(`
      CREATE TABLE sales (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        consumer_id varchar(30) NULL,
        status varchar(12) NOT NULL DEFAULT 'ATIVA',
        total_cents bigint NOT NULL,
        recorded_by_user_id varchar(30) NOT NULL,
        recorded_at timestamptz(3) NOT NULL DEFAULT now(),
        request_key varchar(80) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        cancelled_at timestamptz(3) NULL,
        cancelled_by_user_id varchar(30) NULL,
        cancel_reason varchar(300) NULL,
        CONSTRAINT pk_sales PRIMARY KEY (id),
        CONSTRAINT uq_sales_tenant_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_sales_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT fk_sales_consumer FOREIGN KEY (tenant_id, consumer_id)
          REFERENCES consumers (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_sales_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT fk_sales_cancelled_by FOREIGN KEY (cancelled_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_sales_status CHECK (status IN (${lista(SALE_STATUSES)})),
        CONSTRAINT ck_sales_total CHECK (total_cents > 0 AND total_cents <= ${MAX_SALE_TOTAL_CENTS}),
        CONSTRAINT ck_sales_cancel CHECK (
          (status = 'ATIVA' AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancel_reason IS NULL)
          OR (status = 'CANCELADA' AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL
              AND cancel_reason IS NOT NULL AND length(btrim(cancel_reason)) >= 3 AND cancelled_at >= recorded_at)
        )
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_sales_request_key ON sales (recorded_by_user_id, request_key)`);
    await queryRunner.query(`CREATE INDEX idx_sales_tenant_recorded ON sales (tenant_id, recorded_at DESC, id DESC)`);
    await queryRunner.query(
      `CREATE INDEX idx_sales_tenant_recorder ON sales (tenant_id, recorded_by_user_id, recorded_at DESC, id DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_sales_tenant_consumer ON sales (tenant_id, consumer_id, recorded_at DESC) WHERE consumer_id IS NOT NULL`,
    );

    await queryRunner.query(`ALTER TABLE stock_movements ADD COLUMN sale_id varchar(30) NULL`);
    await queryRunner.query(`
      ALTER TABLE stock_movements
        ADD CONSTRAINT fk_stock_movements_sale FOREIGN KEY (tenant_id, sale_id) REFERENCES sales (tenant_id, id) ON DELETE RESTRICT,
        ADD CONSTRAINT uq_stock_movements_tenant_sale_id UNIQUE (tenant_id, sale_id, id),
        ADD CONSTRAINT ck_stock_movements_sale_kind CHECK (sale_id IS NULL OR kind IN ('SAIDA_VENDA', 'ESTORNO'))
    `);
    await queryRunner.query(
      `CREATE INDEX idx_stock_movements_tenant_sale ON stock_movements (tenant_id, sale_id) WHERE sale_id IS NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE stock_products
        ADD COLUMN sale_price_cents bigint NULL,
        ADD CONSTRAINT ck_stock_products_sale_price CHECK (
          sale_price_cents IS NULL OR (sale_price_cents > 0 AND sale_price_cents <= ${MAX_UNIT_PRICE_CENTS})
        )
    `);

    await queryRunner.query(`
      CREATE TABLE sale_items (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        sale_id varchar(30) NOT NULL,
        position smallint NOT NULL,
        product_id varchar(30) NOT NULL,
        stock_movement_id varchar(30) NOT NULL,
        product_name varchar(80) NOT NULL,
        unit varchar(4) NOT NULL,
        quantity_milli bigint NOT NULL,
        unit_price_cents bigint NOT NULL,
        suggested_price_cents bigint NULL,
        line_total_cents bigint NOT NULL,
        CONSTRAINT pk_sale_items PRIMARY KEY (id),
        CONSTRAINT uq_sale_items_movement UNIQUE (stock_movement_id),
        CONSTRAINT uq_sale_items_product UNIQUE (sale_id, product_id),
        CONSTRAINT uq_sale_items_position UNIQUE (sale_id, position),
        CONSTRAINT fk_sale_items_sale FOREIGN KEY (tenant_id, sale_id) REFERENCES sales (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_sale_items_product FOREIGN KEY (tenant_id, product_id)
          REFERENCES stock_products (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_sale_items_movement FOREIGN KEY (tenant_id, sale_id, stock_movement_id)
          REFERENCES stock_movements (tenant_id, sale_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_sale_items_name CHECK (length(btrim(product_name)) >= 1),
        CONSTRAINT ck_sale_items_unit CHECK (unit IN (${lista(STOCK_UNITS)})),
        CONSTRAINT ck_sale_items_position CHECK (position >= 1),
        CONSTRAINT ck_sale_items_quantity CHECK (quantity_milli > 0 AND quantity_milli <= ${MAX_MOVEMENT_MILLI}),
        CONSTRAINT ck_sale_items_precision CHECK (${inteiraNaUnidade('quantity_milli')}),
        CONSTRAINT ck_sale_items_price CHECK (unit_price_cents > 0 AND unit_price_cents <= ${MAX_UNIT_PRICE_CENTS}),
        CONSTRAINT ck_sale_items_suggested CHECK (
          suggested_price_cents IS NULL OR (suggested_price_cents > 0 AND suggested_price_cents <= ${MAX_UNIT_PRICE_CENTS})
        ),
        CONSTRAINT ck_sale_items_line CHECK (line_total_cents = (unit_price_cents * quantity_milli + 500) / ${MILLI})
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_sale_items_tenant_product ON sale_items (tenant_id, product_id)`);

    await queryRunner.query(`
      CREATE TABLE sale_payments (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        sale_id varchar(30) NOT NULL,
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
        CONSTRAINT pk_sale_payments PRIMARY KEY (id),
        CONSTRAINT uq_sale_payments_tenant_id UNIQUE (tenant_id, id),
        CONSTRAINT fk_sale_payments_sale FOREIGN KEY (tenant_id, sale_id) REFERENCES sales (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_sale_payments_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT fk_sale_payments_refunded_by FOREIGN KEY (refunded_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_sale_payments_amount CHECK (amount_cents > 0 AND amount_cents <= ${MAX_SALE_TOTAL_CENTS}),
        CONSTRAINT ck_sale_payments_method CHECK (method IN (${lista(PAYMENT_METHODS)})),
        CONSTRAINT ck_sale_payments_refund CHECK (
          (refunded_at IS NULL AND refunded_on IS NULL AND refund_reason IS NULL AND refunded_by_user_id IS NULL)
          OR (refunded_at IS NOT NULL AND refunded_on IS NOT NULL AND refund_reason IS NOT NULL
              AND length(btrim(refund_reason)) >= 3 AND refunded_by_user_id IS NOT NULL AND refunded_on >= received_on)
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_sale_payments_active ON sale_payments (tenant_id, sale_id) WHERE refunded_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_sale_payments_request_key ON sale_payments (recorded_by_user_id, request_key)`,
    );
    await queryRunner.query(`CREATE INDEX idx_sale_payments_tenant_received ON sale_payments (tenant_id, received_on)`);
    await queryRunner.query(
      `CREATE INDEX idx_sale_payments_tenant_refunded ON sale_payments (tenant_id, refunded_on) WHERE refunded_on IS NOT NULL`,
    );

    await criarGatilhos(queryRunner);

    await queryRunner.query(`INSERT INTO features (id, key, label) VALUES ($1, $2, $3)`, [
      SALES_FEATURE_ID,
      SALES_FEATURE_KEY,
      SALES_FEATURE_LABEL,
    ]);
    // Sem linha em `addon_module_prices`: sem preço, a contratação recusa
    // (`PRECO_PENDENTE`). Preço ausente nunca é gratuito.
    await queryRunner.query(
      `INSERT INTO addon_modules (code, name, description, feature_key, availability, sort_order)
       VALUES ($1, $2, $3, $4, 'AVAILABLE', $5)`,
      [SALES_ADDON_CODE, SALES_ADDON_NAME, SALES_ADDON_DESCRIPTION, SALES_FEATURE_KEY, SALES_ADDON_SORT_ORDER],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [uso] = (await queryRunner.query(
      `SELECT
         (SELECT count(*)::int FROM sales) + (SELECT count(*)::int FROM sale_payments)
           + (SELECT count(*)::int FROM stock_movements WHERE sale_id IS NOT NULL)
           + (SELECT count(*)::int FROM stock_products WHERE sale_price_cents IS NOT NULL) AS dados,
         (SELECT count(*)::int FROM tenant_feature_overrides WHERE feature_id = $1) AS overrides,
         (SELECT count(*)::int FROM plan_features WHERE feature_id = $1) AS planos,
         (SELECT count(*)::int FROM tenant_subscription_items WHERE module_code = $2) AS contratos,
         (SELECT count(*)::int FROM addon_module_prices WHERE module_code = $2) AS precos,
         (SELECT count(*)::int FROM membership_permission_overrides WHERE permission::text IN (${lista(SALES_PERMISSIONS)})) AS permissoes,
         (SELECT count(*)::int FROM audit_logs WHERE action::text IN (${lista(SALES_AUDIT_ACTIONS)})) AS auditoria`,
      [SALES_FEATURE_ID, SALES_ADDON_CODE],
    )) as Record<string, number>[];
    if (Object.values(uso).some((n) => Number(n) > 0)) {
      throw new Error(
        'Há venda, preço sugerido, contratação, preço do adicional, concessão ou histórico de vendas gravado; ' +
          'o down apagaria dados e foi recusado.',
      );
    }
    await queryRunner.query(`DELETE FROM addon_modules WHERE code = $1`, [SALES_ADDON_CODE]);
    await queryRunner.query(`DELETE FROM features WHERE id = $1`, [SALES_FEATURE_ID]);
    await queryRunner.query(`DROP TRIGGER trg_consumers_move_sales ON consumers`);
    await queryRunner.query(`DROP TRIGGER trg_stock_movements_sale_link ON stock_movements`);
    await queryRunner.query(`DROP TRIGGER trg_stock_movements_sale_consistency ON stock_movements`);
    // Itens e recebimentos antes: os itens apontam para os movimentos, e os
    // movimentos para a venda.
    await queryRunner.query(`DROP TABLE sale_payments`);
    await queryRunner.query(`DROP TABLE sale_items`);
    await queryRunner.query(`ALTER TABLE stock_products DROP CONSTRAINT ck_stock_products_sale_price, DROP COLUMN sale_price_cents`);
    await queryRunner.query(`DROP INDEX idx_stock_movements_tenant_sale`);
    await queryRunner.query(`
      ALTER TABLE stock_movements
        DROP CONSTRAINT ck_stock_movements_sale_kind,
        DROP CONSTRAINT uq_stock_movements_tenant_sale_id,
        DROP CONSTRAINT fk_stock_movements_sale,
        DROP COLUMN sale_id
    `);
    await queryRunner.query(`DROP TABLE sales`);
    for (const funcao of SALES_FUNCTIONS) {
      await queryRunner.query(`DROP FUNCTION ${funcao}()`);
    }
  }
}

async function criarGatilhos(queryRunner: QueryRunner): Promise<void> {
  // Baixa e estorno ligados a uma venda. O que separa o estorno manual do
  // cancelamento é o `sale_id` no estorno E a venda já cancelada na mesma
  // transação (o fluxo de vendas cancela a venda antes de inserir os
  // estornos). A rota manual nunca grava `sale_id`, e a API anterior nem
  // conhece a coluna: os dois caem aqui.
  await queryRunner.query(`
    CREATE FUNCTION stock_movements_sale_link() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      venda varchar(30);
      situacao varchar(12);
    BEGIN
      IF NEW.reverses_movement_id IS NOT NULL THEN
        SELECT sale_id INTO venda FROM stock_movements
         WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_movement_id;
        IF venda IS NULL AND NEW.sale_id IS NULL THEN
          RETURN NEW;
        END IF;
        IF venda IS NULL OR NEW.sale_id IS DISTINCT FROM venda THEN
          RAISE EXCEPTION 'A baixa de uma venda só é estornada pelo cancelamento da venda.'
            USING ERRCODE = '${SALE_MOVEMENT_LINK_SQLSTATE}', CONSTRAINT = '${SALE_REVERSAL_CONSTRAINT}';
        END IF;
        SELECT status INTO situacao FROM sales WHERE tenant_id = NEW.tenant_id AND id = venda FOR SHARE;
        IF situacao IS DISTINCT FROM 'CANCELADA' THEN
          RAISE EXCEPTION 'A baixa de uma venda só é estornada pelo cancelamento da venda.'
            USING ERRCODE = '${SALE_MOVEMENT_LINK_SQLSTATE}', CONSTRAINT = '${SALE_REVERSAL_CONSTRAINT}';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.sale_id IS NOT NULL THEN
        SELECT status INTO situacao FROM sales WHERE tenant_id = NEW.tenant_id AND id = NEW.sale_id FOR SHARE;
        IF situacao IS DISTINCT FROM 'ATIVA' THEN
          RAISE EXCEPTION 'Venda cancelada ou inexistente não recebe baixa de estoque.'
            USING ERRCODE = '${SALE_MOVEMENT_LINK_SQLSTATE}', CONSTRAINT = '${SALE_MOVEMENT_CONSTRAINT}';
        END IF;
      END IF;
      RETURN NEW;
    END $$
  `);
  await queryRunner.query(`
    CREATE TRIGGER trg_stock_movements_sale_link BEFORE INSERT ON stock_movements
      FOR EACH ROW EXECUTE FUNCTION stock_movements_sale_link()
  `);

  // O item aponta para a baixa da própria venda, do mesmo produto, na mesma
  // quantidade e unidade.
  await queryRunner.query(`
    CREATE FUNCTION sale_items_movement() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      m record;
    BEGIN
      SELECT kind, product_id, quantity_milli, unit, sale_id INTO m FROM stock_movements
       WHERE tenant_id = NEW.tenant_id AND id = NEW.stock_movement_id;
      IF NOT FOUND OR m.kind <> 'SAIDA_VENDA' OR m.product_id <> NEW.product_id
         OR m.quantity_milli <> NEW.quantity_milli OR m.unit <> NEW.unit OR m.sale_id IS DISTINCT FROM NEW.sale_id THEN
        RAISE EXCEPTION 'O item da venda precisa da baixa de estoque do mesmo produto, quantidade e unidade.'
          USING ERRCODE = '${SALE_ITEM_MOVEMENT_SQLSTATE}', CONSTRAINT = '${SALE_ITEM_MOVEMENT_CONSTRAINT}';
      END IF;
      RETURN NEW;
    END $$
  `);
  await queryRunner.query(`
    CREATE TRIGGER trg_sale_items_movement BEFORE INSERT ON sale_items
      FOR EACH ROW EXECUTE FUNCTION sale_items_movement()
  `);

  // Itens, vendas e recebimentos nunca são apagados; itens nunca mudam.
  await queryRunner.query(`
    CREATE FUNCTION sales_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Registro de venda não pode ser alterado nem apagado; use cancelamento ou estorno.'
        USING ERRCODE = '${INSERT_ONLY_SQLSTATE}';
    END $$
  `);
  await queryRunner.query(`
    CREATE TRIGGER trg_sale_items_append_only BEFORE UPDATE OR DELETE ON sale_items
      FOR EACH ROW EXECUTE FUNCTION sales_append_only()
  `);
  await queryRunner.query(`
    CREATE TRIGGER trg_sales_no_delete BEFORE DELETE ON sales
      FOR EACH ROW EXECUTE FUNCTION sales_append_only()
  `);
  await queryRunner.query(`
    CREATE TRIGGER trg_sale_payments_no_delete BEFORE DELETE ON sale_payments
      FOR EACH ROW EXECUTE FUNCTION sales_append_only()
  `);

  // A venda só muda de ATIVA para CANCELADA (uma vez, sem recebimento ativo)
  // ou de cliente para o principal da unificação do cliente atual.
  await queryRunner.query(`
    CREATE FUNCTION sales_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      destino varchar(30);
    BEGIN
      IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.total_cents <> OLD.total_cents
         OR NEW.recorded_by_user_id <> OLD.recorded_by_user_id OR NEW.recorded_at <> OLD.recorded_at
         OR NEW.request_key <> OLD.request_key OR NEW.request_fingerprint <> OLD.request_fingerprint THEN
        RAISE EXCEPTION 'Os dados de uma venda registrada não mudam.'
          USING ERRCODE = '${SALE_STATE_SQLSTATE}', CONSTRAINT = '${SALE_STATE_CONSTRAINT}';
      END IF;
      IF NEW.consumer_id IS DISTINCT FROM OLD.consumer_id THEN
        IF OLD.consumer_id IS NOT NULL THEN
          SELECT merged_into_consumer_id INTO destino FROM consumers
           WHERE tenant_id = OLD.tenant_id AND id = OLD.consumer_id;
        END IF;
        IF destino IS NULL OR NEW.consumer_id IS DISTINCT FROM destino OR NEW.status <> OLD.status
           OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
           OR NEW.cancelled_by_user_id IS DISTINCT FROM OLD.cancelled_by_user_id
           OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
          RAISE EXCEPTION 'O cliente de uma venda só muda pela unificação de cadastros.'
            USING ERRCODE = '${SALE_STATE_SQLSTATE}', CONSTRAINT = '${SALE_STATE_CONSTRAINT}';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.status = OLD.status THEN
        IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
           OR NEW.cancelled_by_user_id IS DISTINCT FROM OLD.cancelled_by_user_id
           OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
          RAISE EXCEPTION 'O cancelamento de uma venda não muda depois de gravado.'
            USING ERRCODE = '${SALE_STATE_SQLSTATE}', CONSTRAINT = '${SALE_STATE_CONSTRAINT}';
        END IF;
        RETURN NEW;
      END IF;
      IF OLD.status <> 'ATIVA' OR NEW.status <> 'CANCELADA' THEN
        RAISE EXCEPTION 'Uma venda só passa de ativa para cancelada.'
          USING ERRCODE = '${SALE_STATE_SQLSTATE}', CONSTRAINT = '${SALE_STATE_CONSTRAINT}';
      END IF;
      IF EXISTS (SELECT 1 FROM sale_payments
                  WHERE tenant_id = OLD.tenant_id AND sale_id = OLD.id AND refunded_at IS NULL) THEN
        RAISE EXCEPTION 'Estorne o recebimento antes de cancelar a venda.'
          USING ERRCODE = '${SALE_ACTIVE_PAYMENT_SQLSTATE}', CONSTRAINT = '${SALE_ACTIVE_PAYMENT_CONSTRAINT}';
      END IF;
      RETURN NEW;
    END $$
  `);
  await queryRunner.query(`
    CREATE TRIGGER trg_sales_guard_update BEFORE UPDATE ON sales
      FOR EACH ROW EXECUTE FUNCTION sales_guard_update()
  `);

  // Recebimento só de venda ativa e com o valor do total; depois, só o
  // estorno (uma vez) muda a linha.
  await queryRunner.query(`
    CREATE FUNCTION sale_payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      venda record;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        SELECT status, total_cents INTO venda FROM sales
         WHERE tenant_id = NEW.tenant_id AND id = NEW.sale_id FOR SHARE;
        IF NOT FOUND OR venda.status <> 'ATIVA' OR venda.total_cents <> NEW.amount_cents THEN
          RAISE EXCEPTION 'O recebimento é de uma venda ativa e no valor total dela.'
            USING ERRCODE = '${SALE_PAYMENT_SQLSTATE}', CONSTRAINT = '${SALE_PAYMENT_CONSTRAINT}';
        END IF;
        RETURN NEW;
      END IF;
      IF OLD.refunded_at IS NOT NULL OR NEW.refunded_at IS NULL
         OR NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.sale_id <> OLD.sale_id
         OR NEW.amount_cents <> OLD.amount_cents OR NEW.method <> OLD.method OR NEW.received_on <> OLD.received_on
         OR NEW.recorded_at <> OLD.recorded_at OR NEW.recorded_by_user_id <> OLD.recorded_by_user_id
         OR NEW.request_key <> OLD.request_key OR NEW.notes IS DISTINCT FROM OLD.notes THEN
        RAISE EXCEPTION 'Um recebimento de venda só muda pelo estorno, uma vez.'
          USING ERRCODE = '${SALE_PAYMENT_SQLSTATE}', CONSTRAINT = '${SALE_PAYMENT_CONSTRAINT}';
      END IF;
      RETURN NEW;
    END $$
  `);
  await queryRunner.query(`
    CREATE TRIGGER trg_sale_payments_guard BEFORE INSERT OR UPDATE ON sale_payments
      FOR EACH ROW EXECUTE FUNCTION sale_payments_guard()
  `);

  // Cadastro unificado não recebe venda (no molde de
  // `appointments_consumer_active`, com o mesmo SQLSTATE).
  await queryRunner.query(`
    CREATE FUNCTION sales_consumer_active() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      principal varchar(30);
    BEGIN
      IF NEW.consumer_id IS NULL THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' AND NEW.consumer_id IS NOT DISTINCT FROM OLD.consumer_id THEN
        RETURN NEW;
      END IF;
      SELECT merged_into_consumer_id INTO principal FROM consumers
       WHERE tenant_id = NEW.tenant_id AND id = NEW.consumer_id FOR SHARE;
      IF principal IS NOT NULL THEN
        RAISE EXCEPTION 'Cadastro de cliente unificado.'
          USING ERRCODE = '${CONSUMER_MERGED_SQLSTATE}', DETAIL = principal;
      END IF;
      RETURN NEW;
    END $$
  `);
  await queryRunner.query(`
    CREATE TRIGGER trg_sales_consumer_active BEFORE INSERT OR UPDATE OF consumer_id ON sales
      FOR EACH ROW EXECUTE FUNCTION sales_consumer_active()
  `);

  // A unificação (de qualquer versão da API) leva as vendas do secundário
  // para o principal, na mesma transação em que o cadastro vira lápide.
  await queryRunner.query(`
    CREATE FUNCTION consumers_move_sales() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.merged_into_consumer_id IS NOT NULL
         AND NEW.merged_into_consumer_id IS DISTINCT FROM OLD.merged_into_consumer_id THEN
        UPDATE sales SET consumer_id = NEW.merged_into_consumer_id
         WHERE tenant_id = NEW.tenant_id AND consumer_id = NEW.id;
      END IF;
      RETURN NULL;
    END $$
  `);
  await queryRunner.query(`
    CREATE TRIGGER trg_consumers_move_sales AFTER UPDATE OF merged_into_consumer_id ON consumers
      FOR EACH ROW EXECUTE FUNCTION consumers_move_sales()
  `);

  // Consistência entre tabelas, conferida no commit (diferida): soma dos
  // itens = total, pelo menos um item, uma baixa por item e, na venda
  // cancelada, um estorno por item. Dispara em qualquer escrita que toque a
  // venda: a própria venda, um item ou um movimento com `sale_id`.
  await queryRunner.query(`
    CREATE FUNCTION sales_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      venda_id varchar(30);
      venda record;
      itens integer;
      soma bigint;
      saidas integer;
      estornos integer;
    BEGIN
      IF TG_TABLE_NAME = 'sales' THEN
        venda_id := NEW.id;
      ELSE
        venda_id := NEW.sale_id;
      END IF;
      SELECT status, total_cents INTO venda FROM sales WHERE tenant_id = NEW.tenant_id AND id = venda_id;
      IF NOT FOUND THEN
        RETURN NULL;
      END IF;
      SELECT count(*)::int, COALESCE(sum(line_total_cents), 0) INTO itens, soma
        FROM sale_items WHERE tenant_id = NEW.tenant_id AND sale_id = venda_id;
      SELECT count(*) FILTER (WHERE kind = 'SAIDA_VENDA')::int, count(*) FILTER (WHERE kind = 'ESTORNO')::int
        INTO saidas, estornos
        FROM stock_movements WHERE tenant_id = NEW.tenant_id AND sale_id = venda_id;
      IF itens < 1 OR soma <> venda.total_cents OR saidas <> itens
         OR (venda.status = 'ATIVA' AND estornos <> 0)
         OR (venda.status = 'CANCELADA' AND estornos <> itens) THEN
        RAISE EXCEPTION 'Venda inconsistente: itens %, soma %, total %, baixas %, estornos %, situação %.',
          itens, soma, venda.total_cents, saidas, estornos, venda.status
          USING ERRCODE = '${SALE_CONSISTENCY_SQLSTATE}', CONSTRAINT = '${SALE_CONSISTENCY_CONSTRAINT}';
      END IF;
      RETURN NULL;
    END $$
  `);
  await queryRunner.query(`
    CREATE CONSTRAINT TRIGGER trg_sales_consistency AFTER INSERT OR UPDATE ON sales
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales_consistency()
  `);
  await queryRunner.query(`
    CREATE CONSTRAINT TRIGGER trg_sale_items_consistency AFTER INSERT ON sale_items
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales_consistency()
  `);
  await queryRunner.query(`
    CREATE CONSTRAINT TRIGGER trg_stock_movements_sale_consistency AFTER INSERT ON stock_movements
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.sale_id IS NOT NULL)
      EXECUTE FUNCTION sales_consistency()
  `);
}

/** Usa os valores novos dos enums. Na mesma transação em que foram criados,
 * o PostgreSQL recusa (55P04); sem eles, também (22P02). Nos dois casos a
 * transação é desfeita por inteiro. */
async function conferirEnumsConfirmados(queryRunner: QueryRunner): Promise<void> {
  try {
    await queryRunner.query(
      `SELECT '${SALES_FEATURE_KEY}'::feature_key AS recurso, ${SALES_PERMISSIONS.map(
        (p, i) => `'${p}'::permission AS permissao_${i}`,
      ).join(', ')}, ${SALES_AUDIT_ACTIONS.map((a, i) => `'${a}'::audit_action AS auditoria_${i}`).join(', ')}`,
    );
  } catch (error) {
    const codigo =
      (error as { driverError?: { code?: string }; code?: string }).driverError?.code ?? (error as { code?: string }).code;
    if (codigo === '55P04' || codigo === '22P02') {
      throw new Error(SALES_ENUMS_NOT_COMMITTED_MESSAGE, { cause: error });
    }
    throw error;
  }
}
