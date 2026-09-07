// Entidade raiz do estabelecimento (o "tenant" do multi-tenant) — NUNCA
// recebe tenantId nela mesma (é ela quem define o que é um tenant; ver
// docs/plans/migracao-nestjs-typeorm-neon.md, seção 4). `slug` é único
// globalmente e preparado para resolver subdomínio futuro (ver seção 6.4 —
// ex.: "dom-navalha" -> domnavalha.agendacloud.com.br), nunca implementado
// nesta migração (sem DNS/proxy/hospedagem aqui). Dado operacional referencia
// Tenant com onDelete Restrict — nunca é possível apagar um tenant que já tem
// operação.
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { BusinessCategory } from './enums/business-category.enum.js';
import { TenantStatus } from './enums/tenant-status.enum.js';
import type { Appointment } from './appointment.entity.js';
import type { AuditLog } from './audit-log.entity.js';
import type { BookingPolicy } from './booking-policy.entity.js';
import type { BrandIdentity } from './brand-identity.entity.js';
import type { CommissionEntry } from './commission-entry.entity.js';
import type { CommissionRule } from './commission-rule.entity.js';
import type { Consumer } from './consumer.entity.js';
import type { Invite } from './invite.entity.js';
import type { Membership } from './membership.entity.js';
import type { Plan } from './plan.entity.js';
import type { Professional } from './professional.entity.js';
import type { PublicSettings } from './public-settings.entity.js';
import type { Resource } from './resource.entity.js';
import type { Service } from './service.entity.js';
import type { SupportSession } from './support-session.entity.js';
import type { TenantFeatureOverride } from './tenant-feature-override.entity.js';
import type { TimeBlock } from './time-block.entity.js';
import type { Unit } from './unit.entity.js';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  // citext no Postgres real (extensão criada no Lote 5) — unicidade
  // case-insensitive garantida pelo banco. Formato/reservados são validação
  // de aplicação (DTO), não de banco (ver seção 6.4). Preparado para resolver
  // "<slug>.agendacloud.com.br" no futuro — sem DNS/proxy nesta migração.
  @Index({ unique: true })
  @Column({ type: 'citext' })
  slug!: string;

  @Column({ type: 'enum', enum: BusinessCategory, enumName: 'business_category' })
  category!: BusinessCategory;

  @Column({ type: 'varchar', nullable: true })
  taxDocument?: string;

  @Column({ type: 'varchar' })
  timezone!: string;

  @Column({ type: 'varchar', length: 30 })
  planId!: string;

  @Index()
  @Column({ type: 'enum', enum: TenantStatus, enumName: 'tenant_status', default: TenantStatus.TRIAL })
  status!: TenantStatus;

  @Column({ type: 'varchar', nullable: true })
  suspensionReason?: string;

  @Column({ type: 'int', default: 0 })
  professionalCount!: number;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @ManyToOne('Plan', (plan: Plan) => plan.tenants, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_id' })
  plan!: Plan;

  @OneToOne('BrandIdentity', (brandIdentity: BrandIdentity) => brandIdentity.tenant)
  brandIdentity?: BrandIdentity;

  @OneToOne('BookingPolicy', (bookingPolicy: BookingPolicy) => bookingPolicy.tenant)
  bookingPolicy?: BookingPolicy;

  @OneToOne('PublicSettings', (publicSettings: PublicSettings) => publicSettings.tenant)
  publicSettings?: PublicSettings;

  @OneToMany(
    'TenantFeatureOverride',
    (override: TenantFeatureOverride) => override.tenant,
  )
  featureOverrides!: TenantFeatureOverride[];

  @OneToMany('Unit', (unit: Unit) => unit.tenant)
  units!: Unit[];

  @OneToMany('Membership', (membership: Membership) => membership.tenant)
  memberships!: Membership[];

  @OneToMany('Invite', (invite: Invite) => invite.tenant)
  invites!: Invite[];

  @OneToMany('AuditLog', (auditLog: AuditLog) => auditLog.tenant)
  auditLogs!: AuditLog[];

  @OneToMany('Professional', (professional: Professional) => professional.tenant)
  professionals!: Professional[];

  @OneToMany('Service', (service: Service) => service.tenant)
  services!: Service[];

  @OneToMany('Consumer', (consumer: Consumer) => consumer.tenant)
  consumers!: Consumer[];

  @OneToMany('TimeBlock', (timeBlock: TimeBlock) => timeBlock.tenant)
  timeBlocks!: TimeBlock[];

  @OneToMany('Resource', (resource: Resource) => resource.tenant)
  resources!: Resource[];

  @OneToMany('Appointment', (appointment: Appointment) => appointment.tenant)
  appointments!: Appointment[];

  @OneToMany(
    'SupportSession',
    (supportSession: SupportSession) => supportSession.tenant,
  )
  supportSessions!: SupportSession[];

  @OneToMany('CommissionRule', (rule: CommissionRule) => rule.tenant)
  commissionRules!: CommissionRule[];

  @OneToMany('CommissionEntry', (entry: CommissionEntry) => entry.tenant)
  commissionEntries!: CommissionEntry[];
}
