// Global — nunca recebe tenantId. `tokenHash` nunca guarda o token em texto
// puro, mesmo padrão de `Invite.tokenHash` (ver
// docs/plans/migracao-nestjs-typeorm-neon.md, seção 4.2). `revokedAt`
// preenchido invalida a sessão antes do `expiresAt` natural — cobre logout
// explícito e revogação administrativa.
import {
  BeforeInsert,
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { User } from './user.entity.js';

@Entity('sessions')
@Index('idx_sessions_user_id', ['userId'])
@Check('ck_sessions_expires_after_created', 'expires_at > created_at')
export class Session {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'varchar', length: 30 })
  userId!: string;

  @Index('uq_sessions_token_hash', { unique: true })
  @Column({ type: 'varchar' })
  tokenHash!: string;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Index('idx_sessions_expires_at')
  @Column({ type: 'timestamptz', precision: 3 })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  revokedAt?: Date;

  @Column({ type: 'varchar', nullable: true })
  userAgent?: string;

  @Column({ type: 'varchar', nullable: true })
  ipAddress?: string;

  @ManyToOne('User', (user: User) => user.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_sessions_user' })
  user!: User;
}
