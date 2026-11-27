// Permissões de funcionário: as do alcance PRÓPRIO (os atendimentos e as
// comissões do profissional ligado ao vínculo). Ficam em `common/` porque a
// base comum (access-evaluation.ts) calcula as concessões efetivas delas sem
// importar as políticas de área; team/staff-access.ts as reexporta. Sem Nest,
// sem banco e sem imports.

/** Valores novos do enum `permission` (migrations TeamAccess1792886400000 e
 * ProfessionalCommissions1793491200000), fora do enum TypeScript, que espelha
 * a migration inicial. `COMISSOES_PROPRIAS_VISUALIZAR` libera só as PRÓPRIAS
 * comissões (commissions/commission-access.ts); é separada de
 * `COMISSOES_VISUALIZAR`, que só restringe o dono. */
export const STAFF_PERMISSIONS = [
  'ATENDIMENTO_PROPRIO_INICIAR',
  'ATENDIMENTO_PROPRIO_CONCLUIR',
  'ATENDIMENTO_PROPRIO_FALTA',
  'COMISSOES_PROPRIAS_VISUALIZAR',
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

/** Concessão que libera as próprias comissões. */
export const OWN_COMMISSIONS_PERMISSION = 'COMISSOES_PROPRIAS_VISUALIZAR' satisfies StaffPermission;
