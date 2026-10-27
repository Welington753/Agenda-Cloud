// O que a área real oferece a cada papel no estabelecimento ATIVO. Só
// apresentação e navegação: quem autoriza é o servidor, em toda requisição
// (uma rota do dono responde 403 ao funcionário mesmo que a tela seja aberta
// pelo endereço). Esconder o que a pessoa não usa evita leituras que só
// voltariam recusadas.
//
// - DONO: a operação inteira do estabelecimento e todas as Configurações.
// - PROFISSIONAL (funcionário): só a própria agenda e as configurações
//   pessoais (Aparência, Perfil e segurança).
// - GERENTE e RECEPCIONISTA: papéis antigos sem área liberada; só as
//   configurações pessoais. O mesmo vale para quem não tem estabelecimento.
import type { PapelEstabelecimentoReal } from "@/lib/api/auth-api";
import {
  ROTA_AGENDA,
  ROTA_CONFIGURACOES,
  ROTA_INICIO,
  ROTA_MINHA_AGENDA,
  ROTA_SELECIONAR_ESTABELECIMENTO,
  emSecaoDoEstabelecimento,
} from "./rotas";

export { ROTA_EQUIPE, ROTA_MINHA_AGENDA } from "./rotas";
/** Mantido pelo nome antigo: o Início continua no mesmo endereço. */
export const ROTA_VISAO_GERAL = ROTA_INICIO;

export type PerfilDaArea = "dono" | "funcionario" | "sem-area";

export function perfilDoPapel(papel: PapelEstabelecimentoReal | null | undefined): PerfilDaArea {
  if (papel === "DONO") return "dono";
  if (papel === "PROFISSIONAL") return "funcionario";
  return "sem-area";
}

/** Onde cada perfil começa (depois de entrar ou trocar de estabelecimento).
 * Quem administra a plataforma sem estabelecimento é levado à administração
 * pela própria página `/conta`, que sabe do acesso confirmado. */
export function inicioDoPerfil(perfil: PerfilDaArea): string {
  if (perfil === "dono") return ROTA_INICIO;
  if (perfil === "funcionario") return ROTA_MINHA_AGENDA;
  return ROTA_CONFIGURACOES;
}

const dentro = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

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
 * dono que abre a agenda de funcionário vai para a geral.
 */
export function redirecionamentoDoPerfil(perfil: PerfilDaArea, pathname: string | null): string | null {
  if (!pathname) return null;
  const caminho = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (!caminho.startsWith("/conta") || paginaComum(caminho)) return null;
  if (perfil === "dono") return dentro(caminho, ROTA_MINHA_AGENDA) ? ROTA_AGENDA : null;
  if (emSecaoDoEstabelecimento(caminho)) return ROTA_CONFIGURACOES;
  if (perfil === "funcionario") return dentro(caminho, ROTA_MINHA_AGENDA) ? null : ROTA_MINHA_AGENDA;
  return ROTA_CONFIGURACOES;
}
