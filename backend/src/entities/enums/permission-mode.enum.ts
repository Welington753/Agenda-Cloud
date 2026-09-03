// Idêntico ao enum `PermissionMode` do schema.prisma original. `DENIED`
// sempre vence sobre `GRANTED` e sobre o padrão do papel (ver
// `MembershipPermissionOverride`, mesma ordem de `calcularAcessoEfetivo` em
// src/lib/access/access-control.ts).
export enum PermissionMode {
  GRANTED = 'GRANTED',
  DENIED = 'DENIED',
}
