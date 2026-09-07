// Migration inicial TypeORM — baseline vazio do Neon (Lote 4: 0 tabelas, 0
// enums, `citext`/`btree_gist` não instaladas, confirmado em
// docs/audits/neon-lote-4-inventario.md). Cobre as 30 tabelas / 18 enums das
// entidades atuais de backend/src/entities/, escrita manualmente a partir
// delas (nunca gerada contra o Neon — ver docs/audits/neon-lote-5-migration-review.md
// para a justificativa de não conectar).
//
// Cada bloco de statements é exportado separadamente (EXTENSION/ENUM/TABLE/
// UNIQUE/FOREIGN_KEY/CHECK/EXCLUSION/INDEX) para que os testes de contrato
// (`1788782400000-InitialSchema.*.spec.ts`) inspecionem o SQL como string,
// sem nunca precisar de um QueryRunner real nem de rede — importar este
// módulo não abre nenhuma conexão.
//
// Ordem de `up()` (seção 12 da issue): extensões → enums → tabelas (pais
// antes de filhas) → uniques (auxiliares de tenant + `@Unique`/`@Index
// {unique:true}` das entidades) → FKs (simples e compostas) → checks →
// exclusion constraint → índices. `down()` é a ordem inversa da criação de
// tabela a tabela — nenhum `DROP TABLE` precisa de `CASCADE` porque toda
// tabela filha já foi removida antes da sua tabela-pai (ver
// DROP_TABLE_STATEMENTS abaixo). Nenhum `transaction = false` é declarado —
// o runner de migrations do TypeORM já executa `up()`/`down()) dentro de uma
// única transação por padrão, satisfazendo "transação única" sem precisar de
// `BEGIN`/`COMMIT` manual.
//
// Nomes de constraint/índice são legíveis (`uq_...`, `fk_...`, `ck_...`,
// `idx_...`) em vez dos hashes que `typeorm migration:generate` teria
// produzido — decisão deliberada de revisabilidade, documentada em
// docs/audits/neon-lote-5-migration-review.md junto com as demais divergências
// intencionais em relação ao que um `generate` real produziria (nomes de tipo
// enum compartilhados em vez de um tipo por coluna, e o `ON DELETE` do FK
// composto de `memberships` — ver comentário na seção de FKs abaixo).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const EXTENSION_STATEMENTS: readonly string[] = [
  'CREATE EXTENSION IF NOT EXISTS citext',
  'CREATE EXTENSION IF NOT EXISTS btree_gist',
];

// 18 enums (16 herdados do Prisma + `CommissionType`/`CommissionEntryStatus`
// novos, ver docs/plans/migracao-nestjs-typeorm-neon.md, seção 3.1). Um tipo
// Postgres por enum lógico, reaproveitado entre colunas/tabelas — não o
// default do TypeORM de um tipo por coluna (`<tabela>_<coluna>_enum`).
// Divergência documentada: se um `migration:generate` real for rodado no
// futuro sem que as entidades ganhem `enumName` explícito, ele vai detectar
// "tipos renomeados" para cada coluna enum — cosmético, não estrutural (ver
// review).
export const ENUM_STATEMENTS: readonly string[] = [
  `CREATE TYPE platform_role AS ENUM ('MASTER_OWNER', 'MASTER_ADMIN', 'MASTER_SUPPORT')`,
  `CREATE TYPE platform_permission AS ENUM ('ESTABLISHMENTS_MANAGE', 'ADMINISTRATORS_MANAGE', 'PLANS_MANAGE', 'SUPPORT_ACCESS')`,
  `CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED', 'INVITED')`,
  `CREATE TYPE tenant_status AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'PAST_DUE', 'CANCELED')`,
  `CREATE TYPE business_category AS ENUM ('BARBERSHOP', 'HAIR_SALON', 'CLINIC', 'DENTAL_CLINIC', 'AESTHETICS', 'TATTOO', 'PET_SHOP', 'OTHER')`,
  `CREATE TYPE page_template AS ENUM ('CLASSIC', 'MODERN')`,
  `CREATE TYPE feature_key AS ENUM ('AGENDA', 'AGENDAMENTO_PUBLICO', 'PROFISSIONAIS', 'CONSUMIDORES', 'RELATORIOS', 'EQUIPE', 'PERSONALIZACAO_AVANCADA', 'MULTIPLAS_UNIDADES', 'DOMINIO_PROPRIO', 'LISTA_DE_ESPERA', 'COMISSOES', 'PAGAMENTOS', 'ASSINATURAS')`,
  `CREATE TYPE establishment_role AS ENUM ('DONO', 'GERENTE', 'RECEPCIONISTA', 'PROFISSIONAL')`,
  `CREATE TYPE permission AS ENUM ('DASHBOARD_VISUALIZAR', 'AGENDA_VISUALIZAR', 'AGENDA_GERENCIAR', 'AGENDAMENTO_CRIAR', 'AGENDAMENTO_EDITAR', 'AGENDAMENTO_CANCELAR', 'PROFISSIONAIS_VISUALIZAR', 'PROFISSIONAIS_GERENCIAR', 'SERVICOS_VISUALIZAR', 'SERVICOS_GERENCIAR', 'CONSUMIDORES_VISUALIZAR', 'CONSUMIDORES_GERENCIAR', 'RELATORIOS_VISUALIZAR', 'EQUIPE_VISUALIZAR', 'EQUIPE_GERENCIAR', 'COMISSOES_VISUALIZAR', 'COMISSOES_GERENCIAR', 'PERSONALIZACAO_GERENCIAR', 'CONFIGURACOES_GERENCIAR')`,
  `CREATE TYPE permission_mode AS ENUM ('GRANTED', 'DENIED')`,
  `CREATE TYPE invite_type AS ENUM ('ESTABLISHMENT', 'PLATFORM')`,
  `CREATE TYPE invite_status AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')`,
  `CREATE TYPE audit_action AS ENUM ('TENANT_CREATED', 'TENANT_PLAN_CHANGED', 'TENANT_FEATURE_CHANGED', 'TENANT_SUSPENDED', 'TENANT_REACTIVATED', 'MASTER_CREATED', 'MASTER_REMOVED', 'USER_INVITED', 'USER_PERMISSION_CHANGED', 'SUPPORT_ACCESSED', 'IDENTITY_CHANGED', 'TENANT_SUPPORT_ENTERED', 'TENANT_SUPPORT_EXITED')`,
  `CREATE TYPE resource_type AS ENUM ('CHAIR', 'ROOM', 'OFFICE', 'EQUIPMENT', 'TABLE', 'VEHICLE', 'OTHER')`,
  `CREATE TYPE service_modality AS ENUM ('IN_PERSON', 'REMOTE', 'HOME')`,
  `CREATE TYPE appointment_status AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW')`,
  `CREATE TYPE commission_type AS ENUM ('PERCENTAGE', 'FIXED')`,
  `CREATE TYPE commission_entry_status AS ENUM ('CONFIRMED', 'REVERSED')`,
];

// 30 tabelas, na ordem de dependência (pai sempre antes de filha) — mesma
// ordem usada, invertida, em DROP_TABLE_STATEMENTS. Só colunas + PK aqui;
// UNIQUE/FK/CHECK/EXCLUDE/índice vêm nas seções seguintes (seção 12 da
// issue).
export const TABLE_STATEMENTS: readonly string[] = [
  `CREATE TABLE plans (
    id VARCHAR(30) NOT NULL,
    code VARCHAR NOT NULL,
    name VARCHAR NOT NULL,
    price_cents INTEGER NOT NULL,
    short_description VARCHAR NOT NULL,
    max_professionals INTEGER NOT NULL,
    max_units INTEGER NOT NULL,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT pk_plans PRIMARY KEY (id)
  )`,
  `CREATE TABLE features (
    id VARCHAR(30) NOT NULL,
    key feature_key NOT NULL,
    label VARCHAR NOT NULL,
    CONSTRAINT pk_features PRIMARY KEY (id)
  )`,
  `CREATE TABLE users (
    id VARCHAR(30) NOT NULL,
    name VARCHAR NOT NULL,
    email CITEXT NOT NULL,
    phone VARCHAR,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    image VARCHAR,
    status user_status NOT NULL DEFAULT 'ACTIVE',
    platform_role platform_role,
    platform_permissions platform_permission[],
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ(3),
    CONSTRAINT pk_users PRIMARY KEY (id)
  )`,
  `CREATE TABLE plan_features (
    id VARCHAR(30) NOT NULL,
    plan_id VARCHAR(30) NOT NULL,
    feature_id VARCHAR(30) NOT NULL,
    CONSTRAINT pk_plan_features PRIMARY KEY (id)
  )`,
  `CREATE TABLE tenants (
    id VARCHAR(30) NOT NULL,
    slug CITEXT NOT NULL,
    category business_category NOT NULL,
    tax_document VARCHAR,
    timezone VARCHAR NOT NULL,
    plan_id VARCHAR(30) NOT NULL,
    status tenant_status NOT NULL DEFAULT 'TRIAL',
    suspension_reason VARCHAR,
    professional_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT pk_tenants PRIMARY KEY (id)
  )`,
  `CREATE TABLE credentials (
    id VARCHAR(30) NOT NULL,
    user_id VARCHAR(30) NOT NULL,
    password_hash VARCHAR NOT NULL,
    algorithm VARCHAR NOT NULL,
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT pk_credentials PRIMARY KEY (id)
  )`,
  `CREATE TABLE sessions (
    id VARCHAR(30) NOT NULL,
    user_id VARCHAR(30) NOT NULL,
    token_hash VARCHAR NOT NULL,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ(3) NOT NULL,
    revoked_at TIMESTAMPTZ(3),
    user_agent VARCHAR,
    ip_address VARCHAR,
    CONSTRAINT pk_sessions PRIMARY KEY (id)
  )`,
  `CREATE TABLE brand_identities (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    name VARCHAR NOT NULL,
    short_name VARCHAR NOT NULL,
    logo_initials VARCHAR NOT NULL,
    primary_color VARCHAR NOT NULL,
    secondary_color VARCHAR NOT NULL,
    accent_color VARCHAR NOT NULL,
    style VARCHAR NOT NULL,
    template page_template NOT NULL DEFAULT 'CLASSIC',
    address VARCHAR NOT NULL,
    phone VARCHAR NOT NULL,
    email VARCHAR,
    instagram VARCHAR,
    facebook VARCHAR,
    presentation_text VARCHAR NOT NULL,
    photos TEXT[] NOT NULL,
    banner_url VARCHAR,
    logo_url VARCHAR,
    section_order TEXT[] NOT NULL,
    custom_footer VARCHAR,
    hide_platform_branding BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT pk_brand_identities PRIMARY KEY (id)
  )`,
  `CREATE TABLE booking_policies (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    min_lead_minutes INTEGER NOT NULL,
    max_future_days INTEGER NOT NULL,
    cancellation_hours INTEGER NOT NULL,
    auto_confirm BOOLEAN NOT NULL,
    allow_any_professional BOOLEAN NOT NULL,
    allow_client_reschedule BOOLEAN NOT NULL,
    require_client_phone BOOLEAN NOT NULL,
    require_client_email BOOLEAN NOT NULL,
    show_public_price BOOLEAN NOT NULL,
    default_buffer_minutes INTEGER NOT NULL,
    visit_guidance VARCHAR,
    CONSTRAINT pk_booking_policies PRIMARY KEY (id)
  )`,
  `CREATE TABLE public_settings (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    is_published BOOLEAN NOT NULL DEFAULT true,
    operating_days INTEGER[] NOT NULL,
    open_time VARCHAR NOT NULL,
    close_time VARCHAR NOT NULL,
    CONSTRAINT pk_public_settings PRIMARY KEY (id)
  )`,
  `CREATE TABLE tenant_feature_overrides (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    feature_id VARCHAR(30) NOT NULL,
    enabled BOOLEAN NOT NULL,
    CONSTRAINT pk_tenant_feature_overrides PRIMARY KEY (id)
  )`,
  `CREATE TABLE units (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    name VARCHAR NOT NULL,
    address VARCHAR NOT NULL,
    timezone VARCHAR NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT pk_units PRIMARY KEY (id)
  )`,
  `CREATE TABLE professionals (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    unit_id VARCHAR(30),
    name VARCHAR NOT NULL,
    avatar_initials VARCHAR NOT NULL,
    avatar_color VARCHAR NOT NULL,
    online_booking_active BOOLEAN NOT NULL DEFAULT true,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT pk_professionals PRIMARY KEY (id)
  )`,
  `CREATE TABLE services (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    name VARCHAR NOT NULL,
    short_description VARCHAR NOT NULL,
    price_cents INTEGER,
    price_visible BOOLEAN NOT NULL DEFAULT true,
    duration_minutes INTEGER NOT NULL,
    buffer_after_minutes INTEGER NOT NULL DEFAULT 0,
    modality service_modality NOT NULL DEFAULT 'IN_PERSON',
    active_in_public_booking BOOLEAN NOT NULL DEFAULT true,
    requires_manual_confirmation BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT pk_services PRIMARY KEY (id)
  )`,
  `CREATE TABLE consumers (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    name VARCHAR NOT NULL,
    whatsapp VARCHAR NOT NULL,
    whatsapp_normalized VARCHAR NOT NULL,
    email VARCHAR,
    total_visits INTEGER NOT NULL DEFAULT 0,
    total_no_shows INTEGER NOT NULL DEFAULT 0,
    last_served_at TIMESTAMPTZ(3),
    next_appointment_at TIMESTAMPTZ(3),
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT pk_consumers PRIMARY KEY (id)
  )`,
  `CREATE TABLE resources (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    name VARCHAR NOT NULL,
    type resource_type NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT pk_resources PRIMARY KEY (id)
  )`,
  `CREATE TABLE memberships (
    id VARCHAR(30) NOT NULL,
    user_id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    role establishment_role NOT NULL,
    professional_id VARCHAR(30),
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT pk_memberships PRIMARY KEY (id)
  )`,
  `CREATE TABLE membership_permission_overrides (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    membership_id VARCHAR(30) NOT NULL,
    permission permission NOT NULL,
    mode permission_mode NOT NULL,
    CONSTRAINT pk_membership_permission_overrides PRIMARY KEY (id)
  )`,
  `CREATE TABLE invites (
    id VARCHAR(30) NOT NULL,
    type invite_type NOT NULL,
    target_name VARCHAR NOT NULL,
    target_email CITEXT NOT NULL,
    tenant_id VARCHAR(30),
    establishment_role establishment_role,
    platform_role platform_role,
    status invite_status NOT NULL DEFAULT 'PENDING',
    token_hash VARCHAR NOT NULL,
    created_by_user_id VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ(3) NOT NULL,
    accepted_at TIMESTAMPTZ(3),
    revoked_at TIMESTAMPTZ(3),
    generated_user_id VARCHAR(30),
    CONSTRAINT pk_invites PRIMARY KEY (id)
  )`,
  `CREATE TABLE support_sessions (
    id VARCHAR(30) NOT NULL,
    master_user_id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    started_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ(3),
    reason VARCHAR,
    CONSTRAINT pk_support_sessions PRIMARY KEY (id)
  )`,
  `CREATE TABLE audit_logs (
    id VARCHAR(30) NOT NULL,
    occurred_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    action audit_action NOT NULL,
    actor_user_id VARCHAR(30) NOT NULL,
    actor_name VARCHAR NOT NULL,
    tenant_id VARCHAR(30),
    summary VARCHAR NOT NULL,
    previous_data JSONB,
    new_data JSONB,
    support_session_id VARCHAR(30),
    CONSTRAINT pk_audit_logs PRIMARY KEY (id)
  )`,
  `CREATE TABLE professional_schedules (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    professional_id VARCHAR(30) NOT NULL,
    weekday INTEGER NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    start_time VARCHAR NOT NULL,
    end_time VARCHAR NOT NULL,
    lunch_start VARCHAR,
    lunch_end VARCHAR,
    CONSTRAINT pk_professional_schedules PRIMARY KEY (id)
  )`,
  `CREATE TABLE professional_services (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    professional_id VARCHAR(30) NOT NULL,
    service_id VARCHAR(30) NOT NULL,
    CONSTRAINT pk_professional_services PRIMARY KEY (id)
  )`,
  `CREATE TABLE time_blocks (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    professional_id VARCHAR(30) NOT NULL,
    start_at TIMESTAMPTZ(3) NOT NULL,
    end_at TIMESTAMPTZ(3) NOT NULL,
    reason VARCHAR NOT NULL,
    CONSTRAINT pk_time_blocks PRIMARY KEY (id)
  )`,
  `CREATE TABLE appointments (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    unit_id VARCHAR(30) NOT NULL,
    consumer_id VARCHAR(30) NOT NULL,
    consumer_name_snapshot VARCHAR NOT NULL,
    consumer_whatsapp_snapshot VARCHAR NOT NULL,
    professional_id VARCHAR(30) NOT NULL,
    start_at TIMESTAMPTZ(3) NOT NULL,
    end_at TIMESTAMPTZ(3) NOT NULL,
    status appointment_status NOT NULL DEFAULT 'PENDING',
    notes VARCHAR,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT pk_appointments PRIMARY KEY (id)
  )`,
  `CREATE TABLE appointment_items (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    appointment_id VARCHAR(30) NOT NULL,
    service_id VARCHAR(30) NOT NULL,
    price_cents_snapshot INTEGER,
    duration_minutes_snapshot INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT pk_appointment_items PRIMARY KEY (id)
  )`,
  `CREATE TABLE appointment_resources (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    appointment_id VARCHAR(30) NOT NULL,
    resource_id VARCHAR(30) NOT NULL,
    CONSTRAINT pk_appointment_resources PRIMARY KEY (id)
  )`,
  `CREATE TABLE appointment_status_changes (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    appointment_id VARCHAR(30) NOT NULL,
    occurred_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    from_status appointment_status,
    to_status appointment_status NOT NULL,
    changed_by VARCHAR NOT NULL,
    CONSTRAINT pk_appointment_status_changes PRIMARY KEY (id)
  )`,
  `CREATE TABLE commission_rules (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    professional_id VARCHAR(30) NOT NULL,
    service_id VARCHAR(30) NOT NULL,
    type commission_type NOT NULL,
    value INTEGER NOT NULL,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    CONSTRAINT pk_commission_rules PRIMARY KEY (id)
  )`,
  `CREATE TABLE commission_entries (
    id VARCHAR(30) NOT NULL,
    tenant_id VARCHAR(30) NOT NULL,
    appointment_id VARCHAR(30) NOT NULL,
    professional_id VARCHAR(30) NOT NULL,
    service_id VARCHAR(30) NOT NULL,
    price_cents_snapshot INTEGER NOT NULL,
    applied_type commission_type NOT NULL,
    applied_value INTEGER NOT NULL,
    professional_cents INTEGER NOT NULL,
    establishment_cents INTEGER NOT NULL,
    service_date TIMESTAMPTZ(3) NOT NULL,
    calculated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    status commission_entry_status NOT NULL DEFAULT 'CONFIRMED',
    reversed_at TIMESTAMPTZ(3),
    reactivated_at TIMESTAMPTZ(3),
    CONSTRAINT pk_commission_entries PRIMARY KEY (id)
  )`,
];

// UNIQUE(tenant_id, id) nas 5 tabelas-pai referenciadas por FK composta de
// tenant (seção 7 da issue) — pré-requisito técnico do Postgres para que uma
// FOREIGN KEY composta (tenant_id, x) possa referenciar (tenant_id, id).
export const TENANT_PARENT_UNIQUE_STATEMENTS: readonly string[] = [
  'ALTER TABLE professionals ADD CONSTRAINT uq_professionals_tenant_id UNIQUE (tenant_id, id)',
  'ALTER TABLE services ADD CONSTRAINT uq_services_tenant_id UNIQUE (tenant_id, id)',
  'ALTER TABLE consumers ADD CONSTRAINT uq_consumers_tenant_id UNIQUE (tenant_id, id)',
  'ALTER TABLE memberships ADD CONSTRAINT uq_memberships_tenant_id UNIQUE (tenant_id, id)',
  'ALTER TABLE appointments ADD CONSTRAINT uq_appointments_tenant_id UNIQUE (tenant_id, id)',
];

// `@Unique([...])` de classe nas entidades — constraints de unicidade
// "de negócio", nunca decorativas.
export const BUSINESS_UNIQUE_STATEMENTS: readonly string[] = [
  'ALTER TABLE plan_features ADD CONSTRAINT uq_plan_features_plan_feature UNIQUE (plan_id, feature_id)',
  'ALTER TABLE tenant_feature_overrides ADD CONSTRAINT uq_tenant_feature_overrides_tenant_feature UNIQUE (tenant_id, feature_id)',
  'ALTER TABLE memberships ADD CONSTRAINT uq_memberships_user_tenant UNIQUE (user_id, tenant_id)',
  'ALTER TABLE membership_permission_overrides ADD CONSTRAINT uq_membership_permission_overrides_tenant_membership_permission UNIQUE (tenant_id, membership_id, permission)',
  'ALTER TABLE consumers ADD CONSTRAINT uq_consumers_tenant_whatsapp UNIQUE (tenant_id, whatsapp_normalized)',
  'ALTER TABLE professional_schedules ADD CONSTRAINT uq_professional_schedules_tenant_professional_weekday UNIQUE (tenant_id, professional_id, weekday)',
  'ALTER TABLE professional_services ADD CONSTRAINT uq_professional_services_tenant_professional_service UNIQUE (tenant_id, professional_id, service_id)',
  'ALTER TABLE appointment_resources ADD CONSTRAINT uq_appointment_resources_tenant_appointment_resource UNIQUE (tenant_id, appointment_id, resource_id)',
  'ALTER TABLE commission_rules ADD CONSTRAINT uq_commission_rules_tenant_professional_service UNIQUE (tenant_id, professional_id, service_id)',
];

// `@Index({ unique: true })` de coluna nas entidades — índice único, não
// constraint nomeada (mesma semântica que o TypeORM aplicaria).
export const UNIQUE_INDEX_STATEMENTS: readonly string[] = [
  'CREATE UNIQUE INDEX uq_plans_code ON plans (code)',
  'CREATE UNIQUE INDEX uq_features_key ON features (key)',
  'CREATE UNIQUE INDEX uq_users_email ON users (email)',
  'CREATE UNIQUE INDEX uq_tenants_slug ON tenants (slug)',
  'CREATE UNIQUE INDEX uq_credentials_user_id ON credentials (user_id)',
  'CREATE UNIQUE INDEX uq_sessions_token_hash ON sessions (token_hash)',
  'CREATE UNIQUE INDEX uq_brand_identities_tenant_id ON brand_identities (tenant_id)',
  'CREATE UNIQUE INDEX uq_booking_policies_tenant_id ON booking_policies (tenant_id)',
  'CREATE UNIQUE INDEX uq_public_settings_tenant_id ON public_settings (tenant_id)',
  'CREATE UNIQUE INDEX uq_memberships_professional_id ON memberships (professional_id) WHERE professional_id IS NOT NULL',
  'CREATE UNIQUE INDEX uq_invites_token_hash ON invites (token_hash)',
  'CREATE UNIQUE INDEX uq_commission_entries_appointment_id ON commission_entries (appointment_id)',
];

export const UNIQUE_STATEMENTS: readonly string[] = [
  ...TENANT_PARENT_UNIQUE_STATEMENTS,
  ...BUSINESS_UNIQUE_STATEMENTS,
  ...UNIQUE_INDEX_STATEMENTS,
];

// FKs simples — uma única coluna, sem exigência de consistência de tenant
// (fora da lista da seção 7 da issue).
export const SIMPLE_FOREIGN_KEY_STATEMENTS: readonly string[] = [
  'ALTER TABLE plan_features ADD CONSTRAINT fk_plan_features_plan FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE CASCADE',
  'ALTER TABLE plan_features ADD CONSTRAINT fk_plan_features_feature FOREIGN KEY (feature_id) REFERENCES features (id) ON DELETE CASCADE',
  'ALTER TABLE tenants ADD CONSTRAINT fk_tenants_plan FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE RESTRICT',
  'ALTER TABLE credentials ADD CONSTRAINT fk_credentials_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE',
  'ALTER TABLE sessions ADD CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE',
  'ALTER TABLE brand_identities ADD CONSTRAINT fk_brand_identities_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE',
  'ALTER TABLE booking_policies ADD CONSTRAINT fk_booking_policies_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE',
  'ALTER TABLE public_settings ADD CONSTRAINT fk_public_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE',
  'ALTER TABLE tenant_feature_overrides ADD CONSTRAINT fk_tenant_feature_overrides_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE',
  'ALTER TABLE tenant_feature_overrides ADD CONSTRAINT fk_tenant_feature_overrides_feature FOREIGN KEY (feature_id) REFERENCES features (id) ON DELETE CASCADE',
  'ALTER TABLE units ADD CONSTRAINT fk_units_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE professionals ADD CONSTRAINT fk_professionals_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE professionals ADD CONSTRAINT fk_professionals_unit FOREIGN KEY (unit_id) REFERENCES units (id) ON DELETE SET NULL',
  'ALTER TABLE services ADD CONSTRAINT fk_services_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE consumers ADD CONSTRAINT fk_consumers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE resources ADD CONSTRAINT fk_resources_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE memberships ADD CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT',
  'ALTER TABLE memberships ADD CONSTRAINT fk_memberships_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE invites ADD CONSTRAINT fk_invites_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE invites ADD CONSTRAINT fk_invites_created_by_user FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT',
  'ALTER TABLE support_sessions ADD CONSTRAINT fk_support_sessions_master_user FOREIGN KEY (master_user_id) REFERENCES users (id) ON DELETE RESTRICT',
  'ALTER TABLE support_sessions ADD CONSTRAINT fk_support_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_actor_user FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT',
  'ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_support_session FOREIGN KEY (support_session_id) REFERENCES support_sessions (id) ON DELETE RESTRICT',
  // `time_blocks` × profissional não está na lista de FK composta da seção 7
  // da issue ("agenda profissional × profissional" cobre só
  // `professional_schedules`, não bloqueios) — mantido simples de propósito,
  // gap documentado em docs/audits/neon-lote-5-migration-review.md (isolamento
  // de tenant aqui é responsabilidade do serviço, que sempre filtra por
  // tenant_id explícito nas queries de bloqueio).
  'ALTER TABLE time_blocks ADD CONSTRAINT fk_time_blocks_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE time_blocks ADD CONSTRAINT fk_time_blocks_professional FOREIGN KEY (professional_id) REFERENCES professionals (id) ON DELETE CASCADE',
  'ALTER TABLE appointments ADD CONSTRAINT fk_appointments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE appointments ADD CONSTRAINT fk_appointments_unit FOREIGN KEY (unit_id) REFERENCES units (id) ON DELETE RESTRICT',
  // `appointment_items` × `services` não está na lista da seção 7 (só
  // "itens ... × agendamento" exige composta) — serviço permanece FK simples.
  'ALTER TABLE appointment_items ADD CONSTRAINT fk_appointment_items_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE RESTRICT',
  // Idem para `appointment_resources` × `resources`.
  'ALTER TABLE appointment_resources ADD CONSTRAINT fk_appointment_resources_resource FOREIGN KEY (resource_id) REFERENCES resources (id) ON DELETE RESTRICT',
  'ALTER TABLE commission_rules ADD CONSTRAINT fk_commission_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
  'ALTER TABLE commission_entries ADD CONSTRAINT fk_commission_entries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT',
];

// FKs compostas (tenant_id, x) — as 8 relações multi-tenant da seção 7 da
// issue, implementadas via UNIQUE(tenant_id, id) na tabela-pai (acima) + FK
// composta na filha. `MATCH SIMPLE` (default do Postgres) faz a constraint
// só ser checada quando NENHUMA coluna da FK é nula — por isso
// `memberships.professional_id` (nullable) continua permitindo
// `professional_id IS NULL`, e só exige tenant igual quando preenchido.
//
// `memberships` → `professionals` usa `ON DELETE SET NULL (professional_id)`
// — sintaxe de coluna-alvo do Postgres 15+ (Neon roda 18.6, ver
// docs/audits/neon-lote-4-inventario.md) que restringe o `SET NULL` só à
// coluna listada, preservando `tenant_id` (`NOT NULL` em `memberships`) em
// vez de zerar todas as colunas da FK como um `SET NULL` comum faria. Alinha
// com o `ON DELETE SET NULL` já declarado na relação simples da entidade
// (`membership.entity.ts`) e com `memberships_professionalId_fkey` do Prisma
// original (prisma/migrations/20260901155542_init/migration.sql:563) —
// revisão anterior deste lote usava `RESTRICT` aqui por engano, corrigido
// nesta revisão.
export const TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS: readonly string[] = [
  'ALTER TABLE appointments ADD CONSTRAINT fk_appointments_tenant_professional FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE RESTRICT',
  'ALTER TABLE appointments ADD CONSTRAINT fk_appointments_tenant_consumer FOREIGN KEY (tenant_id, consumer_id) REFERENCES consumers (tenant_id, id) ON DELETE RESTRICT',
  'ALTER TABLE appointment_items ADD CONSTRAINT fk_appointment_items_tenant_appointment FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE',
  'ALTER TABLE appointment_resources ADD CONSTRAINT fk_appointment_resources_tenant_appointment FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE',
  'ALTER TABLE appointment_status_changes ADD CONSTRAINT fk_appointment_status_changes_tenant_appointment FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE',
  'ALTER TABLE professional_services ADD CONSTRAINT fk_professional_services_tenant_professional FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE CASCADE',
  'ALTER TABLE professional_services ADD CONSTRAINT fk_professional_services_tenant_service FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE CASCADE',
  'ALTER TABLE professional_schedules ADD CONSTRAINT fk_professional_schedules_tenant_professional FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE CASCADE',
  'ALTER TABLE memberships ADD CONSTRAINT fk_memberships_tenant_professional FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE SET NULL (professional_id)',
  'ALTER TABLE membership_permission_overrides ADD CONSTRAINT fk_membership_permission_overrides_tenant_membership FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships (tenant_id, id) ON DELETE CASCADE',
  'ALTER TABLE commission_rules ADD CONSTRAINT fk_commission_rules_tenant_professional FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE CASCADE',
  'ALTER TABLE commission_rules ADD CONSTRAINT fk_commission_rules_tenant_service FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE CASCADE',
  'ALTER TABLE commission_entries ADD CONSTRAINT fk_commission_entries_tenant_appointment FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE RESTRICT',
  'ALTER TABLE commission_entries ADD CONSTRAINT fk_commission_entries_tenant_professional FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE RESTRICT',
  'ALTER TABLE commission_entries ADD CONSTRAINT fk_commission_entries_tenant_service FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE RESTRICT',
];

export const FOREIGN_KEY_STATEMENTS: readonly string[] = [
  ...SIMPLE_FOREIGN_KEY_STATEMENTS,
  ...TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS,
];

export const CHECK_STATEMENTS: readonly string[] = [
  'ALTER TABLE appointments ADD CONSTRAINT ck_appointments_end_after_start CHECK (end_at > start_at)',
  // Pontos-base (0-10000 = 0%-100%) para regra percentual, centavos
  // não-negativos para regra fixa — nunca float (ver comentário de unidade em
  // commission-rule.entity.ts).
  `ALTER TABLE commission_rules ADD CONSTRAINT ck_commission_rules_value_range CHECK ((type = 'PERCENTAGE' AND value BETWEEN 0 AND 10000) OR (type = 'FIXED' AND value >= 0))`,
  `ALTER TABLE commission_entries ADD CONSTRAINT ck_commission_entries_applied_value_range CHECK ((applied_type = 'PERCENTAGE' AND applied_value BETWEEN 0 AND 10000) OR (applied_type = 'FIXED' AND applied_value >= 0))`,
  'ALTER TABLE commission_entries ADD CONSTRAINT ck_commission_entries_professional_cents_non_negative CHECK (professional_cents >= 0)',
  'ALTER TABLE commission_entries ADD CONSTRAINT ck_commission_entries_establishment_cents_non_negative CHECK (establishment_cents >= 0)',
  'ALTER TABLE commission_entries ADD CONSTRAINT ck_commission_entries_price_cents_snapshot_non_negative CHECK (price_cents_snapshot >= 0)',
  'ALTER TABLE appointment_items ADD CONSTRAINT ck_appointment_items_price_cents_snapshot_non_negative CHECK (price_cents_snapshot IS NULL OR price_cents_snapshot >= 0)',
  // Seção 10 da issue ("constraints que impeçam estados estruturalmente
  // inválidos") — sessão/convite nunca pode expirar antes de ter sido criada.
  'ALTER TABLE sessions ADD CONSTRAINT ck_sessions_expires_after_created CHECK (expires_at > created_at)',
  'ALTER TABLE invites ADD CONSTRAINT ck_invites_expires_after_created CHECK (expires_at > created_at)',
];

// Proteção contra dupla-reserva (seção 8 da issue) — texto adaptado de
// prisma/migrations/20260901155542_init/migration.sql:650-656 para
// snake_case, com `tenant_id` acrescentado à chave de exclusão (a issue pede
// "escopo correto por tenant" explicitamente; tecnicamente redundante já que
// `professional_id` só existe em um tenant, mas reforça a intenção e ajuda o
// planner a usar o índice GiST). Igualdade por `tenant_id` e `professional_id`
// via `WITH =`, sobreposição de intervalo via `tstzrange(..., '[)') WITH &&`
// — bounds `[)` (início inclusive, fim exclusivo) explícitos no terceiro
// argumento em vez de depender do default do construtor, para casar
// literalmente com `end_at` sendo o instante em que o próximo agendamento já
// pode começar. `WHERE (status <> 'CANCELED')` preservado tal como no
// Prisma — `NO_SHOW` continua ocupando a exclusão (divergência pré-existente
// entre banco e motor de disponibilidade da aplicação, ver
// docs/plans/migracao-nestjs-typeorm-neon.md, seção 7.1 — decisão de negócio
// em aberto, não "corrigida" nesta migration).
export const EXCLUSION_STATEMENTS: readonly string[] = [
  `ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap_excl
    EXCLUDE USING gist (
      tenant_id WITH =,
      professional_id WITH =,
      tstzrange(start_at, end_at, '[)') WITH &&
    )
    WHERE (status <> 'CANCELED')`,
];

// Índices não-únicos. Nenhum `CONCURRENTLY` (migration roda em transação
// única). Índices únicos já foram criados em UNIQUE_INDEX_STATEMENTS.
export const INDEX_STATEMENTS: readonly string[] = [
  'CREATE INDEX idx_tenants_status ON tenants (status)',
  'CREATE INDEX idx_sessions_user_id ON sessions (user_id)',
  // Seção 10 da issue ("índices de sessão e expiração") — não declarado no
  // decorator atual de session.entity.ts; acrescentado aqui por exigência
  // explícita da tarefa. Recomendação para o Lote 6: adicionar
  // `@Index() expiresAt` na entidade para não divergir de um
  // `migration:generate` futuro (ver review).
  'CREATE INDEX idx_sessions_expires_at ON sessions (expires_at)',
  'CREATE INDEX idx_units_tenant_id ON units (tenant_id)',
  'CREATE INDEX idx_professionals_tenant_id ON professionals (tenant_id)',
  'CREATE INDEX idx_services_tenant_id ON services (tenant_id)',
  'CREATE INDEX idx_consumers_whatsapp_normalized ON consumers (whatsapp_normalized)',
  'CREATE INDEX idx_resources_tenant_id ON resources (tenant_id)',
  'CREATE INDEX idx_memberships_tenant_id ON memberships (tenant_id)',
  'CREATE INDEX idx_membership_permission_overrides_tenant_id ON membership_permission_overrides (tenant_id)',
  'CREATE INDEX idx_invites_target_email ON invites (target_email)',
  'CREATE INDEX idx_invites_tenant_id_status ON invites (tenant_id, status)',
  'CREATE INDEX idx_support_sessions_master_user_id ON support_sessions (master_user_id)',
  'CREATE INDEX idx_support_sessions_tenant_id_started_at ON support_sessions (tenant_id, started_at)',
  'CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs (actor_user_id)',
  'CREATE INDEX idx_audit_logs_tenant_id_occurred_at ON audit_logs (tenant_id, occurred_at)',
  'CREATE INDEX idx_professional_schedules_tenant_id ON professional_schedules (tenant_id)',
  'CREATE INDEX idx_time_blocks_tenant_id ON time_blocks (tenant_id)',
  'CREATE INDEX idx_time_blocks_professional_id_start_at_end_at ON time_blocks (professional_id, start_at, end_at)',
  'CREATE INDEX idx_appointments_tenant_id_professional_id_start_at_end_at ON appointments (tenant_id, professional_id, start_at, end_at)',
  'CREATE INDEX idx_appointments_tenant_id_status_start_at ON appointments (tenant_id, status, start_at)',
  'CREATE INDEX idx_appointment_items_tenant_id ON appointment_items (tenant_id)',
  'CREATE INDEX idx_appointment_items_appointment_id ON appointment_items (appointment_id)',
  'CREATE INDEX idx_appointment_resources_tenant_id ON appointment_resources (tenant_id)',
  'CREATE INDEX idx_appointment_status_changes_tenant_id ON appointment_status_changes (tenant_id)',
  'CREATE INDEX idx_appointment_status_changes_appointment_id ON appointment_status_changes (appointment_id)',
  'CREATE INDEX idx_commission_entries_tenant_id_professional_id_service_date ON commission_entries (tenant_id, professional_id, service_date)',
];

export const UP_STATEMENTS: readonly string[] = [
  ...EXTENSION_STATEMENTS,
  ...ENUM_STATEMENTS,
  ...TABLE_STATEMENTS,
  ...UNIQUE_STATEMENTS,
  ...FOREIGN_KEY_STATEMENTS,
  ...CHECK_STATEMENTS,
  ...EXCLUSION_STATEMENTS,
  ...INDEX_STATEMENTS,
];

// Ordem inversa exata da criação de tabela (TABLE_STATEMENTS ao contrário) —
// toda tabela filha já foi removida antes de chegar na sua tabela-pai, então
// nenhum `DROP TABLE` precisa de `CASCADE`. `DROP TABLE` já remove sozinho
// PK/UNIQUE/FK/CHECK/EXCLUDE/índice da própria tabela — não é preciso
// desfazer cada `ADD CONSTRAINT`/`CREATE INDEX` um a um.
export const DROP_TABLE_STATEMENTS: readonly string[] = [
  'DROP TABLE commission_entries',
  'DROP TABLE commission_rules',
  'DROP TABLE appointment_status_changes',
  'DROP TABLE appointment_resources',
  'DROP TABLE appointment_items',
  'DROP TABLE appointments',
  'DROP TABLE time_blocks',
  'DROP TABLE professional_services',
  'DROP TABLE professional_schedules',
  'DROP TABLE audit_logs',
  'DROP TABLE support_sessions',
  'DROP TABLE invites',
  'DROP TABLE membership_permission_overrides',
  'DROP TABLE memberships',
  'DROP TABLE resources',
  'DROP TABLE consumers',
  'DROP TABLE services',
  'DROP TABLE professionals',
  'DROP TABLE units',
  'DROP TABLE tenant_feature_overrides',
  'DROP TABLE public_settings',
  'DROP TABLE booking_policies',
  'DROP TABLE brand_identities',
  'DROP TABLE sessions',
  'DROP TABLE credentials',
  'DROP TABLE tenants',
  'DROP TABLE plan_features',
  'DROP TABLE users',
  'DROP TABLE features',
  'DROP TABLE plans',
];

// Só depois de toda tabela removida — nenhuma coluna usa mais os tipos.
export const DROP_ENUM_STATEMENTS: readonly string[] = [
  'DROP TYPE appointment_status',
  'DROP TYPE audit_action',
  'DROP TYPE business_category',
  'DROP TYPE commission_entry_status',
  'DROP TYPE commission_type',
  'DROP TYPE establishment_role',
  'DROP TYPE feature_key',
  'DROP TYPE invite_status',
  'DROP TYPE invite_type',
  'DROP TYPE page_template',
  'DROP TYPE permission',
  'DROP TYPE permission_mode',
  'DROP TYPE platform_permission',
  'DROP TYPE platform_role',
  'DROP TYPE resource_type',
  'DROP TYPE service_modality',
  'DROP TYPE tenant_status',
  'DROP TYPE user_status',
];

// `citext`/`btree_gist` NUNCA são removidas em `down()` — são extensões
// compartilhadas do schema `public`; derrubá-las poderia afetar outro objeto
// não criado por esta migration (seção 5 da issue: "não remova extensões
// compartilhadas automaticamente"). Rollback sem dano colateral prioriza
// deixá-las instaladas mesmo depois de reverter todo o resto.
export const DOWN_STATEMENTS: readonly string[] = [
  ...DROP_TABLE_STATEMENTS,
  ...DROP_ENUM_STATEMENTS,
];

export class InitialSchema1788782400000 implements MigrationInterface {
  name = 'InitialSchema1788782400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of UP_STATEMENTS) {
      await queryRunner.query(statement);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const statement of DOWN_STATEMENTS) {
      await queryRunner.query(statement);
    }
  }
}
