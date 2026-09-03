// Os 11 valores originais do schema.prisma continuam inalterados;
// `TENANT_SUPPORT_ENTERED`/`TENANT_SUPPORT_EXITED` são novos nesta revisão
// (seção 3.1 e 4.4) — específicos de entrar/sair do modo de suporte num
// tenant. `SUPPORT_ACCESSED` (já existente) continua com o significado amplo
// de "suporte olhou algo" — os dois nunca se confundem.
export enum AuditAction {
  TENANT_CREATED = 'TENANT_CREATED',
  TENANT_PLAN_CHANGED = 'TENANT_PLAN_CHANGED',
  TENANT_FEATURE_CHANGED = 'TENANT_FEATURE_CHANGED',
  TENANT_SUSPENDED = 'TENANT_SUSPENDED',
  TENANT_REACTIVATED = 'TENANT_REACTIVATED',
  MASTER_CREATED = 'MASTER_CREATED',
  MASTER_REMOVED = 'MASTER_REMOVED',
  USER_INVITED = 'USER_INVITED',
  USER_PERMISSION_CHANGED = 'USER_PERMISSION_CHANGED',
  SUPPORT_ACCESSED = 'SUPPORT_ACCESSED',
  IDENTITY_CHANGED = 'IDENTITY_CHANGED',
  // Novos nesta revisão (ver docs/plans/migracao-nestjs-typeorm-neon.md, seção 4.4).
  TENANT_SUPPORT_ENTERED = 'TENANT_SUPPORT_ENTERED',
  TENANT_SUPPORT_EXITED = 'TENANT_SUPPORT_EXITED',
}
