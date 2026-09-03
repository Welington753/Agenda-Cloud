// Papel de administração da plataforma — nunca exige tenantId (ver
// docs/plans/migracao-nestjs-typeorm-neon.md, seção 4). Valores idênticos ao
// enum `PlatformRole` do schema.prisma original (sem mudança de conteúdo).
export enum PlatformRole {
  MASTER_OWNER = 'MASTER_OWNER',
  MASTER_ADMIN = 'MASTER_ADMIN',
  MASTER_SUPPORT = 'MASTER_SUPPORT',
}
