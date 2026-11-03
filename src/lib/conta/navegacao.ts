// Navegação da área REAL (`/conta`) — regras puras, sem React, para serem
// testadas sem montar componente (não há testing-library neste projeto).
//
// Só rotas reais existentes. Nada aqui aponta para `/painel`, `/master` ou
// `/profissional`, que são a demonstração movida por dados locais. Também
// nada aponta para o portal da plataforma: a operação só mostra funções do
// estabelecimento, inclusive para quem também é proprietário da plataforma
// (o portal tem entrada própria em `/portal`).

import {
  ROTA_AGENDA,
  ROTA_CLIENTES,
  ROTA_CONFIGURACOES,
  ROTA_INICIO,
  ROTA_MINHA_AGENDA,
  ROTA_PROFISSIONAIS,
  ROTA_RECEBIMENTOS,
  ROTA_SERVICOS,
  ROTA_SOLICITACOES,
  emAreaSobConfiguracoes,
} from "./rotas";
import { temArea, type AreaDoEstabelecimento, type PerfilDaArea } from "./papel";
import type { TenantContextReal } from "@/lib/api/auth-api";

export interface ItemNavegacaoConta {
  href: string;
  rotulo: string;
  /** "barra": na barra inferior do celular (no máximo quatro áreas, para o
   * rótulo continuar legível e o toque confortável). "menu": fora da barra;
   * no celular fica no menu da conta (canto superior). No computador todas
   * aparecem no menu lateral. */
  noCelular: "barra" | "menu";
}

/** Operação do dono, na ordem do dia a dia: o resumo, a agenda (que também
 * reúne as solicitações), os clientes, o que se atende e quem atende, e as
 * configurações. Serviços e Profissionais ficam fora da barra do celular
 * (quatro áreas no máximo) e aparecem no menu da conta. */
export const ITENS_NAVEGACAO_CONTA: readonly ItemNavegacaoConta[] = [
  { href: ROTA_INICIO, rotulo: "Início", noCelular: "barra" },
  { href: ROTA_AGENDA, rotulo: "Agenda", noCelular: "barra" },
  { href: ROTA_CLIENTES, rotulo: "Clientes", noCelular: "barra" },
  { href: ROTA_SERVICOS, rotulo: "Serviços", noCelular: "menu" },
  { href: ROTA_PROFISSIONAIS, rotulo: "Profissionais", noCelular: "menu" },
  { href: ROTA_CONFIGURACOES, rotulo: "Configurações", noCelular: "barra" },
];

const ITEM_CONFIGURACOES: ItemNavegacaoConta = { href: ROTA_CONFIGURACOES, rotulo: "Configurações", noCelular: "barra" };

/** Menu do funcionário: a própria agenda e as configurações pessoais. */
export const ITENS_NAVEGACAO_FUNCIONARIO: readonly ItemNavegacaoConta[] = [
  { href: ROTA_MINHA_AGENDA, rotulo: "Minha agenda", noCelular: "barra" },
  ITEM_CONFIGURACOES,
];

/** Menu do gerente: só as áreas concedidas, na ordem do dia a dia. A agenda
 * do estabelecimento já traz a aba Solicitações; sem ela, Solicitações vira o
 * item próprio. Até quatro na barra do celular (o resto no menu da conta),
 * com Configurações sempre por último. */
export function itensDoGerente(contexto: Pick<TenantContextReal, "role" | "areas"> | null | undefined): ItemNavegacaoConta[] {
  const tem = (area: AreaDoEstabelecimento) => temArea(contexto, area);
  const candidatos: ItemNavegacaoConta[] = [];
  if (tem("AGENDA_VER")) candidatos.push({ href: ROTA_AGENDA, rotulo: "Agenda", noCelular: "barra" });
  else if (tem("SOLICITACOES_VER")) candidatos.push({ href: ROTA_SOLICITACOES, rotulo: "Solicitações", noCelular: "barra" });
  if (tem("AGENDA_PROPRIA_VER")) candidatos.push({ href: ROTA_MINHA_AGENDA, rotulo: "Minha agenda", noCelular: "barra" });
  if (tem("CLIENTES_VER")) candidatos.push({ href: ROTA_CLIENTES, rotulo: "Clientes", noCelular: "barra" });
  if (tem("RECEBIMENTOS_VER")) candidatos.push({ href: ROTA_RECEBIMENTOS, rotulo: "Recebimentos", noCelular: "barra" });
  if (tem("SERVICOS_VER")) candidatos.push({ href: ROTA_SERVICOS, rotulo: "Serviços", noCelular: "barra" });
  if (tem("PROFISSIONAIS_VER")) candidatos.push({ href: ROTA_PROFISSIONAIS, rotulo: "Profissionais", noCelular: "barra" });
  const itens = candidatos.map((item, i) => ({ ...item, noCelular: i < 3 ? ("barra" as const) : ("menu" as const) }));
  return [...itens, ITEM_CONFIGURACOES];
}

/**
 * Itens do menu para esta sessão. Só operação do estabelecimento ativo.
 *
 * - Dono com estabelecimento ativo: Início, Agenda, Clientes, Serviços,
 *   Profissionais e Configurações.
 * - Funcionário: "Minha agenda" e "Configurações".
 * - Gerente: as áreas concedidas pelo dono (ver `itensDoGerente`).
 * - Papel sem área (RECEPCIONISTA antigo): só "Configurações".
 * - Sem estabelecimento (ou com o acesso vencido): sem menu.
 */
export function itensDaNavegacao({
  comEstabelecimento,
  perfil = "dono",
  contexto,
}: {
  comEstabelecimento: boolean;
  /** Perfil no estabelecimento ativo (ver papel.ts). */
  perfil?: PerfilDaArea;
  /** Contexto ativo, com as áreas que o servidor liberou (gerente). */
  contexto?: Pick<TenantContextReal, "role" | "areas"> | null;
}): readonly ItemNavegacaoConta[] {
  if (!comEstabelecimento) return [];
  if (perfil === "gerente") return itensDoGerente(contexto);
  if (perfil === "funcionario") return ITENS_NAVEGACAO_FUNCIONARIO;
  if (perfil === "sem-area") return [ITEM_CONFIGURACOES];
  return ITENS_NAVEGACAO_CONTA;
}

/**
 * O item corresponde à página atual? Vale também para as subpáginas
 * (`/conta/agendamentos/solicitacoes` continua em "Agenda";
 * `/conta/configuracoes/profissionais/{id}/horarios`, em "Profissionais").
 * Serviços e Profissionais moram sob `/conta/configuracoes`, mas são áreas
 * próprias: nelas, Configurações não fica ativa.
 */
export function itemAtivo(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const atual = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (href === "/conta") return atual === "/conta";
  if (href === ROTA_CONFIGURACOES && emAreaSobConfiguracoes(atual)) return false;
  return atual === href || atual.startsWith(`${href}/`);
}

/** Nome acessível do sino do cabeçalho. Sem lista carregada (`null`), não
 * afirma número nenhum. */
export function rotuloDoSino(pendentes: number | null): string {
  if (pendentes === null) return "Notificações";
  if (pendentes === 0) return "Notificações: nenhuma solicitação pendente";
  if (pendentes === 1) return "Notificações: 1 solicitação pendente";
  return `Notificações: ${pendentes} solicitações pendentes`;
}
