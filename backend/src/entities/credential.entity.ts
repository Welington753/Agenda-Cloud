// Global — nunca recebe tenantId. 1:1 com User, separada da tabela `users`
// para reduzir superfície de vazamento acidental em queries/logs que
// selecionam `User.*` (ver docs/plans/migracao-nestjs-typeorm-neon.md, seção
// 4.1). `passwordHash` nunca texto plano, nunca reversível — geração e
// verificação ficam para o serviço de autenticação (Lote 6), não aqui.
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { User } from './user.entity.js';

// `userId` não leva `@Index({unique:true})` próprio — a relação `@OneToOne`
// dona abaixo já gera automaticamente a UNIQUE CONSTRAINT
// `uq_credentials_user_id` via `SnakeNamingStrategy.relationConstraintName`
// (ver database/snake-naming-strategy.ts); um índice único explícito aqui
// duplicaria a constraint (Lote 5B.3).
@Entity('credentials')
export class Credential {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'varchar', length: 30 })
  userId!: string;

  @Column({ type: 'varchar' })
  passwordHash!: string;

  // Ex.: "argon2id" — nunca hardcode o algoritmo no serviço, guardar aqui
  // permite rotação futura sem migração de dado.
  @Column({ type: 'varchar' })
  algorithm!: string;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @OneToOne('User', (user: User) => user.credential, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_credentials_user' })
  user!: User;
}
