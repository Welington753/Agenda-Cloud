// Nova (seção 4.4). Registra Master, tenant, início e término de uma sessão
// de suporte — nunca personificação silenciosa: a sessão HTTP do Master
// continua sendo a sessão do Master (mesmo `userId`), isto é só um contexto
// adicional. `AuditLog.supportSessionId` vincula toda ação de mutação feita
// enquanto `endedAt IS NULL` a esta sessão, sempre com `actorUserId` do
// Master, nunca do dono do tenant. Implementação de UI (entrar/sair) fica
// fora desta migração — aqui só a entidade.
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { AuditLog } from './audit-log.entity.js';
import type { Tenant } from './tenant.entity.js';
import type { User } from './user.entity.js';

@Entity('support_sessions')
@Index(['tenantId', 'startedAt'])
export class SupportSession {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index()
  @Column({ type: 'varchar', length: 30 })
  masterUserId!: string;

  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  startedAt!: Date;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  endedAt?: Date;

  @Column({ type: 'varchar', nullable: true })
  reason?: string;

  @ManyToOne('User', (user: User) => user.supportSessionsAsMaster, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'master_user_id' })
  masterUser!: User;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.supportSessions, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @OneToMany('AuditLog', (auditLog: AuditLog) => auditLog.supportSession)
  auditLogs!: AuditLog[];
}
