// Log somente-leitura de ações sensíveis — espelha `RegistroAuditoria` em
// src/lib/types.ts. `tenantId` nullable de propósito (auditoria de plataforma
// não pertence a nenhum tenant). `supportSessionId` (novo, seção 4.4) vincula
// a ação a uma sessão de suporte aberta quando aplicável — nunca preenchido
// com o `actorUserId` do dono do tenant (o ator de uma ação em modo de
// suporte é sempre o Master, nunca personificação silenciosa).
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { AuditAction } from './enums/audit-action.enum.js';
import type { SupportSession } from './support-session.entity.js';
import type { Tenant } from './tenant.entity.js';
import type { User } from './user.entity.js';

@Entity('audit_logs')
@Index(['tenantId', 'occurredAt'])
export class AuditLog {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  occurredAt!: Date;

  @Column({ type: 'enum', enum: AuditAction, enumName: 'audit_action' })
  action!: AuditAction;

  @Index()
  @Column({ type: 'varchar', length: 30 })
  actorUserId!: string;

  @Column({ type: 'varchar' })
  actorName!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  tenantId?: string;

  @Column({ type: 'varchar' })
  summary!: string;

  @Column({ type: 'jsonb', nullable: true })
  previousData?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  newData?: Record<string, unknown>;

  @Column({ type: 'varchar', length: 30, nullable: true })
  supportSessionId?: string;

  @ManyToOne('User', (user: User) => user.auditLogs, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_user_id' })
  actor!: User;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.auditLogs, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @ManyToOne(
    'SupportSession',
    (supportSession: SupportSession) => supportSession.auditLogs,
    { onDelete: 'RESTRICT', nullable: true },
  )
  @JoinColumn({ name: 'support_session_id' })
  supportSession?: SupportSession;
}
