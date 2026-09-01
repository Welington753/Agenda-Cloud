-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "prisma_postgres";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('MASTER_OWNER', 'MASTER_ADMIN', 'MASTER_SUPPORT');

-- CreateEnum
CREATE TYPE "PlatformPermission" AS ENUM ('ESTABLISHMENTS_MANAGE', 'ADMINISTRATORS_MANAGE', 'PLANS_MANAGE', 'SUPPORT_ACCESS');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INVITED');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "BusinessCategory" AS ENUM ('BARBERSHOP', 'HAIR_SALON', 'CLINIC', 'DENTAL_CLINIC', 'AESTHETICS', 'TATTOO', 'PET_SHOP', 'OTHER');

-- CreateEnum
CREATE TYPE "PageTemplate" AS ENUM ('CLASSIC', 'MODERN');

-- CreateEnum
CREATE TYPE "FeatureKey" AS ENUM ('AGENDA', 'AGENDAMENTO_PUBLICO', 'PROFISSIONAIS', 'CONSUMIDORES', 'RELATORIOS', 'EQUIPE', 'PERSONALIZACAO_AVANCADA', 'MULTIPLAS_UNIDADES', 'DOMINIO_PROPRIO', 'LISTA_DE_ESPERA', 'COMISSOES', 'PAGAMENTOS', 'ASSINATURAS');

-- CreateEnum
CREATE TYPE "EstablishmentRole" AS ENUM ('DONO', 'GERENTE', 'RECEPCIONISTA', 'PROFISSIONAL');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('DASHBOARD_VISUALIZAR', 'AGENDA_VISUALIZAR', 'AGENDA_GERENCIAR', 'AGENDAMENTO_CRIAR', 'AGENDAMENTO_EDITAR', 'AGENDAMENTO_CANCELAR', 'PROFISSIONAIS_VISUALIZAR', 'PROFISSIONAIS_GERENCIAR', 'SERVICOS_VISUALIZAR', 'SERVICOS_GERENCIAR', 'CONSUMIDORES_VISUALIZAR', 'CONSUMIDORES_GERENCIAR', 'RELATORIOS_VISUALIZAR', 'EQUIPE_VISUALIZAR', 'EQUIPE_GERENCIAR', 'PERSONALIZACAO_GERENCIAR', 'CONFIGURACOES_GERENCIAR');

-- CreateEnum
CREATE TYPE "PermissionMode" AS ENUM ('GRANTED', 'DENIED');

-- CreateEnum
CREATE TYPE "InviteType" AS ENUM ('ESTABLISHMENT', 'PLATFORM');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('TENANT_CREATED', 'TENANT_PLAN_CHANGED', 'TENANT_FEATURE_CHANGED', 'TENANT_SUSPENDED', 'TENANT_REACTIVATED', 'MASTER_CREATED', 'MASTER_REMOVED', 'USER_INVITED', 'USER_PERMISSION_CHANGED', 'SUPPORT_ACCESSED', 'IDENTITY_CHANGED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('CHAIR', 'ROOM', 'OFFICE', 'EQUIPMENT', 'TABLE', 'VEHICLE', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceModality" AS ENUM ('IN_PERSON', 'REMOTE', 'HOME');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "platformRole" "PlatformRole",
    "platformPermissions" "PlatformPermission"[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "maxProfessionals" INTEGER NOT NULL,
    "maxUnits" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "features" (
    "id" TEXT NOT NULL,
    "key" "FeatureKey" NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "category" "BusinessCategory" NOT NULL,
    "taxDocument" TEXT,
    "timezone" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "suspensionReason" TEXT,
    "professionalCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_feature_overrides" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "tenant_feature_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_identities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "logoInitials" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL,
    "secondaryColor" TEXT NOT NULL,
    "accentColor" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "template" "PageTemplate" NOT NULL DEFAULT 'CLASSIC',
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "presentationText" TEXT NOT NULL,
    "photos" TEXT[],
    "bannerUrl" TEXT,
    "sectionOrder" TEXT[],
    "customFooter" TEXT,
    "hidePlatformBranding" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "brand_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "minLeadMinutes" INTEGER NOT NULL,
    "maxFutureDays" INTEGER NOT NULL,
    "cancellationHours" INTEGER NOT NULL,
    "autoConfirm" BOOLEAN NOT NULL,
    "allowAnyProfessional" BOOLEAN NOT NULL,
    "allowClientReschedule" BOOLEAN NOT NULL,
    "requireClientPhone" BOOLEAN NOT NULL,
    "requireClientEmail" BOOLEAN NOT NULL,
    "showPublicPrice" BOOLEAN NOT NULL,
    "defaultBufferMinutes" INTEGER NOT NULL,

    CONSTRAINT "booking_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "operatingDays" INTEGER[],
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,

    CONSTRAINT "public_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "EstablishmentRole" NOT NULL,
    "professionalId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_permission_overrides" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "mode" "PermissionMode" NOT NULL,

    CONSTRAINT "membership_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "type" "InviteType" NOT NULL,
    "targetName" TEXT NOT NULL,
    "targetEmail" CITEXT NOT NULL,
    "tenantId" TEXT,
    "establishmentRole" "EstablishmentRole",
    "platformRole" "PlatformRole",
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "generatedUserId" TEXT,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" "AuditAction" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "tenantId" TEXT,
    "summary" TEXT NOT NULL,
    "previousData" JSONB,
    "newData" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professionals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unitId" TEXT,
    "name" TEXT NOT NULL,
    "avatarInitials" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL,
    "onlineBookingActive" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_schedules" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "lunchStart" TEXT,
    "lunchEnd" TEXT,

    CONSTRAINT "professional_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "priceCents" INTEGER,
    "priceVisible" BOOLEAN NOT NULL DEFAULT true,
    "durationMinutes" INTEGER NOT NULL,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "modality" "ServiceModality" NOT NULL DEFAULT 'IN_PERSON',
    "activeInPublicBooking" BOOLEAN NOT NULL DEFAULT true,
    "requiresManualConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_services" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "professional_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "whatsappNormalized" TEXT NOT NULL,
    "email" TEXT,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "totalNoShows" INTEGER NOT NULL DEFAULT 0,
    "lastServedAt" TIMESTAMPTZ(3),
    "nextAppointmentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_blocks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "time_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "consumerId" TEXT NOT NULL,
    "consumerNameSnapshot" TEXT NOT NULL,
    "consumerWhatsappSnapshot" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_items" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "priceCentsSnapshot" INTEGER,
    "durationMinutesSnapshot" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "appointment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_resources" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,

    CONSTRAINT "appointment_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_status_changes" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromStatus" "AppointmentStatus",
    "toStatus" "AppointmentStatus" NOT NULL,
    "changedBy" TEXT NOT NULL,

    CONSTRAINT "appointment_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "features_key_key" ON "features"("key");

-- CreateIndex
CREATE UNIQUE INDEX "plan_features_planId_featureId_key" ON "plan_features"("planId", "featureId");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenant_feature_overrides_tenantId_idx" ON "tenant_feature_overrides"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_feature_overrides_tenantId_featureId_key" ON "tenant_feature_overrides"("tenantId", "featureId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_identities_tenantId_key" ON "brand_identities"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_policies_tenantId_key" ON "booking_policies"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "public_settings_tenantId_key" ON "public_settings"("tenantId");

-- CreateIndex
CREATE INDEX "units_tenantId_idx" ON "units"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_professionalId_key" ON "memberships"("professionalId");

-- CreateIndex
CREATE INDEX "memberships_tenantId_idx" ON "memberships"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_tenantId_key" ON "memberships"("userId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_permission_overrides_membershipId_permission_key" ON "membership_permission_overrides"("membershipId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "invites_tokenHash_key" ON "invites"("tokenHash");

-- CreateIndex
CREATE INDEX "invites_tenantId_status_idx" ON "invites"("tenantId", "status");

-- CreateIndex
CREATE INDEX "invites_targetEmail_idx" ON "invites"("targetEmail");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_occurredAt_idx" ON "audit_logs"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "professionals_tenantId_idx" ON "professionals"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "professional_schedules_professionalId_weekday_key" ON "professional_schedules"("professionalId", "weekday");

-- CreateIndex
CREATE INDEX "services_tenantId_idx" ON "services"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "professional_services_professionalId_serviceId_key" ON "professional_services"("professionalId", "serviceId");

-- CreateIndex
CREATE INDEX "consumers_tenantId_idx" ON "consumers"("tenantId");

-- CreateIndex
CREATE INDEX "consumers_whatsappNormalized_idx" ON "consumers"("whatsappNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "consumers_tenantId_whatsappNormalized_key" ON "consumers"("tenantId", "whatsappNormalized");

-- CreateIndex
CREATE INDEX "time_blocks_tenantId_idx" ON "time_blocks"("tenantId");

-- CreateIndex
CREATE INDEX "time_blocks_professionalId_startAt_endAt_idx" ON "time_blocks"("professionalId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "resources_tenantId_idx" ON "resources"("tenantId");

-- CreateIndex
CREATE INDEX "appointments_tenantId_idx" ON "appointments"("tenantId");

-- CreateIndex
CREATE INDEX "appointments_professionalId_startAt_endAt_idx" ON "appointments"("professionalId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

-- CreateIndex
CREATE INDEX "appointments_startAt_idx" ON "appointments"("startAt");

-- CreateIndex
CREATE INDEX "appointment_items_appointmentId_idx" ON "appointment_items"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_resources_appointmentId_resourceId_key" ON "appointment_resources"("appointmentId", "resourceId");

-- CreateIndex
CREATE INDEX "appointment_status_changes_appointmentId_idx" ON "appointment_status_changes"("appointmentId");

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_feature_overrides" ADD CONSTRAINT "tenant_feature_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_feature_overrides" ADD CONSTRAINT "tenant_feature_overrides_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_identities" ADD CONSTRAINT "brand_identities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_settings" ADD CONSTRAINT "public_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permission_overrides_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_schedules" ADD CONSTRAINT "professional_schedules_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumers" ADD CONSTRAINT "consumers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_consumerId_fkey" FOREIGN KEY ("consumerId") REFERENCES "consumers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_resources" ADD CONSTRAINT "appointment_resources_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_resources" ADD CONSTRAINT "appointment_resources_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_status_changes" ADD CONSTRAINT "appointment_status_changes_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Manual: peças sem DSL no Prisma 7 (ver cabeçalho de prisma/schema.prisma).

-- CheckConstraint
-- Garante que todo agendamento tenha duração positiva.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_end_after_start_check" CHECK ("endAt" > "startAt");

-- ExclusionConstraint
-- Impede que o mesmo profissional tenha dois agendamentos ativos com
-- horários sobrepostos. Agendamento cancelado libera a agenda e não conta
-- para a constraint (docs/plans/fundacao-postgresql.md, "Estratégia de
-- concorrência de agendamentos"). Requer a extensão btree_gist (já criada
-- acima) para usar operador de igualdade em "professionalId" (texto) dentro
-- de um índice GiST.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap_excl"
    EXCLUDE USING gist (
        "professionalId" WITH =,
        tstzrange("startAt", "endAt") WITH &&
    )
    WHERE ("status" <> 'CANCELED');

