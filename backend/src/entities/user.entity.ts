// Global — nunca recebe tenantId. Unifica UsuarioPlataforma/UsuarioEstabelecimento
// (src/lib/types.ts) num único registro: `platformRole` preenchido = conta de
// plataforma (Master); memberships = vínculos com tenants. As duas coisas podem
// coexistir na mesma pessoa (arquitetura permite), mas a sessão sempre escolhe
// um escopo por vez (ver docs/plans/migracao-nestjs-typeorm-neon.md, seção 4.3)
// — decisão de serviço, fora do escopo deste lote (só entidades).
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { PlatformPermission } from './enums/platform-permission.enum.js';
import { PlatformRole } from './enums/platform-role.enum.js';
import { UserStatus } from './enums/user-status.enum.js';
import type { AuditLog } from './audit-log.entity.js';
import type { Credential } from './credential.entity.js';
import type { Invite } from './invite.entity.js';
import type { Membership } from './membership.entity.js';
import type { Session } from './session.entity.js';
import type { SupportSession } from './support-session.entity.js';

@Entity('users')
export class User {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'varchar' })
  name!: string;

  // citext no Postgres real (extensão criada no Lote 5) — unicidade
  // case-insensitive garantida pelo próprio banco, não só pela aplicação.
  @Index({ unique: true })
  @Column({ type: 'citext' })
  email!: string;

  @Column({ type: 'varchar', nullable: true })
  phone?: string;

  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column({ type: 'varchar', nullable: true })
  image?: string;

  @Column({ type: 'enum', enum: UserStatus, enumName: 'user_status', default: UserStatus.ACTIVE })
  status!: UserStatus;

  // Preenchido = conta de administração da plataforma (Master). Ausente =
  // pessoa só vinculada a tenant(s) via Membership. Nunca exige tenantId.
  @Column({ type: 'enum', enum: PlatformRole, enumName: 'platform_role', nullable: true })
  platformRole?: PlatformRole;

  @Column({
    type: 'enum',
    enum: PlatformPermission,
    enumName: 'platform_permission',
    array: true,
    nullable: true,
  })
  platformPermissions?: PlatformPermission[];

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  lastSeenAt?: Date;

  @OneToMany('Membership', (membership: Membership) => membership.user)
  memberships!: Membership[];

  @OneToMany('Invite', (invite: Invite) => invite.createdByUser)
  createdInvites!: Invite[];

  @OneToMany('AuditLog', (auditLog: AuditLog) => auditLog.actor)
  auditLogs!: AuditLog[];

  @OneToOne('Credential', (credential: Credential) => credential.user)
  credential?: Credential;

  @OneToMany('Session', (session: Session) => session.user)
  sessions!: Session[];

  @OneToMany(
    'SupportSession',
    (supportSession: SupportSession) => supportSession.masterUser,
  )
  supportSessionsAsMaster!: SupportSession[];
}
