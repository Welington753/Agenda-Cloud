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
  ROTA_COMISSOES,
  ROTA_CONFIGURACOES,
  ROTA_EQUIPE,
  ROTA_ESTOQUE_CATEGORIAS,
  ROTA_ESTOQUE_CONFERENCIA,
  ROTA_ESTOQUE_MOVIMENTACOES,
  ROTA_ESTOQUE_PRODUTOS,
  ROTA_INICIO,
  ROTA_MINHA_AGENDA,
  ROTA_PROFISSIONAIS,
  ROTA_RECEBIMENTOS,
  ROTA_SERVICOS,
  ROTA_SOLICITACOES,
  emAreaSobConfiguracoes,
} from "./rotas";
import { temArea, type AreaDoEstabelecimento, type PerfilDaArea } from "./papel";
import { rotuloDosProfissionais } from "./termos";
import type { TenantContextReal } from "@/lib/api/auth-api";

export interface ItemNavegacaoConta {
  href: string;
  rotulo: string;
}

// Celular e computador mostram os MESMOS itens: no celular, a barra inferior
// rola na horizontal (components/conta/faixa-de-areas.tsx); no computador,
// o menu lateral. Nenhuma área fica só no menu da conta.

const ITEM_CONFIGURACOES: ItemNavegacaoConta = { href: ROTA_CONFIGURACOES, rotulo: "Configurações" };

/** Seção Estoque (adicional ESTOQUE): grupo "Estoque" do menu. */
const ITENS_DO_ESTOQUE: readonly ItemNavegacaoConta[] = [
  { href: ROTA_ESTOQUE_PRODUTOS, rotulo: "Produtos" },
  { href: ROTA_ESTOQUE_CATEGORIAS, rotulo: "Categorias" },
  { href: ROTA_ESTOQUE_MOVIMENTACOES, rotulo: "Movimentações" },
  { href: ROTA_ESTOQUE_CONFERENCIA, rotulo: "Conferência de estoque" },
];

/** O que o menu lê do contexto ativo: o papel, as áreas que o servidor
 * liberou e o segmento do estabelecimento (ausente numa API anterior). */
export type ContextoDoMenu = Pick<TenantContextReal, "role" | "areas"> & { tenantCategory?: string };

/**
 * Menu do dono: a visão geral, a agenda (que também reúne as solicitações),
 * quem atende, o que se atende, os clientes, a equipe, as comissões e as
 * configurações.
 *
 * - "Profissionais" usa o termo do segmento do estabelecimento ("Barbeiros"
 *   na barbearia; ver termos.ts). O endereço é o mesmo.
 * - "Comissões" só entra quando o servidor lista a área `COMISSOES_VER`, que
 *   ele só dá com o recurso no plano e sem restrição ao dono. Sem a lista de
 *   áreas (API anterior), não entra: a tela não presume o plano.
 * - O Estoque (Produtos, Categorias, Movimentações e Conferência) segue a
 *   mesma regra, com a área `ESTOQUE_VER` (adicional contratado).
 * - No menu (lateral no computador, barra no celular) os mesmos itens aparecem em grupos por assunto
 *   (`gruposDaNavegacao`), em todos os temas.
 */
export function itensDoDono(contexto?: ContextoDoMenu | null): ItemNavegacaoConta[] {
  const itens: ItemNavegacaoConta[] = [
    { href: ROTA_INICIO, rotulo: "Visão geral" },
    { href: ROTA_AGENDA, rotulo: "Agenda" },
    { href: ROTA_PROFISSIONAIS, rotulo: rotuloDosProfissionais(contexto?.tenantCategory) },
    { href: ROTA_SERVICOS, rotulo: "Serviços" },
    { href: ROTA_CLIENTES, rotulo: "Clientes" },
    { href: ROTA_EQUIPE, rotulo: "Equipe e acessos" },
  ];
  if (contexto?.areas?.includes("COMISSOES_VER")) {
    itens.push({ href: ROTA_COMISSOES, rotulo: "Comissões" });
  }
  if (contexto?.areas?.includes("ESTOQUE_VER")) itens.push(...ITENS_DO_ESTOQUE);
  return [...itens, ITEM_CONFIGURACOES];
}

/** Menu do funcionário: a própria agenda e as configurações pessoais. */
export const ITENS_NAVEGACAO_FUNCIONARIO: readonly ItemNavegacaoConta[] = [
  { href: ROTA_MINHA_AGENDA, rotulo: "Minha agenda" },
  ITEM_CONFIGURACOES,
];

/** Menu do gerente: só as áreas concedidas, na ordem do dia a dia. A agenda
 * do estabelecimento já traz a aba Solicitações; sem ela, Solicitações vira o
 * item próprio. Configurações sempre por último. */
export function itensDoGerente(contexto: Pick<TenantContextReal, "role" | "areas"> | null | undefined): ItemNavegacaoConta[] {
  const tem = (area: AreaDoEstabelecimento) => temArea(contexto, area);
  const itens: ItemNavegacaoConta[] = [];
  if (tem("AGENDA_VER")) itens.push({ href: ROTA_AGENDA, rotulo: "Agenda" });
  else if (tem("SOLICITACOES_VER")) itens.push({ href: ROTA_SOLICITACOES, rotulo: "Solicitações" });
  if (tem("AGENDA_PROPRIA_VER")) itens.push({ href: ROTA_MINHA_AGENDA, rotulo: "Minha agenda" });
  if (tem("CLIENTES_VER")) itens.push({ href: ROTA_CLIENTES, rotulo: "Clientes" });
  if (tem("RECEBIMENTOS_VER")) itens.push({ href: ROTA_RECEBIMENTOS, rotulo: "Recebimentos" });
  if (tem("SERVICOS_VER")) itens.push({ href: ROTA_SERVICOS, rotulo: "Serviços" });
  if (tem("PROFISSIONAIS_VER")) itens.push({ href: ROTA_PROFISSIONAIS, rotulo: "Profissionais" });
  // O estoque vem depois das áreas do dia a dia.
  if (tem("ESTOQUE_VER")) itens.push(...ITENS_DO_ESTOQUE);
  return [...itens, ITEM_CONFIGURACOES];
}

/**
 * Itens do menu para esta sessão. Só operação do estabelecimento ativo.
 *
 * - Dono com estabelecimento ativo: ver `itensDoDono`.
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
  contexto?: ContextoDoMenu | null;
}): readonly ItemNavegacaoConta[] {
  if (!comEstabelecimento) return [];
  if (perfil === "gerente") return itensDoGerente(contexto);
  if (perfil === "funcionario") return ITENS_NAVEGACAO_FUNCIONARIO;
  if (perfil === "sem-area") return [ITEM_CONFIGURACOES];
  return itensDoDono(contexto);
}

export interface GrupoNavegacaoConta {
  /** `null`: item de entrada (Visão geral), sem título. */
  titulo: string | null;
  itens: ItemNavegacaoConta[];
}

/** Grupos do menu lateral (dono e gerente), na ordem em que aparecem; dentro de cada
 * grupo, a ordem dos endereços abaixo. Endereço fora da lista fica no grupo
 * de entrada, sem título. */
const GRUPOS: readonly { titulo: string; hrefs: readonly string[] }[] = [
  { titulo: "Atendimento", hrefs: [ROTA_AGENDA, ROTA_SOLICITACOES, ROTA_MINHA_AGENDA, ROTA_CLIENTES] },
  { titulo: "Gestão do negócio", hrefs: [ROTA_PROFISSIONAIS, ROTA_SERVICOS, ROTA_COMISSOES, ROTA_RECEBIMENTOS] },
  { titulo: "Estoque", hrefs: ITENS_DO_ESTOQUE.map((i) => i.href) },
  { titulo: "Administração", hrefs: [ROTA_EQUIPE, ROTA_CONFIGURACOES] },
];

/**
 * Organiza os itens JÁ liberados (`itensDaNavegacao`) em grupos por assunto,
 * iguais em todos os temas. Não acrescenta nem tira item: permissões,
 * áreas do plano e termos do segmento continuam vindo da lista recebida.
 * Grupo sem item não aparece.
 */
export function gruposDaNavegacao(itens: readonly ItemNavegacaoConta[]): GrupoNavegacaoConta[] {
  const agrupados = new Set(GRUPOS.flatMap((g) => g.hrefs));
  const grupos: GrupoNavegacaoConta[] = [{ titulo: null, itens: itens.filter((i) => !agrupados.has(i.href)) }];
  for (const { titulo, hrefs } of GRUPOS) {
    grupos.push({
      titulo,
      itens: hrefs.flatMap((href) => itens.filter((i) => i.href === href)),
    });
  }
  return grupos.filter((g) => g.itens.length > 0);
}

/**
 * O item corresponde à página atual? Vale também para as subpáginas
 * (`/conta/agendamentos/solicitacoes` continua em "Agenda";
 * `/conta/configuracoes/profissionais/{id}/horarios`, em "Profissionais").
 * Serviços, Profissionais e Equipe e acessos moram sob
 * `/conta/configuracoes`, mas são áreas próprias: nelas, Configurações não
 * fica ativa.
 *
 * Com `perfil` "dono", Recebimentos conta como parte de Configurações: é
 * por lá que o dono chega (grupo Financeiro), e ele não tem item próprio. O
 * gerente tem o item Recebimentos e nada muda para ele.
 */
export function itemAtivo(pathname: string | null, href: string, perfil?: PerfilDaArea): boolean {
  if (!pathname) return false;
  const atual = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (href === "/conta") return atual === "/conta";
  if (href === ROTA_CONFIGURACOES && emAreaSobConfiguracoes(atual)) return false;
  if (href === ROTA_CONFIGURACOES && perfil === "dono" && dentroDe(atual, ROTA_RECEBIMENTOS)) return true;
  return dentroDe(atual, href);
}

const dentroDe = (atual: string, base: string) => atual === base || atual.startsWith(`${base}/`);

/** Retorno da página de Recebimentos. O dono chega por Configurações e volta
 * para lá. Para os outros perfis fica como sempre foi. */
export function retornoDeRecebimentos(perfil: PerfilDaArea): { href: string; rotulo: string } {
  return perfil === "dono"
    ? { href: ROTA_CONFIGURACOES, rotulo: "Voltar para Configurações" }
    : { href: ROTA_INICIO, rotulo: "Voltar ao Início" };
}

/** Nome acessível do sino do cabeçalho. Sem lista carregada (`null`), não
 * afirma número nenhum. */
export function rotuloDoSino(pendentes: number | null): string {
  if (pendentes === null) return "Notificações";
  if (pendentes === 0) return "Notificações: nenhuma solicitação pendente";
  if (pendentes === 1) return "Notificações: 1 solicitação pendente";
  return `Notificações: ${pendentes} solicitações pendentes`;
}
