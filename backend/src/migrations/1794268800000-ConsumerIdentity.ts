// Clientes, parte 2 (ver docs/plans/clientes-ficha-e-duplicados.md). Só
// acréscimos: a API anterior continua funcionando sobre este schema (ela não
// conhece as colunas e tabelas novas, e o UNIQUE de telefone continua).
//
// 1. Duas funções IMUTÁVEIS, a única fonte das chaves de comparação:
//    - `consumer_name_key(nome)`: sem acento (`translate`, sem a extensão
//      unaccent, que não é imutável), minúsculas, espaços colapsados;
//    - `consumer_phone_match_key(whatsapp_normalized)`: a chave de REVISÃO
//      de telefone (regra no comentário da função). `NULL` nunca agrupa.
//    As colunas geradas `consumers.name_key` e `consumers.phone_match_key`
//    usam essas funções; as consultas comparam um valor digitado pela mesma
//    função, nunca por uma cópia em TypeScript.
// 2. Unificação sem apagar nada: `merged_into_consumer_id`, `merged_at`,
//    `merged_by_user_id` (o cadastro unificado vira LÁPIDE). FK composta com
//    o estabelecimento, CHECK contra apontar para si mesmo e os três campos
//    preenchidos juntos.
// 3. `consumers.updated_at`, para a edição detectar alteração concorrente.
// 4. `consumer_create_requests`: chave de pedido do cadastro pela tela, com a
//    impressão (SHA-256) dos dados NORMALIZADOS do pedido original. Só
//    INSERT: um gatilho recusa UPDATE.
// 5. `whatsapp_consent_events`: preferências de mensagem POR TELEFONE (o
//    número ao qual o evento se aplica e a data do próprio evento), só
//    INSERT. Backfill: cada coluna antiga preenchida
//    (`whatsapp_opt_in_at`, `whatsapp_opt_out_at`) vira um evento com o
//    telefone ATUAL da linha (até aqui não existia edição de telefone) e a
//    data da própria coluna, nunca `updated_at`. As colunas antigas ficam,
//    congeladas, para o retorno à API anterior.
// 6. Gatilho `trg_appointments_consumer_active`: em INSERT e na troca de
//    `consumer_id` de `appointments`, trava o cadastro (`FOR SHARE`) e recusa
//    lápide com o SQLSTATE `CONSUMER_MERGED_SQLSTATE`. É a garantia final
//    contra agendamento ligado a cadastro unificado, inclusive vindo de
//    código antigo, e serializa com a unificação (que trava o cadastro
//    `FOR UPDATE`).
// 7. Índices: grupo de telefone e nome (só ativos), busca do agendamento
//    público por telefone + nome (NÃO único: o mesmo telefone e nome podem
//    ser pessoas diferentes) e a ficha (`appointments` por cliente e data).
//
// `uq_consumers_tenant_whatsapp` continua. Quem o remove é a parte 3
// (`ConsumerSharedPhone`), publicada só depois da API que funciona nos dois
// schemas.
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** SQLSTATE do gatilho: cadastro unificado (lápide) não recebe agendamento. */
export const CONSUMER_MERGED_SQLSTATE = 'AC001';
/** SQLSTATE das tabelas só de inserção. */
export const INSERT_ONLY_SQLSTATE = 'AC002';

export const CONSENT_KINDS = ['OPT_IN', 'OPT_OUT'] as const;
/** Origem dos eventos vindos das colunas antigas sem origem gravada. */
export const LEGACY_CONSENT_SOURCE = 'LEGADO';

/** Letras acentuadas (maiúsculas e minúsculas) e a letra sem acento que as
 * substitui. As maiúsculas acentuadas são trocadas aqui, antes de `lower`:
 * num banco com ctype C, `lower` só conhece A-Z, e a chave precisa ser a
 * mesma em qualquer configuração de idioma do servidor. */
export const NAME_KEY_LETTERS: readonly (readonly [string, string])[] = [
  ['áàâãäåāÁÀÂÃÄÅĀ', 'a'],
  ['éèêëēÉÈÊËĒ', 'e'],
  ['íìîïīÍÌÎÏĪ', 'i'],
  ['óòôõöøōÓÒÔÕÖØŌ', 'o'],
  ['úùûüūÚÙÛÜŪ', 'u'],
  ['çÇ', 'c'],
  ['ñÑ', 'n'],
  ['ýÿÝŸ', 'y'],
];
export const NAME_KEY_FROM = NAME_KEY_LETTERS.map(([letras]) => letras).join('');
export const NAME_KEY_TO = NAME_KEY_LETTERS.map(([letras, troca]) => troca.repeat([...letras].length)).join('');

export const CONSUMER_IDENTITY_INDEXES = [
  'idx_consumers_tenant_phone_match_active',
  'idx_consumers_tenant_whatsapp_name_active',
  'idx_consumers_tenant_name_key_active',
  'idx_appointments_tenant_consumer_start',
  'idx_whatsapp_consent_events_phone',
] as const;

export class ConsumerIdentity1794268800000 implements MigrationInterface {
  name = 'ConsumerIdentity1794268800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION consumer_name_key(nome text) RETURNS text
        LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
        AS $$ SELECT btrim(regexp_replace(lower(translate(nome, '${NAME_KEY_FROM}', '${NAME_KEY_TO}')), '\\s+', ' ', 'g')) $$
    `);
    // Regra única da chave de revisão (n = telefone com "+550" trocado por
    // "+55", o DDD com zero que o normalizador antigo grava):
    // - +55, DDD (dois dígitos de 1 a 9), celular de 9 dígitos com o 2º
    //   dígito de 6 a 9: chave SEM o 9 (pode existir a forma antiga, de 8);
    // - +55, DDD, celular de 9 dígitos com o 2º dígito de 0 a 5: o próprio
    //   número (não existe forma antiga);
    // - +55, DDD, 8 dígitos começando de 2 a 9: o próprio número;
    // - outro +55: NULL (comprimento ou DDD inválidos nunca agrupam);
    // - fora do Brasil, de 8 a 15 dígitos: o próprio número.
    await queryRunner.query(`
      CREATE FUNCTION consumer_phone_match_key(telefone text) RETURNS text
        LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
        AS $$
          SELECT CASE
            WHEN n ~ '^\\+55[1-9]{2}9[6-9][0-9]{7}$' THEN '+55' || substr(n, 4, 2) || substr(n, 7)
            WHEN n ~ '^\\+55[1-9]{2}9[0-5][0-9]{7}$' THEN n
            WHEN n ~ '^\\+55[1-9]{2}[2-9][0-9]{7}$' THEN n
            WHEN n ~ '^\\+55' THEN NULL
            WHEN n ~ '^\\+[1-9][0-9]{7,14}$' THEN n
            ELSE NULL
          END
          FROM (SELECT regexp_replace(telefone, '^\\+550', '+55') AS n) AS t
        $$
    `);

    await queryRunner.query(`
      ALTER TABLE consumers
        ADD COLUMN name_key text GENERATED ALWAYS AS (consumer_name_key(name)) STORED,
        ADD COLUMN phone_match_key text GENERATED ALWAYS AS (consumer_phone_match_key(whatsapp_normalized)) STORED,
        ADD COLUMN merged_into_consumer_id varchar(30) NULL,
        ADD COLUMN merged_at timestamptz(3) NULL,
        ADD COLUMN merged_by_user_id varchar(30) NULL,
        ADD COLUMN updated_at timestamptz(3) NOT NULL DEFAULT now(),
        ADD CONSTRAINT fk_consumers_merged_into FOREIGN KEY (tenant_id, merged_into_consumer_id)
          REFERENCES consumers (tenant_id, id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_consumers_merged_by FOREIGN KEY (merged_by_user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        ADD CONSTRAINT ck_consumers_not_merged_into_self CHECK (merged_into_consumer_id <> id),
        ADD CONSTRAINT ck_consumers_merge_fields CHECK (
          (merged_into_consumer_id IS NULL AND merged_at IS NULL AND merged_by_user_id IS NULL)
          OR (merged_into_consumer_id IS NOT NULL AND merged_at IS NOT NULL AND merged_by_user_id IS NOT NULL)
        )
    `);

    await queryRunner.query(`
      CREATE FUNCTION reject_update_insert_only() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'A tabela % só aceita inserção.', TG_TABLE_NAME USING ERRCODE = '${INSERT_ONLY_SQLSTATE}';
        END
        $$
    `);

    await queryRunner.query(`
      CREATE TABLE consumer_create_requests (
        tenant_id varchar(30) NOT NULL,
        request_key varchar(80) NOT NULL,
        request_fingerprint char(64) NOT NULL,
        consumer_id varchar(30) NOT NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_consumer_create_requests PRIMARY KEY (tenant_id, request_key),
        CONSTRAINT fk_consumer_create_requests_consumer FOREIGN KEY (tenant_id, consumer_id)
          REFERENCES consumers (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT ck_consumer_create_requests_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')
      )
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_consumer_create_requests_insert_only
        BEFORE UPDATE ON consumer_create_requests
        FOR EACH ROW EXECUTE FUNCTION reject_update_insert_only()
    `);

    await queryRunner.query(`
      CREATE TABLE whatsapp_consent_events (
        id bigint GENERATED ALWAYS AS IDENTITY,
        tenant_id varchar(30) NOT NULL,
        whatsapp_normalized varchar NOT NULL,
        kind varchar(10) NOT NULL,
        source varchar(40) NOT NULL,
        occurred_at timestamptz(3) NOT NULL,
        consumer_id varchar(30) NULL,
        recorded_by_user_id varchar(30) NULL,
        recorded_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_whatsapp_consent_events PRIMARY KEY (id),
        CONSTRAINT fk_whatsapp_consent_events_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT fk_whatsapp_consent_events_consumer FOREIGN KEY (tenant_id, consumer_id)
          REFERENCES consumers (tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT fk_whatsapp_consent_events_recorded_by FOREIGN KEY (recorded_by_user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_whatsapp_consent_events_kind CHECK (kind IN (${CONSENT_KINDS.map((k) => `'${k}'`).join(', ')}))
      )
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_whatsapp_consent_events_insert_only
        BEFORE UPDATE ON whatsapp_consent_events
        FOR EACH ROW EXECUTE FUNCTION reject_update_insert_only()
    `);
    await queryRunner.query(`
      INSERT INTO whatsapp_consent_events (tenant_id, whatsapp_normalized, kind, source, occurred_at, consumer_id)
      SELECT tenant_id, whatsapp_normalized, 'OPT_IN', coalesce(whatsapp_opt_in_source, '${LEGACY_CONSENT_SOURCE}'),
             whatsapp_opt_in_at, id
        FROM consumers WHERE whatsapp_opt_in_at IS NOT NULL
      UNION ALL
      SELECT tenant_id, whatsapp_normalized, 'OPT_OUT', '${LEGACY_CONSENT_SOURCE}', whatsapp_opt_out_at, id
        FROM consumers WHERE whatsapp_opt_out_at IS NOT NULL
    `);
    // A decisão de envio, numa fonte só: o evento mais recente do NÚMERO
    // neste estabelecimento vence; no empate de horário, o opt-out. Sem
    // evento, NULL (não envia).
    await queryRunner.query(`
      CREATE FUNCTION whatsapp_consent_current(p_tenant_id varchar, p_whatsapp_normalized varchar) RETURNS varchar
        LANGUAGE sql STABLE PARALLEL SAFE
        AS $$
          SELECT e.kind FROM whatsapp_consent_events e
           WHERE e.tenant_id = p_tenant_id AND e.whatsapp_normalized = p_whatsapp_normalized
           ORDER BY e.occurred_at DESC, (e.kind = 'OPT_OUT') DESC, e.id DESC
           LIMIT 1
        $$
    `);

    await queryRunner.query(`
      CREATE FUNCTION appointments_consumer_active() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          principal varchar(30);
        BEGIN
          IF TG_OP = 'UPDATE' AND NEW.consumer_id = OLD.consumer_id THEN
            RETURN NEW;
          END IF;
          SELECT merged_into_consumer_id INTO principal
            FROM consumers
           WHERE tenant_id = NEW.tenant_id AND id = NEW.consumer_id
             FOR SHARE;
          IF principal IS NOT NULL THEN
            RAISE EXCEPTION 'Cadastro de cliente unificado.'
              USING ERRCODE = '${CONSUMER_MERGED_SQLSTATE}', DETAIL = principal;
          END IF;
          RETURN NEW;
        END
        $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_appointments_consumer_active
        BEFORE INSERT OR UPDATE OF consumer_id ON appointments
        FOR EACH ROW EXECUTE FUNCTION appointments_consumer_active()
    `);

    await queryRunner.query(`
      CREATE INDEX idx_consumers_tenant_phone_match_active ON consumers (tenant_id, phone_match_key)
        WHERE merged_into_consumer_id IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_consumers_tenant_whatsapp_name_active ON consumers (tenant_id, whatsapp_normalized, name_key)
        WHERE merged_into_consumer_id IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_consumers_tenant_name_key_active ON consumers (tenant_id, name_key)
        WHERE merged_into_consumer_id IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX idx_appointments_tenant_consumer_start ON appointments (tenant_id, consumer_id, start_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_whatsapp_consent_events_phone ON whatsapp_consent_events (tenant_id, whatsapp_normalized, occurred_at)`,
    );
  }

  /** Só para ensaio. Recusa desfazer se já houver cadastro unificado,
   * pedido de cadastro ou evento de preferência gravado depois da migration
   * (perderia histórico). */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const [linha] = (await queryRunner.query(`
      SELECT (SELECT count(*) FROM consumers WHERE merged_into_consumer_id IS NOT NULL)::int AS unificados,
             (SELECT count(*) FROM consumer_create_requests)::int AS pedidos,
             -- eventos que NÃO vieram do backfill (não batem com as colunas
             -- antigas do cadastro de origem)
             (SELECT count(*) FROM whatsapp_consent_events e
               WHERE NOT EXISTS (
                 SELECT 1 FROM consumers c
                  WHERE c.tenant_id = e.tenant_id AND c.id = e.consumer_id
                    AND ((e.kind = 'OPT_IN' AND c.whatsapp_opt_in_at = e.occurred_at)
                      OR (e.kind = 'OPT_OUT' AND c.whatsapp_opt_out_at = e.occurred_at))
               ))::int AS eventos
    `)) as { unificados: number; pedidos: number; eventos: number }[];
    if (linha.unificados > 0 || linha.pedidos > 0 || linha.eventos > 0) {
      throw new Error('ConsumerIdentity: já há dados que só existem neste schema; o retorno é só para frente.');
    }
    await queryRunner.query(`DROP INDEX idx_appointments_tenant_consumer_start`);
    await queryRunner.query(`DROP TRIGGER trg_appointments_consumer_active ON appointments`);
    await queryRunner.query(`DROP FUNCTION appointments_consumer_active()`);
    await queryRunner.query(`DROP FUNCTION whatsapp_consent_current(varchar, varchar)`);
    await queryRunner.query(`DROP TABLE whatsapp_consent_events`);
    await queryRunner.query(`DROP TABLE consumer_create_requests`);
    await queryRunner.query(`DROP FUNCTION reject_update_insert_only()`);
    await queryRunner.query(`DROP INDEX idx_consumers_tenant_name_key_active`);
    await queryRunner.query(`DROP INDEX idx_consumers_tenant_whatsapp_name_active`);
    await queryRunner.query(`DROP INDEX idx_consumers_tenant_phone_match_active`);
    await queryRunner.query(`
      ALTER TABLE consumers
        DROP CONSTRAINT ck_consumers_merge_fields,
        DROP CONSTRAINT ck_consumers_not_merged_into_self,
        DROP CONSTRAINT fk_consumers_merged_by,
        DROP CONSTRAINT fk_consumers_merged_into,
        DROP COLUMN updated_at,
        DROP COLUMN merged_by_user_id,
        DROP COLUMN merged_at,
        DROP COLUMN merged_into_consumer_id,
        DROP COLUMN phone_match_key,
        DROP COLUMN name_key
    `);
    await queryRunner.query(`DROP FUNCTION consumer_phone_match_key(text)`);
    await queryRunner.query(`DROP FUNCTION consumer_name_key(text)`);
  }
}
