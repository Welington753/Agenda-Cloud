// Base comum de avaliação de permissões (docs/plans/permissoes-individuais.md,
// etapa 1). Função pura, sem Nest e sem banco.
//
// ETAPA 1 = REFATORAÇÃO SEM MUDANÇA DE COMPORTAMENTO. Só existe o modelo
// LEGADO: as concessões efetivas são calculadas exatamente pelas regras de
// hoje, por papel:
// - DONO: tudo, salvo `DENIED` na ação ou numa dependência (`algumaNegada`);
// - GERENTE: só `GRANTED` sem `DENIED` da lista de gerente (`managerGranted`).
//   A confirmação do dono continua aplicada ANTES, por quem lê os ajustes
//   (`effectiveOverrides` descarta os `GRANTED` do gerente não confirmado);
// - RECEPCIONISTA: só `GRANTED` sem `DENIED` da lista dela
//   (`receptionistGranted`); o resto gravado é ignorado;
// - PROFISSIONAL e qualquer outro papel: nenhuma concessão de gerente.
//
// Uma ação exige a permissão dela e as dependências de
// `MANAGER_PERMISSION_REQUIRES`, como em `managerCan`/`receptionistCan`.
//
// ALCANCE PRÓPRIO (permissões de funcionário, `STAFF_PERMISSIONS`): só
// PROFISSIONAL e GERENTE, cada uma com `GRANTED` sem `DENIED`, como em
// `staffPermissionGranted` (team/staff-access.ts); o dono e a recepcionista
// nunca. O profissional ligado e ativo e a agenda própria são conferidos por
// quem chama, no banco.
//
// O modelo INDIVIDUAL e a retirada do teto por papel entram em etapas
// próprias; nada aqui os antecipa.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import {
  MANAGER_PERMISSION_REQUIRES,
  managerGrantedPermissions,
  receptionistGrantedPermissions,
  type ManagerPermission,
} from './manager-permissions.js';
import { STAFF_PERMISSIONS, type StaffPermission } from './staff-permissions.js';
import { algumaNegada, type PermissionOverrideLike } from './tenant-authorization.js';

/** Acesso efetivo de um vínculo, já calculado. As políticas perguntam a
 * `accessCan`, `accessAllows` ou `accessCanOwn`, nunca ao papel diretamente. */
export type EffectiveAccess =
  | { readonly kind: 'OWNER'; readonly overrides: readonly PermissionOverrideLike[] }
  | {
      readonly kind: 'GRANTS';
      readonly granted: ReadonlySet<ManagerPermission>;
      /** Permissões de funcionário efetivas (alcance próprio). */
      readonly own: ReadonlySet<StaffPermission>;
    };

/** Concessões de gerente que valem no modelo LEGADO, pela regra do papel. */
export function legacyGrantedPermissions(
  role: EstablishmentRole | string,
  overrides: readonly PermissionOverrideLike[],
): ReadonlySet<ManagerPermission> {
  if (role === EstablishmentRole.GERENTE) return new Set(managerGrantedPermissions(role, overrides));
  if (role === EstablishmentRole.RECEPCIONISTA) return new Set(receptionistGrantedPermissions(role, overrides));
  return new Set();
}

/** Permissões de funcionário que valem no modelo LEGADO: só PROFISSIONAL e
 * GERENTE, `GRANTED` sem `DENIED`. */
export function legacyOwnPermissions(
  role: EstablishmentRole | string,
  overrides: readonly PermissionOverrideLike[],
): ReadonlySet<StaffPermission> {
  if (role !== EstablishmentRole.PROFISSIONAL && role !== EstablishmentRole.GERENTE) return new Set();
  const tem = (p: string, mode: PermissionMode) => overrides.some((o) => o.permission === p && o.mode === mode);
  return new Set(STAFF_PERMISSIONS.filter((p) => tem(p, PermissionMode.GRANTED) && !tem(p, PermissionMode.DENIED)));
}

/** Acesso efetivo pelo modelo LEGADO. `overrides` são os ajustes que valem
 * (`effectiveOverrides` já aplicado por quem leu o vínculo). */
export function effectiveAccess(
  role: EstablishmentRole | string,
  overrides: readonly PermissionOverrideLike[] = [],
): EffectiveAccess {
  if (role === EstablishmentRole.DONO) return { kind: 'OWNER', overrides };
  return {
    kind: 'GRANTS',
    granted: legacyGrantedPermissions(role, overrides),
    own: legacyOwnPermissions(role, overrides),
  };
}

/** A permissão e as dependências dela, na ordem em que são conferidas. */
export function requiredFor(permissao: ManagerPermission): readonly ManagerPermission[] {
  return [permissao, ...MANAGER_PERMISSION_REQUIRES[permissao]];
}

/** Pode a ação desta permissão: o dono sem nenhuma negada entre a permissão
 * e as dependências; os demais com todas concedidas. */
export function accessCan(access: EffectiveAccess, permissao: ManagerPermission): boolean {
  const exigidas = requiredFor(permissao);
  if (access.kind === 'OWNER') return !algumaNegada(access.overrides, exigidas as readonly string[] as Permission[]);
  return exigidas.every((p) => access.granted.has(p));
}

/** Ação com regra própria do dono no modelo LEGADO. Algumas políticas antigas
 * conferem no dono uma lista de DENIED diferente das dependências exigidas de
 * quem recebe concessões (ver a agenda não olha `PROFISSIONAIS_VISUALIZAR` no
 * dono, mas o gerente precisa dela concedida), e algumas ações são só de um
 * dos lados. A lista do dono fica literal, como estava, para não mudar regra.
 * Quando as duas coincidem, basta `accessCan`. */
export interface LegacyAction {
  /** Concessões exigidas de quem não é dono, cada uma com as dependências
   * (`requiredFor`). `null` ou vazia: ninguém além do dono. */
  readonly grants: readonly ManagerPermission[] | null;
  /** DENIED que barram o dono. `null`: o dono não faz esta ação por aqui. */
  readonly ownerDenials: readonly Permission[] | null;
}

/** Pode esta ação: o dono sem nenhuma negada da lista dele; os demais com
 * todas as concessões exigidas (e as dependências delas) efetivas. */
export function accessAllows(access: EffectiveAccess, acao: LegacyAction): boolean {
  if (access.kind === 'OWNER') return acao.ownerDenials !== null && !algumaNegada(access.overrides, acao.ownerDenials);
  const grants = acao.grants ?? [];
  return grants.length > 0 && grants.every((p) => accessCan(access, p));
}

/** Pode no alcance PRÓPRIO: a permissão de funcionário efetiva. O dono nunca
 * (ele não tem alcance próprio; vê o de todos pelas outras políticas). Quem
 * chama confere o profissional ligado e ativo e a agenda própria. */
export function accessCanOwn(access: EffectiveAccess, permissao: StaffPermission): boolean {
  return access.kind === 'GRANTS' && access.own.has(permissao);
}
