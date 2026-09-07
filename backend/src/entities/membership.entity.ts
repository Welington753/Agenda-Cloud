// Tenant-owned. Vínculo de um `User` de tenant com um tenant — é aqui, não na
// pessoa, que vivem o papel e os ajustes individuais de permissão (espelha
// `Membership` em src/lib/types.ts). Usuário de tenant nunca ganha papel
// Master por este relacionamento — `User.platformRole` é inteiramente
// independente (ver docs/plans/migracao-nestjs-typeorm-neon.md, seção 4.3).
//
// Proteção contra mistura de tenant (seção 5): quando `professionalId` está
// presente, `Professional.tenantId` precisa ser igual a `Membership.tenantId`.
// EXCEÇÃO deliberada do Lote 5B.2 (a única): ao contrário das outras 14 FKs
// compostas de tenant, esta continua SQL manual na migration
// (`fk_memberships_tenant_professional ... ON DELETE SET NULL
// (professional_id)`, sintaxe de coluna-alvo do Postgres 15+) porque
// `OnDeleteType` do TypeORM não modela `SET NULL (coluna)` — só a lista fixa
// `RESTRICT|CASCADE|SET NULL|DEFAULT|NO ACTION`. `createForeignKeyConstraints:
// false` abaixo desativa a FK simples automática desta relação (não haveria
// FK nenhuma sem isso: nem a simples do TypeORM, nem a composta, que só
// existe como SQL manual) — ver
// `initial-schema-tenant-integrity.spec.ts` para o teste que prova essa
// exceção.
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
  Unique,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { EstablishmentRole } from './enums/establishment-role.enum.js';
import type { MembershipPermissionOverride } from './membership-permission-override.entity.js';
import type { Professional } from './professional.entity.js';
import type { Tenant } from './tenant.entity.js';
import type { User } from './user.entity.js';

@Entity('memberships')
@Unique('uq_memberships_user_tenant', ['userId', 'tenantId'])
@Unique('uq_memberships_tenant_id', ['tenantId', 'id'])
export class Membership {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'varchar', length: 30 })
  userId!: string;

  @Index('idx_memberships_tenant_id')
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'enum', enum: EstablishmentRole, enumName: 'establishment_role' })
  role!: EstablishmentRole;

  // Presente quando `role = PROFISSIONAL`, aponta para o registro
  // `Professional` que representa essa pessoa na agenda.
  @Index('uq_memberships_professional_id', { unique: true, where: '"professional_id" IS NOT NULL' })
  @Column({ type: 'varchar', length: 30, nullable: true })
  professionalId?: string;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne('User', (user: User) => user.memberships, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_memberships_user' })
  user!: User;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.memberships, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'fk_memberships_tenant' })
  tenant!: Tenant;

  // Sem FK automática nem `@ForeignKey` de classe — exceção documentada no
  // cabeçalho do arquivo. `fk_memberships_tenant_professional` continua só
  // na migration (SQL manual).
  @ManyToOne('Professional', (professional: Professional) => professional.membership, {
    onDelete: 'SET NULL',
    nullable: true,
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'professional_id' })
  professional?: Professional;

  @OneToMany(
    'MembershipPermissionOverride',
    (override: MembershipPermissionOverride) => override.membership,
  )
  permissionOverrides!: MembershipPermissionOverride[];
}
