// O que a área real oferece a cada papel no estabelecimento ATIVO. Só
// apresentação e navegação: quem autoriza é o servidor, em toda requisição
// (uma rota do dono responde 403 ao funcionário mesmo que a tela seja aberta
// pelo endereço). Esconder o que a pessoa não usa evita leituras que só
// voltariam recusadas.
//
// - DONO: a operação inteira do estabelecimento.
// - PROFISSIONAL (funcionário): só a própria agenda e Minha conta.
// - GERENTE e RECEPCIONISTA: papéis antigos sem área liberada; só Minha conta.
import type { PapelEstabelecimentoReal } from "@/lib/api/auth-api";

export const ROTA_MINHA_AGENDA = "/conta/minha-agenda";
export const ROTA_EQUIPE = "/conta/equipe";
export const ROTA_VISAO_GERAL = "/conta/visao-geral";

export type PerfilDaArea = "dono" | "funcionario" | "sem-area";

export function perfilDoPapel(papel: PapelEstabelecimentoReal | null | undefined): PerfilDaArea {
  if (papel === "DONO") return "dono";
  if (papel === "PROFISSIONAL") return "funcionario";
  return "sem-area";
}

/** Onde cada perfil começa (depois de entrar ou trocar de estabelecimento). */
export function inicioDoPerfil(perfil: PerfilDaArea): string {
  if (perfil === "dono") return ROTA_VISAO_GERAL;
  if (perfil === "funcionario") return ROTA_MINHA_AGENDA;
  return "/conta";
}

/** Páginas de `/conta` que valem para qualquer perfil: Minha conta, a
 * escolha de estabelecimento e a administração da plataforma (que tem
 * autorização própria, independente do papel no estabelecimento). */
function paginaComum(pathname: string): boolean {
  return (
    pathname === "/conta" ||
    pathname === "/conta/selecionar-estabelecimento" ||
    pathname === "/conta/administracao" ||
    pathname.startsWith("/conta/administracao/")
  );
}

const dentro = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/**
 * Para onde levar quem abriu uma página que não é do seu perfil (`null`:
 * pode ficar). O funcionário que abre a agenda geral pelo endereço vai para a
 * dele; o dono que abre a agenda de funcionário vai para a geral.
 */
export function redirecionamentoDoPerfil(perfil: PerfilDaArea, pathname: string | null): string | null {
  if (!pathname) return null;
  const caminho = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (!caminho.startsWith("/conta") || paginaComum(caminho)) return null;
  if (perfil === "funcionario") return dentro(caminho, ROTA_MINHA_AGENDA) ? null : ROTA_MINHA_AGENDA;
  if (perfil === "dono") return dentro(caminho, ROTA_MINHA_AGENDA) ? "/conta/agendamentos" : null;
  return "/conta";
}
