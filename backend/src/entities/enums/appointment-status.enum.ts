// Idêntico ao enum `AppointmentStatus` do schema.prisma original — espelha
// `StatusAgendamento` em src/lib/types.ts. `PENDING | CONFIRMED | IN_PROGRESS
// | COMPLETED | NO_SHOW` ocupam agenda; só `CANCELED` libera (ver
// STATUS_QUE_OCUPAM em availability.service.ts e seção 7.1 do plano —
// alinhado à constraint `appointments_no_overlap_excl`, que já só ignorava
// `CANCELED`).
export enum AppointmentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
  NO_SHOW = 'NO_SHOW',
}
