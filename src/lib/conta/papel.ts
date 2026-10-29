// O que a área real oferece a cada papel no estabelecimento ATIVO. Só
// apresentação e navegação: quem autoriza é o servidor, em toda requisição
// (uma rota do dono responde 403 ao funcionário mesmo que a tela seja aberta
// pelo endereço). Esconder o que a pessoa não usa evita leituras que só
// voltariam recusadas.
//
// - DONO: a operação inteira do estabelecimento e todas as Configurações.
// - PROFISSIONAL (funcionário): só a própria agenda e as configurações
//   pessoais (Aparência, Perfil e segurança).
// - GERENTE: só as áreas que o dono concedeu (`areas` do contexto, calculadas
//   no servidor pelas mesmas políticas das rotas), a própria agenda se tiver
//   profissional ligado, e as configurações pessoais. Nunca o Início, as
//   configurações do estabelecimento ou a equipe.
// - RECEPCIONISTA: papel antigo sem área liberada; só as configurações
//   pessoais. O mesmo vale para quem não tem estabelecimento.
import type { PapelEstabelecimentoReal, TenantContextReal } from "@/lib/api/auth-api";
import {
  ROTA_AGENDA,
  ROTA_CLIENTES,
  ROTA_CONFIGURACOES,
  ROTA_INICIO,
  ROTA_MINHA_AGENDA,
  ROTA_PROFISSIONAIS,
  ROTA_RECEBIMENTOS,
  ROTA_SELECIONAR_ESTABELECIMENTO,
  ROTA_SERVICOS,
  ROTA_SOLICITACOES,
  emSecaoDoEstabelecimento,
} from "./rotas";

export { ROTA_EQUIPE, ROTA_MINHA_AGENDA } from "./rotas";
/** Mantido pelo nome antigo: o Início continua no mesmo endereço. */
export const ROTA_VISAO_GERAL = ROTA_INICIO;

export type PerfilDaArea = "dono" | "gerente" | "funcionario" | "sem-area";

/** Chaves de `TenantContext.areas` (backend/src/accounts/tenant-effective-access.ts). */
export type AreaDoEstabelecimento =
  | "AGENDA_VER"
  | "AGENDA_CRIAR"
  | "AGENDA_REMARCAR"
  | "AGENDA_CANCELAR"
  | "AGENDA_ANDAMENTO"
  | "DISPONIBILIDADE"
  | "SOLICITACOES_VER"
  | "SOLICITACOES_TRATAR"
  | "RECEBIMENTOS_VER"
  | "RECEBIMENTOS_REGISTRAR"
  | "RECEBIMENTOS_ESTORNAR"
  | "CLIENTES_VER"
  | "CLIENTES_GERENCIAR"
  | "SERVICOS_VER"
  | "SERVICOS_GERENCIAR"
  | "PROFISSIONAIS_VER"
  | "PROFISSIONAIS_GERENCIAR"
  | "AGENDAMENTO_ONLINE"
  | "EQUIPE"
  | "AGENDA_PROPRIA_VER"
  | "AGENDA_PROPRIA_INICIAR"
  | "AGENDA_PROPRIA_CONCLUIR"
  | "AGENDA_PROPRIA_FALTA";

export function perfilDoPapel(papel: PapelEstabelecimentoReal | null | undefined): PerfilDaArea {
  if (papel === "DONO") return "dono";
  if (papel === "GERENTE") return "gerente";
  if (papel === "PROFISSIONAL") return "funcionario";
  return "sem-area";
}

/** O contexto opera esta área? Sem a lista (API anterior), o que o papel
 * sempre teve: o dono, tudo; o funcionário, a própria agenda; o resto, nada. */
export function temArea(
  contexto: Pick<TenantContextReal, "role" | "areas"> | null | undefined,
  area: AreaDoEstabelecimento,
): boolean {
  if (!contexto) return false;
  if (contexto.areas) return contexto.areas.includes(area);
  if (contexto.role === "DONO") return !area.startsWith("AGENDA_PROPRIA_");
  if (contexto.role === "PROFISSIONAL") return area === "AGENDA_PROPRIA_VER";
  return false;
}

/** Páginas do gerente e a área que cada uma exige, na ordem de preferência
 * para onde ele começa. */
const PAGINAS_DO_GERENTE: readonly { href: string; area: AreaDoEstabelecimento }[] = [
  { href: ROTA_SOLICITACOES, area: "SOLICITACOES_VER" },
  { href: ROTA_AGENDA, area: "AGENDA_VER" },
  { href: ROTA_MINHA_AGENDA, area: "AGENDA_PROPRIA_VER" },
  { href: ROTA_CLIENTES, area: "CLIENTES_VER" },
  { href: ROTA_RECEBIMENTOS, area: "RECEBIMENTOS_VER" },
  { href: ROTA_SERVICOS, area: "SERVICOS_VER" },
  { href: ROTA_PROFISSIONAIS, area: "PROFISSIONAIS_VER" },
];
const ORDEM_DE_INICIO_DO_GERENTE = [ROTA_AGENDA, ROTA_SOLICITACOES, ROTA_MINHA_AGENDA, ROTA_CLIENTES, ROTA_RECEBIMENTOS, ROTA_SERVICOS, ROTA_PROFISSIONAIS];

/** Onde cada perfil começa (depois de entrar ou trocar de estabelecimento).
 * Quem administra a plataforma sem estabelecimento é levado à administração
 * pela própria página `/conta`, que sabe do acesso confirmado. */
export function inicioDoPerfil(
  perfil: PerfilDaArea,
  contexto?: Pick<TenantContextReal, "role" | "areas"> | null,
): string {
  if (perfil === "dono") return ROTA_INICIO;
  if (perfil === "funcionario") return ROTA_MINHA_AGENDA;
  if (perfil === "gerente") {
    for (const href of ORDEM_DE_INICIO_DO_GERENTE) {
      const pagina = PAGINAS_DO_GERENTE.find((p) => p.href === href)!;
      if (temArea(contexto, pagina.area)) return href;
    }
  }
  return ROTA_CONFIGURACOES;
}

const dentro = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** Páginas que não dependem do estabelecimento ativo operar: a
 * administração da plataforma, a escolha de estabelecimento e as
 * configurações pessoais. Continuam abertas com o acesso vencido. */
export function paginaForaDoEstabelecimento(pathname: string | null): boolean {
  if (!pathname) return false;
  const caminho = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return caminho !== "/conta" && paginaComum(caminho);
}

/** Páginas de `/conta` que valem para qualquer perfil: a entrada `/conta`
 * (que só encaminha), a escolha de estabelecimento, a administração da
 * plataforma (autorização própria, independente do papel no
 * estabelecimento) e as configurações pessoais. */
function paginaComum(pathname: string): boolean {
  if (pathname === "/conta" || pathname === ROTA_SELECIONAR_ESTABELECIMENTO) return true;
  if (dentro(pathname, "/conta/administracao")) return true;
  return dentro(pathname, ROTA_CONFIGURACOES) && !emSecaoDoEstabelecimento(pathname);
}

/**
 * Para onde levar quem abriu uma página que não é do seu perfil (`null`:
 * pode ficar). O funcionário que abre a agenda geral pelo endereço vai para a
 * dele, e uma configuração do estabelecimento leva às Configurações dele; o
 * dono que abre a agenda de funcionário vai para a geral; o gerente que abre
 * uma área não concedida vai para o começo dele.
 */
export function redirecionamentoDoPerfil(
  perfil: PerfilDaArea,
  pathname: string | null,
  contexto?: Pick<TenantContextReal, "role" | "areas"> | null,
): string | null {
  if (!pathname) return null;
  const caminho = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (!caminho.startsWith("/conta") || paginaComum(caminho)) return null;
  if (perfil === "dono") return dentro(caminho, ROTA_MINHA_AGENDA) ? ROTA_AGENDA : null;
  if (perfil === "gerente") {
    // A página mais específica decide (Solicitações mora dentro da Agenda).
    const pagina = [...PAGINAS_DO_GERENTE]
      .sort((a, b) => b.href.length - a.href.length)
      .find((p) => dentro(caminho, p.href));
    if (pagina && temArea(contexto, pagina.area)) return null;
    const inicio = inicioDoPerfil("gerente", contexto);
    return inicio === caminho ? null : inicio;
  }
  if (emSecaoDoEstabelecimento(caminho)) return ROTA_CONFIGURACOES;
  if (perfil === "funcionario") return dentro(caminho, ROTA_MINHA_AGENDA) ? null : ROTA_MINHA_AGENDA;
  return ROTA_CONFIGURACOES;
}
