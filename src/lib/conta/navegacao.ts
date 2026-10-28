// Navegação da área REAL (`/conta`) — regras puras, sem React, para serem
// testadas sem montar componente (não há testing-library neste projeto).
//
// Só rotas reais existentes. Nada aqui aponta para `/painel`, `/master` ou
// `/profissional`, que são a demonstração movida por dados locais.

import { ROTA_ADMINISTRACAO } from "@/lib/administracao/rotas";
import {
  ROTA_AGENDA,
  ROTA_CLIENTES,
  ROTA_CONFIGURACOES,
  ROTA_INICIO,
  ROTA_MINHA_AGENDA,
  ROTA_PROFISSIONAIS,
  ROTA_SERVICOS,
  emAreaSobConfiguracoes,
} from "./rotas";
import type { PerfilDaArea } from "./papel";

export interface ItemNavegacaoConta {
  href: string;
  rotulo: string;
  /** "barra": na barra inferior do celular (no máximo quatro áreas, para o
   * rótulo continuar legível e o toque confortável). "menu": fora da barra;
   * no celular fica no menu da conta (canto superior). No computador todas
   * aparecem no menu lateral. */
  noCelular: "barra" | "menu";
  /** "plataforma" separa a administração da plataforma da operação do
   * estabelecimento no menu (rótulo próprio no computador). */
  grupo?: "plataforma";
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

/** Administração da plataforma. Só entra no menu quando o backend confirmou
 * o acesso (`GET /platform/access`); esconder o item não substitui a
 * autorização, que o servidor refaz em toda leitura. */
export const ITEM_ADMINISTRACAO: ItemNavegacaoConta = {
  href: ROTA_ADMINISTRACAO,
  rotulo: "Administração",
  noCelular: "menu",
  grupo: "plataforma",
};

/**
 * Itens do menu para esta sessão.
 *
 * - Dono com estabelecimento ativo: Início, Agenda, Clientes, Serviços,
 *   Profissionais e Configurações; quem administra a plataforma ganha "Administração" num
 *   grupo próprio (no celular, pelo menu da conta, para a barra continuar com
 *   quatro áreas).
 * - Funcionário: "Minha agenda" e "Configurações" (e "Administração" na
 *   barra, se for o caso).
 * - Papel sem área (GERENTE, RECEPCIONISTA antigos): só "Configurações".
 * - Sem estabelecimento: só para quem administra a plataforma (um
 *   administrador não precisa de vínculo): Administração e Configurações.
 * - Sem nenhum dos dois: sem menu.
 */
export function itensDaNavegacao({
  comEstabelecimento,
  comAdministracao,
  perfil = "dono",
}: {
  comEstabelecimento: boolean;
  comAdministracao: boolean;
  /** Perfil no estabelecimento ativo (ver papel.ts). */
  perfil?: PerfilDaArea;
}): readonly ItemNavegacaoConta[] {
  const administracaoNaBarra: ItemNavegacaoConta = { ...ITEM_ADMINISTRACAO, noCelular: "barra" };
  if (comEstabelecimento && perfil === "funcionario") {
    return comAdministracao ? [...ITENS_NAVEGACAO_FUNCIONARIO, administracaoNaBarra] : ITENS_NAVEGACAO_FUNCIONARIO;
  }
  if (comEstabelecimento && perfil === "sem-area") {
    return comAdministracao ? [administracaoNaBarra, ITEM_CONFIGURACOES] : [ITEM_CONFIGURACOES];
  }
  if (comEstabelecimento) {
    return comAdministracao ? [...ITENS_NAVEGACAO_CONTA, ITEM_ADMINISTRACAO] : ITENS_NAVEGACAO_CONTA;
  }
  if (!comAdministracao) return [];
  return [administracaoNaBarra, ITEM_CONFIGURACOES];
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
