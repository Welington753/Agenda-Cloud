// Tenant-owned. Substitui Membership.permissoesLiberadas/permissoesNegadas
// (arrays paralelos) por uma tabela de exceções auditável linha a linha.
// `DENIED` sempre vence sobre `GRANTED` e sobre o padrão do papel (mesma
// ordem de `calcularAcessoEfetivo` em src/lib/access/access-control.ts).
//
// `tenantId` é uma adição desta execução do Lote 3, além do que o
// mapeamento original da seção 3.2 do plano trazia (lá a tabela só tinha
// `membershipId`, herdando o tenant transitivamente via `Membership`) — a
// coluna aqui é denormalizada a partir de `Membership.tenantId` para atender
// à exigência explícita desta tarefa de que toda entidade tenant-owned tenha
// `tenant_id` próprio e indexado. `membershipId` continua sendo a fonte de
// verdade; manter os dois consistentes é responsabilidade do serviço (a
// implementar em lote posterior) — nenhuma constraint de banco garante isso
// ainda (nunca uma relação TypeORM composta incorreta; ver seção 5 do plano).
import {
  BeforeInsert,
  Column,
  Entity,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { Permission } from './enums/permission.enum.js';
import { PermissionMode } from './enums/permission-mode.enum.js';
import type { Membership } from './membership.entity.js';

@Entity('membership_permission_overrides')
@Unique('uq_membership_permission_overrides_tenant_membership_permission', [
  'tenantId',
  'membershipId',
  'permission',
])
@ForeignKey('Membership', ['tenantId', 'membershipId'], ['tenantId', 'id'], {
  name: 'fk_membership_permission_overrides_tenant_membership',
  onDelete: 'CASCADE',
})
export class MembershipPermissionOverride {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  // Denormalizado a partir de `Membership.tenantId` — ver nota acima.
  @Index('idx_membership_permission_overrides_tenant_id')
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  membershipId!: string;

  @Column({ type: 'enum', enum: Permission, enumName: 'permission' })
  permission!: Permission;

  @Column({ type: 'enum', enum: PermissionMode, enumName: 'permission_mode' })
  mode!: PermissionMode;

  // FK real é a composta de classe
  // (fk_membership_permission_overrides_tenant_membership) acima.
  @ManyToOne(
    'Membership',
    (membership: Membership) => membership.permissionOverrides,
    { onDelete: 'CASCADE', createForeignKeyConstraints: false },
  )
  @JoinColumn({ name: 'membership_id' })
  membership!: Membership;
}
