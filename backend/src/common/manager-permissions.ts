// Permissões que o DONO concede a um GERENTE, uma a uma, em "Equipe e
// acessos" (ver docs/plans/equipe-gerente-login-interno.md). Função pura,
// sem Nest e sem banco.
//
// REGRA: o nome do papel não libera nada. GERENTE só faz o que tem `GRANTED`
// explícito (e confirmado pelo dono, ver `effectiveOverrides`), e um `DENIED`
// sempre vence. Cada política de módulo (`*-access.ts`) pergunta aqui, com a
// MESMA lista de permissões que já exige do dono para aquela ação: se o dono
// precisa de cinco permissões não negadas para criar uma reserva, o gerente
// precisa das mesmas cinco concedidas.
//
// DEPENDÊNCIAS: uma permissão que só funciona junto de outras (criar reserva
// exige ver agenda, profissionais, serviços e clientes) traz a lista em
// `MANAGER_PERMISSION_REQUIRES`. O servidor recusa um conjunto que não feche
// as dependências, e a tela mostra ao dono exatamente o conjunto final:
// nenhuma permissão entra calada.
//
// FORA DESTA LISTA, e portanto só do dono neste lote: o Início (resumo com
// plano, vagas e dinheiro), as configurações do estabelecimento, o
// agendamento online, os avisos no aparelho, a equipe e as credenciais de
// terceiros. A administração da plataforma nunca depende de papel aqui.
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';

export const MANAGER_PERMISSIONS = [
  'AGENDA_VISUALIZAR',
  'AGENDA_GERENCIAR',
  'AGENDAMENTO_CRIAR',
  'AGENDAMENTO_EDITAR',
  'AGENDAMENTO_CANCELAR',
  'SOLICITACOES_VISUALIZAR',
  'SOLICITACOES_TRATAR',
  'CONSUMIDORES_VISUALIZAR',
  'CONSUMIDORES_GERENCIAR',
  'SERVICOS_VISUALIZAR',
  'SERVICOS_GERENCIAR',
  'PROFISSIONAIS_VISUALIZAR',
  'PROFISSIONAIS_GERENCIAR',
  'RECEBIMENTOS_VISUALIZAR',
  'RECEBIMENTOS_REGISTRAR',
  'RECEBIMENTOS_ESTORNAR',
] as const;
export type ManagerPermission = (typeof MANAGER_PERMISSIONS)[number];

export type ManagerArea = 'AGENDA' | 'SOLICITACOES' | 'CLIENTES' | 'SERVICOS' | 'PROFISSIONAIS' | 'RECEBIMENTOS';

export const MANAGER_AREA_LABELS: Readonly<Record<ManagerArea, string>> = {
  AGENDA: 'Agenda do estabelecimento',
  SOLICITACOES: 'Solicitações',
  CLIENTES: 'Clientes',
  SERVICOS: 'Serviços',
  PROFISSIONAIS: 'Profissionais',
  RECEBIMENTOS: 'Recebimentos',
};

export const MANAGER_PERMISSION_META: Readonly<
  Record<ManagerPermission, { area: ManagerArea; label: string; detail: string }>
> = {
  AGENDA_VISUALIZAR: {
    area: 'AGENDA',
    label: 'Consultar a agenda de todos os profissionais',
    detail: 'Vê os atendimentos do estabelecimento, de todos os profissionais, com o nome do cliente e o serviço.',
  },
  AGENDA_GERENCIAR: {
    area: 'AGENDA',
    label: 'Confirmar, iniciar, concluir e marcar falta',
    detail: 'Muda o andamento de qualquer atendimento da agenda do estabelecimento.',
  },
  AGENDAMENTO_CRIAR: {
    area: 'AGENDA',
    label: 'Criar reservas',
    detail: 'Marca atendimentos pela agenda para qualquer profissional.',
  },
  AGENDAMENTO_EDITAR: {
    area: 'AGENDA',
    label: 'Remarcar reservas',
    detail: 'Troca o horário de um atendimento marcado.',
  },
  AGENDAMENTO_CANCELAR: {
    area: 'AGENDA',
    label: 'Cancelar reservas',
    detail: 'Cancela atendimentos marcados.',
  },
  SOLICITACOES_VISUALIZAR: {
    area: 'SOLICITACOES',
    label: 'Consultar solicitações',
    detail: 'Vê os pedidos de horário que aguardam resposta.',
  },
  SOLICITACOES_TRATAR: {
    area: 'SOLICITACOES',
    label: 'Aceitar e recusar solicitações',
    detail: 'Confirma ou recusa um pedido de horário que ainda aguarda resposta.',
  },
  CONSUMIDORES_VISUALIZAR: {
    area: 'CLIENTES',
    label: 'Consultar clientes',
    detail: 'Vê a lista de clientes com telefone e e-mail, e o telefone e as observações nos atendimentos.',
  },
  CONSUMIDORES_GERENCIAR: {
    area: 'CLIENTES',
    label: 'Cadastrar clientes',
    detail: 'Cadastra clientes novos.',
  },
  SERVICOS_VISUALIZAR: {
    area: 'SERVICOS',
    label: 'Consultar serviços',
    detail: 'Vê os serviços, com preço e duração.',
  },
  SERVICOS_GERENCIAR: {
    area: 'SERVICOS',
    label: 'Gerenciar serviços',
    detail: 'Cria, edita, desativa e reativa serviços.',
  },
  PROFISSIONAIS_VISUALIZAR: {
    area: 'PROFISSIONAIS',
    label: 'Consultar profissionais',
    detail: 'Vê os profissionais, os serviços que atendem e os horários de trabalho.',
  },
  PROFISSIONAIS_GERENCIAR: {
    area: 'PROFISSIONAIS',
    label: 'Gerenciar profissionais e horários',
    detail: 'Cria, edita, desativa e reativa profissionais e muda os horários de trabalho.',
  },
  RECEBIMENTOS_VISUALIZAR: {
    area: 'RECEBIMENTOS',
    label: 'Consultar recebimentos',
    detail: 'Vê os recebimentos registrados, os totais e o preço dos atendimentos.',
  },
  RECEBIMENTOS_REGISTRAR: {
    area: 'RECEBIMENTOS',
    label: 'Registrar recebimentos',
    detail: 'Lança o pagamento de um atendimento concluído.',
  },
  RECEBIMENTOS_ESTORNAR: {
    area: 'RECEBIMENTOS',
    label: 'Estornar recebimentos',
    detail: 'Estorna um recebimento já registrado, com motivo.',
  },
};

/** O que cada permissão exige junto (fechamento já calculado: a lista de
 * cada uma inclui as dependências das dependências). */
export const MANAGER_PERMISSION_REQUIRES: Readonly<Record<ManagerPermission, readonly ManagerPermission[]>> = {
  // A agenda mostra as colunas e o filtro por profissional.
  AGENDA_VISUALIZAR: ['PROFISSIONAIS_VISUALIZAR'],
  AGENDA_GERENCIAR: ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'],
  AGENDAMENTO_CRIAR: ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR', 'SERVICOS_VISUALIZAR', 'CONSUMIDORES_VISUALIZAR'],
  AGENDAMENTO_EDITAR: ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR', 'SERVICOS_VISUALIZAR'],
  AGENDAMENTO_CANCELAR: ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'],
  SOLICITACOES_VISUALIZAR: [],
  SOLICITACOES_TRATAR: ['SOLICITACOES_VISUALIZAR'],
  CONSUMIDORES_VISUALIZAR: [],
  CONSUMIDORES_GERENCIAR: ['CONSUMIDORES_VISUALIZAR'],
  SERVICOS_VISUALIZAR: [],
  SERVICOS_GERENCIAR: ['SERVICOS_VISUALIZAR'],
  PROFISSIONAIS_VISUALIZAR: [],
  PROFISSIONAIS_GERENCIAR: ['PROFISSIONAIS_VISUALIZAR'],
  // Os recebimentos são lançados sobre os atendimentos da agenda.
  RECEBIMENTOS_VISUALIZAR: ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'],
  RECEBIMENTOS_REGISTRAR: ['RECEBIMENTOS_VISUALIZAR', 'AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'],
  RECEBIMENTOS_ESTORNAR: ['RECEBIMENTOS_VISUALIZAR', 'AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'],
};

export function isManagerPermission(valor: string): valor is ManagerPermission {
  return (MANAGER_PERMISSIONS as readonly string[]).includes(valor);
}

/** Dependências que faltam no conjunto (vazio: o conjunto fecha). */
export function missingManagerRequirements(conjunto: readonly ManagerPermission[]): ManagerPermission[] {
  const tem = new Set(conjunto);
  const faltam = new Set<ManagerPermission>();
  for (const p of conjunto) for (const r of MANAGER_PERMISSION_REQUIRES[p]) if (!tem.has(r)) faltam.add(r);
  return MANAGER_PERMISSIONS.filter((p) => faltam.has(p));
}

interface AjusteLike {
  permission: string;
  mode: string;
}

/** GERENTE com TODAS as permissões concedidas e nenhuma negada. Para
 * qualquer outro papel, `false` (o dono segue a própria política). */
export function managerGranted(role: string, overrides: readonly AjusteLike[], permissoes: readonly string[]): boolean {
  if (role !== 'GERENTE') return false;
  return permissoes.every(
    (p) =>
      overrides.some((o) => o.permission === p && o.mode === PermissionMode.GRANTED) &&
      !overrides.some((o) => o.permission === p && o.mode === PermissionMode.DENIED),
  );
}

/** GERENTE pode a ação desta permissão: ela e as dependências dela
 * concedidas. É o que as políticas dos módulos perguntam. */
export function managerCan(role: string, overrides: readonly AjusteLike[], permissao: ManagerPermission): boolean {
  return managerGranted(role, overrides, [permissao, ...MANAGER_PERMISSION_REQUIRES[permissao]]);
}

/** Concessões de gerente que valem neste vínculo, na ordem do catálogo. */
export function managerGrantedPermissions(role: string, overrides: readonly AjusteLike[]): ManagerPermission[] {
  return MANAGER_PERMISSIONS.filter((p) => managerGranted(role, overrides, [p]));
}
