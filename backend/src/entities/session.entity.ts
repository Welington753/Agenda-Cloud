// Global — nunca recebe tenantId. `tokenHash` nunca guarda o token em texto
// puro, mesmo padrão de `Invite.tokenHash` (ver
// docs/plans/migracao-nestjs-typeorm-neon.md, seção 4.2). `revokedAt`
// preenchido invalida a sessão antes do `expiresAt` natural — cobre logout
// explícito e revogação administrativa.
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
import type { User } from './user.entity.js';

@Entity('sessions')
@Index(['userId'])
export class Session {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'varchar', length: 30 })
  userId!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  tokenHash!: string;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ type: 'timestamptz', precision: 3 })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  revokedAt?: Date;

  @Column({ type: 'varchar', nullable: true })
  userAgent?: string;

  @Column({ type: 'varchar', nullable: true })
  ipAddress?: string;

  @ManyToOne('User', (user: User) => user.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
