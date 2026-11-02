// Regras puras da conexão com a API vista pela sessão real (sem React, sem
// `window`; testadas em conexao.test.ts). Quem liga isto a efeitos é
// real-auth-context.tsx.
import type { ResultadoAutenticacaoReal, SessaoRealContexto } from "@/lib/api/auth-api";
import { reduzirResultadoSessao, type EstadoAutenticacaoReal } from "./real-session-state";

/**
 * - `ok`: nenhuma leitura esperando a API;
 * - `acordando`: a API ainda não respondeu e a leitura continua tentando
 *   (hospedagem gratuita saindo da hibernação);
 * - `sem_internet`: o aparelho está offline; a leitura espera a conexão
 *   voltar, sem enviar nada;
 * - `sem_resposta`: uma verificação com a tela já aberta esgotou o prazo.
 *   A tela continua como estava; só o aviso e "Tentar novamente" aparecem.
 */
export type EstadoConexao = "ok" | "acordando" | "sem_internet" | "sem_resposta";

/** Tempo com a página oculta (aplicativo em segundo plano, outra aba) a
 * partir do qual, ao voltar, a sessão é conferida de novo. Abaixo dos 15 min
 * que o Render gratuito espera antes de hibernar: voltar depois disso pode
 * encontrar a API dormindo, e a conferência é o acesso que a acorda. */
export const LIMIAR_RETORNO_MS = 10 * 60_000;

/** Rotas que nunca usam a sessão real: a página pública de agendamento. Lá
 * a leitura da própria página já acorda a API, e uma leitura de sessão
 * paralela só dobraria as requisições. */
export function rotaDispensaSessao(pathname: string | null): boolean {
  return pathname !== null && pathname.startsWith("/agendar/");
}

/**
 * Resultado de uma VERIFICAÇÃO com a tela já aberta (volta ao aplicativo,
 * conexão de volta). Diferente da abertura, ela nunca troca a tela por
 * carregamento ou falha: sem resposta, a tela fica como está e só o aviso
 * muda. A sessão só é substituída quando mudou de verdade (encerrada, ou
 * outra pessoa, ou a troca obrigatória de senha que deixou de valer, ou o
 * acesso de um estabelecimento que pausou ou voltou) — a mesma pessoa, com
 * os mesmos bloqueios, mantém o estado atual, e nada que dependa dele
 * (formulários abertos) é recriado.
 */
export function aplicarVerificacao(
  atual: EstadoAutenticacaoReal,
  resultado: ResultadoAutenticacaoReal<SessaoRealContexto | null>,
  preferenciaTenant: string | null,
): { estado: EstadoAutenticacaoReal; conexao: EstadoConexao } {
  if (!resultado.ok) {
    return { estado: atual, conexao: resultado.falha.tipo === "falha_comunicacao" ? "sem_resposta" : "ok" };
  }
  const proximo = reduzirResultadoSessao(resultado, preferenciaTenant);
  const mesmaPessoa =
    proximo.status === "autenticado" &&
    atual.status === "autenticado" &&
    proximo.sessao.user.id === atual.sessao.user.id &&
    proximo.sessao.user.mustChangePassword === atual.sessao.user.mustChangePassword &&
    bloqueios(proximo.sessao) === bloqueios(atual.sessao);
  const mesmoEstado = proximo.status === "nao_autenticado" && atual.status === "nao_autenticado";
  return { estado: mesmaPessoa || mesmoEstado ? atual : proximo, conexao: "ok" };
}

/** Quais estabelecimentos estão com o acesso pausado (validade vencida). */
const bloqueios = (sessao: SessaoRealContexto) =>
  sessao.contexts
    .filter((c) => c.access?.blocked === true)
    .map((c) => c.tenantId)
    .sort()
    .join(",");
