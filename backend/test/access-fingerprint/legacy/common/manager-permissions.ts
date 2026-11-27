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
// RECEPCIONISTA (docs/plans/vendas-v1.md, seção 3): recebe do dono só as
// concessões de `RECEPTIONIST_PERMISSIONS` (registrar vendas, receber as
// próprias vendas e alterar o preço numa venda nova), cada uma explícita.
// Nunca consulta todas as vendas, cancela, estorna ou opera o estoque, nem
// com `GRANTED` gravado: `receptionistCan` só olha a lista dela.
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
  'ESTOQUE_VISUALIZAR',
  'ESTOQUE_GERENCIAR',
  'VENDAS_REGISTRAR',
  'VENDAS_RECEBER',
  'VENDAS_ALTERAR_PRECO',
  'VENDAS_VISUALIZAR',
  'VENDAS_CANCELAR',
  'VENDAS_ESTORNAR_RECEBIMENTO',
] as const;
export type ManagerPermission = (typeof MANAGER_PERMISSIONS)[number];

export type ManagerArea =
  | 'AGENDA'
  | 'SOLICITACOES'
  | 'CLIENTES'
  | 'SERVICOS'
  | 'PROFISSIONAIS'
  | 'RECEBIMENTOS'
  | 'ESTOQUE'
  | 'VENDAS';

export const MANAGER_AREA_LABELS: Readonly<Record<ManagerArea, string>> = {
  AGENDA: 'Agenda do estabelecimento',
  SOLICITACOES: 'Solicitações',
  CLIENTES: 'Clientes',
  SERVICOS: 'Serviços',
  PROFISSIONAIS: 'Profissionais',
  RECEBIMENTOS: 'Recebimentos',
  ESTOQUE: 'Estoque',
  VENDAS: 'Vendas',
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
  ESTOQUE_VISUALIZAR: {
    area: 'ESTOQUE',
    label: 'Ver estoque',
    detail: 'Vê produtos, categorias, saldos, movimentações e conferências. Depende do adicional Estoque.',
  },
  ESTOQUE_GERENCIAR: {
    area: 'ESTOQUE',
    label: 'Operar estoque',
    detail: 'Cadastra produtos e categorias, registra movimentações e confirma conferências. Inclui ver estoque.',
  },
  VENDAS_REGISTRAR: {
    area: 'VENDAS',
    label: 'Registrar vendas',
    detail:
      'Vende produtos do catálogo pelo preço sugerido e consulta as próprias vendas e recebimentos. Não dá acesso ao estoque. Depende do adicional Vendas.',
  },
  VENDAS_RECEBER: {
    area: 'VENDAS',
    label: 'Receber vendas',
    detail:
      'Registra o recebimento das vendas que a própria pessoa registrou; de vendas de outras pessoas, só junto com consultar todas as vendas.',
  },
  VENDAS_ALTERAR_PRECO: {
    area: 'VENDAS',
    label: 'Alterar o preço numa venda nova',
    detail: 'Aplica um preço diferente do sugerido ao registrar uma venda. Nunca edita uma venda já registrada.',
  },
  VENDAS_VISUALIZAR: {
    area: 'VENDAS',
    label: 'Consultar todas as vendas',
    detail: 'Vê todas as vendas, os recebimentos de vendas com os totais do período e as compras na ficha do cliente.',
  },
  VENDAS_CANCELAR: {
    area: 'VENDAS',
    label: 'Cancelar vendas',
    detail: 'Cancela uma venda inteira, com motivo e senha confirmada, devolvendo os itens ao estoque.',
  },
  VENDAS_ESTORNAR_RECEBIMENTO: {
    area: 'VENDAS',
    label: 'Estornar recebimentos de vendas',
    detail: 'Estorna o recebimento de uma venda, com motivo e senha confirmada.',
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
  // Operar estoque inclui ver estoque.
  ESTOQUE_VISUALIZAR: [],
  ESTOQUE_GERENCIAR: ['ESTOQUE_VISUALIZAR'],
  // Receber e mudar o preço acontecem sobre a própria venda; cancelar e
  // estornar pedem achar a venda entre todas.
  VENDAS_REGISTRAR: [],
  VENDAS_RECEBER: ['VENDAS_REGISTRAR'],
  VENDAS_ALTERAR_PRECO: ['VENDAS_REGISTRAR'],
  VENDAS_VISUALIZAR: [],
  VENDAS_CANCELAR: ['VENDAS_VISUALIZAR'],
  VENDAS_ESTORNAR_RECEBIMENTO: ['VENDAS_VISUALIZAR'],
};

/** Concessões que só valem com o adicional contratado: sem o recurso, o
 * catálogo as mostra como não concedíveis e o servidor recusa a concessão
 * (`RECURSO_NAO_CONTRATADO`). Uma concessão gravada antes da retirada fica
 * guardada, sem efeito, até a recontratação (o gate comercial vem antes). */
export const MANAGER_PERMISSION_FEATURE: Readonly<Partial<Record<ManagerPermission, 'ESTOQUE' | 'VENDAS'>>> = {
  ESTOQUE_VISUALIZAR: 'ESTOQUE',
  ESTOQUE_GERENCIAR: 'ESTOQUE',
  // VENDAS só é contratável com ESTOQUE (commercial/subscription.ts).
  VENDAS_REGISTRAR: 'VENDAS',
  VENDAS_RECEBER: 'VENDAS',
  VENDAS_ALTERAR_PRECO: 'VENDAS',
  VENDAS_VISUALIZAR: 'VENDAS',
  VENDAS_CANCELAR: 'VENDAS',
  VENDAS_ESTORNAR_RECEBIMENTO: 'VENDAS',
};

/** O que o dono pode conceder à RECEPCIONISTA, cada uma separada. */
export const RECEPTIONIST_PERMISSIONS = ['VENDAS_REGISTRAR', 'VENDAS_RECEBER', 'VENDAS_ALTERAR_PRECO'] as const;
export type ReceptionistPermission = (typeof RECEPTIONIST_PERMISSIONS)[number];

export function isReceptionistPermission(valor: string): valor is ReceptionistPermission {
  return (RECEPTIONIST_PERMISSIONS as readonly string[]).includes(valor);
}

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

/** RECEPCIONISTA com TODAS estas permissões concedidas e nenhuma negada, e
 * só dentro da lista dela. Para qualquer outro papel, `false`. */
export function receptionistGranted(role: string, overrides: readonly AjusteLike[], permissoes: readonly string[]): boolean {
  if (role !== 'RECEPCIONISTA') return false;
  return permissoes.every(
    (p) =>
      isReceptionistPermission(p) &&
      overrides.some((o) => o.permission === p && o.mode === PermissionMode.GRANTED) &&
      !overrides.some((o) => o.permission === p && o.mode === PermissionMode.DENIED),
  );
}

/** RECEPCIONISTA pode a ação desta permissão: ela e as dependências dela
 * concedidas, todas da lista da recepcionista. */
export function receptionistCan(role: string, overrides: readonly AjusteLike[], permissao: ManagerPermission): boolean {
  return receptionistGranted(role, overrides, [permissao, ...MANAGER_PERMISSION_REQUIRES[permissao]]);
}

/** Concessões de recepcionista que valem neste vínculo. */
export function receptionistGrantedPermissions(role: string, overrides: readonly AjusteLike[]): ReceptionistPermission[] {
  return RECEPTIONIST_PERMISSIONS.filter((p) => receptionistGranted(role, overrides, [p]));
}

/** Concessões de gerente que valem neste vínculo, na ordem do catálogo. */
export function managerGrantedPermissions(role: string, overrides: readonly AjusteLike[]): ManagerPermission[] {
  return MANAGER_PERMISSIONS.filter((p) => managerGranted(role, overrides, [p]));
}
