// Idêntico ao enum `AppointmentStatus` do schema.prisma original — espelha
// `StatusAgendamento` em src/lib/types.ts. `PENDING | CONFIRMED | IN_PROGRESS
// | COMPLETED` ocupam agenda; `CANCELED`/`NO_SHOW` liberam (ver
// STATUS_OCUPA_AGENDA em src/lib/availability/engine.ts e seção 7.1 do plano).
export enum AppointmentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
  NO_SHOW = 'NO_SHOW',
}
