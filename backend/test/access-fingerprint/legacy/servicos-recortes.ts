// Trechos de serviços em 8f71335 (o piloto) que decidiam acesso ou campos
// visíveis fora dos arquivos `*-access.ts`. Copiados literalmente, com as
// chamadas apontando para as políticas congeladas desta pasta. Na refatoração
// eles passaram a chamar políticas novas (`canSeeAppointmentContact`,
// `canSeeAppointmentPrices`, `canSeeAvailabilityPrices`,
// `canViewOwnCommissions`) ou funções extraídas (`precosParaQuemPediu`,
// `itemDoHistoricoParaQuemPediu`).
import type { AppointmentView } from '../../../src/appointments/appointments.service.js';
import type { AtendimentoResumido, ItemDoHistorico } from '../../../src/consumers/consumer-profile.service.js';
import { EstablishmentRole } from './entities/enums/establishment-role.enum.js';
import {
  managerCan,
  managerGrantedPermissions,
  receptionistGrantedPermissions,
  MANAGER_PERMISSION_FEATURE,
  type ManagerPermission,
} from './common/manager-permissions.js';
import { effectiveOverrides, type PermissionOverrideLike } from './common/tenant-authorization.js';
import { canViewPayments } from './payments/payment-access.js';
import {
  OWN_COMMISSIONS_PERMISSION,
  STAFF_ACTIONS,
  STAFF_PERMISSION_OF_ACTION,
  canViewOwnAgenda,
  grantableManagerPermissions,
  grantableStaffPermissions,
  staffGrantedPermissions,
  staffPermissionGranted,
  type OverrideRow,
  type StaffAction,
  type StaffPermission,
} from './team/staff-access.js';

type Quem = { role: EstablishmentRole; overrides?: readonly PermissionOverrideLike[] };

/** appointments/appointments.service.ts:1366 (`recortarParaQuemPediu`). */
export function recortarParaQuemPediu(view: AppointmentView, quem: Quem): AppointmentView {
  if (quem.role !== 'GERENTE') return view;
  const overrides = quem.overrides ?? [];
  const contato = managerCan(quem.role, overrides, 'CONSUMIDORES_VISUALIZAR');
  const dinheiro = managerCan(quem.role, overrides, 'RECEBIMENTOS_VISUALIZAR');
  if (contato && dinheiro) return view;
  const hidden: ('price' | 'contact')[] = [];
  if (!dinheiro) hidden.push('price');
  if (!contato) hidden.push('contact');
  return {
    ...view,
    hidden,
    priceCents: dinheiro ? view.priceCents : null,
    services: dinheiro ? view.services : view.services.map((s) => ({ ...s, priceCents: null })),
    notes: contato ? view.notes : null,
    consumer: { ...view.consumer, whatsapp: contato ? view.consumer.whatsapp : null },
  };
}

export type ServicoDaConsulta = { id: string; name: string; durationMinutes: number; priceCents: number | null };

/** availability/availability.service.ts:226-246 (preços da consulta, dentro do serviço). */
export function precosParaQuemPediu(servicos: readonly ServicoDaConsulta[], authorized: Quem) {
  const veDinheiro =
    authorized.role !== EstablishmentRole.GERENTE ||
    managerCan(authorized.role, authorized.overrides ?? [], 'RECEBIMENTOS_VISUALIZAR');
  const itens = servicos.map((s) => ({
    id: s.id,
    name: s.name,
    durationMinutes: s.durationMinutes,
    priceCents: veDinheiro ? (s.priceCents ?? null) : null,
  }));
  return {
    services: itens,
    totalPriceCents:
      veDinheiro && itens.every((i) => i.priceCents !== null)
        ? itens.reduce((total, i) => total + (i.priceCents ?? 0), 0)
        : null,
    priceHidden: !veDinheiro,
  };
}

/** consumers/consumer-profile.service.ts:108 (`oQueOHistoricoMostra`). */
export function oQueOHistoricoMostra(quem: Quem, recursoDePagamentos: boolean): { veDinheiro: boolean; veRecebimentos: boolean } {
  const overrides = quem.overrides ?? [];
  return {
    veDinheiro: quem.role !== 'GERENTE' || managerCan(quem.role, overrides, 'RECEBIMENTOS_VISUALIZAR'),
    veRecebimentos: recursoDePagamentos && canViewPayments(quem.role, overrides),
  };
}

/** consumers/consumer-profile.service.ts:470-481 (item do histórico, dentro do serviço). */
export function itemDoHistoricoParaQuemPediu(
  item: AtendimentoResumido & { precos?: (number | null)[] },
  recebimento: NonNullable<ItemDoHistorico['payment']> | undefined,
  { veDinheiro, veRecebimentos }: { veDinheiro: boolean; veRecebimentos: boolean },
): ItemDoHistorico {
  const hidden: ItemDoHistorico['hidden'] = [];
  if (!veDinheiro) hidden.push('price');
  if (!veRecebimentos) hidden.push('payment');
  const { precos, ...resto } = item as AtendimentoResumido & { precos?: (number | null)[] };
  const lista = precos ?? [];
  const total = lista.length === 0 || lista.some((p) => p === null) ? null : lista.reduce<number>((s, p) => s + (p ?? 0), 0);
  return {
    ...resto,
    priceCents: veDinheiro ? total : null,
    ...(veRecebimentos ? { payment: recebimento ?? null } : {}),
    hidden,
  };
}

/** team/team.service.ts:113 (`grantedTeamPermissions`). */
export function grantedTeamPermissions(role: string, permissionsConfirmed: boolean, overrides: readonly OverrideRow[]): string[] {
  if (role === EstablishmentRole.RECEPCIONISTA) return receptionistGrantedPermissions(role, overrides);
  if (role !== EstablishmentRole.PROFISSIONAL && role !== EstablishmentRole.GERENTE) return [];
  const valem = effectiveOverrides(role, permissionsConfirmed, overrides);
  return [...staffGrantedPermissions(role as EstablishmentRole, valem), ...managerGrantedPermissions(role, valem)];
}

export type DecisaoDaAgendaPropria =
  | { recusa: 'AGENDA_PROPRIA' | 'PROFISSIONAL_INATIVO' }
  | { recusa: null; allowed: Record<StaffAction, boolean>; ownCommissions: boolean };

/** team/my-agenda.service.ts:132-152 (`resolveStaffAccess`, depois do vínculo
 * ativo, do estabelecimento utilizável e do recurso EQUIPE). */
export function decisaoDaAgendaPropria(linha: {
  role: EstablishmentRole;
  permissions_confirmed: boolean;
  professional_id: string | null;
  professional_active: boolean | null;
  overrides: OverrideRow[];
}): DecisaoDaAgendaPropria {
  if (!canViewOwnAgenda(linha.role, linha.permissions_confirmed)) return { recusa: 'AGENDA_PROPRIA' };
  if (!linha.professional_id || !linha.professional_active) return { recusa: 'PROFISSIONAL_INATIVO' };
  const valem = effectiveOverrides(linha.role, linha.permissions_confirmed, linha.overrides);
  const allowed = Object.fromEntries(
    STAFF_ACTIONS.map((acao) => [acao, staffPermissionGranted(linha.role, valem, STAFF_PERMISSION_OF_ACTION[acao])]),
  ) as Record<StaffAction, boolean>;
  return { recusa: null, allowed, ownCommissions: staffPermissionGranted(linha.role, valem, OWN_COMMISSIONS_PERMISSION) };
}

/** team/team-authorization.ts:46-58 (`resolveTeamManager`, depois da prova do
 * dono): o que é concedível com os recursos ligados. */
export function concessiveis(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[],
  ligado: (recurso: string) => boolean,
): { grantable: StaffPermission[]; grantableManager: ManagerPermission[]; managerWithoutFeature: ManagerPermission[] } {
  const comissoes = ligado('COMISSOES');
  const semRecurso: ManagerPermission[] = [];
  for (const [permissao, recurso] of Object.entries(MANAGER_PERMISSION_FEATURE) as [ManagerPermission, string][]) {
    if (!ligado(recurso)) semRecurso.push(permissao);
  }
  return {
    grantable: grantableStaffPermissions(role, overrides).filter((p) => p !== OWN_COMMISSIONS_PERMISSION || comissoes),
    grantableManager: grantableManagerPermissions(role, overrides).filter((p) => !semRecurso.includes(p)),
    managerWithoutFeature: semRecurso,
  };
}
