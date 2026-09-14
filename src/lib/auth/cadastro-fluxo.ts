// Lógica pura do fluxo de cadastro REAL (Lote 6C.2) — sem React, sem rede.
// Separa duas coisas que o lote exige nunca confundir:
//
//  1. O POST /auth/register deu certo? (a conta existe, o cookie foi emitido)
//  2. O contexto de sessão foi restaurado por /auth/me? (a UI pode seguir)
//
// Quando (1) deu certo e (2) falhou, o resultado é `sessao_pendente`: a conta
// EXISTE e reenviar o cadastro só produziria um 409. A recuperação é repetir
// só o passo (2), nunca o passo (1) — ver `real-auth-context.tsx`.
import type { FalhaCadastroReal, SessaoRealContexto } from "@/lib/api/auth-api";
import type { EstadoAutenticacaoReal } from "./real-session-state";

export type ResultadoFluxoCadastro =
  /** Nem a conta foi criada de forma confirmada, nem há sessão. */
  | { etapa: "cadastro_falhou"; falha: FalhaCadastroReal }
  /** Conta criada e confirmada pelo backend, mas /auth/me ainda não devolveu
   * o contexto — a UI precisa oferecer "tentar de novo" só do /auth/me. */
  | { etapa: "sessao_pendente" }
  | { etapa: "concluido"; sessao: SessaoRealContexto };

/**
 * `estadoPosSessao === null` cobre o caso em que a resposta de /auth/me foi
 * descartada por ser de uma geração antiga (ver `podeAplicarResultado`) — do
 * ponto de vista de quem cadastrou, é o mesmo que a sessão não ter sido
 * restaurada: nunca um motivo para reenviar o cadastro.
 */
export function decidirFluxoCadastro(
  cadastroOk: boolean,
  falha: FalhaCadastroReal | null,
  estadoPosSessao: EstadoAutenticacaoReal | null,
): ResultadoFluxoCadastro {
  if (!cadastroOk) {
    return { etapa: "cadastro_falhou", falha: falha ?? { tipo: "indisponivel" } };
  }
  if (estadoPosSessao?.status === "autenticado") {
    return { etapa: "concluido", sessao: estadoPosSessao.sessao };
  }
  return { etapa: "sessao_pendente" };
}

/**
 * Mensagem exibida ao usuário para cada falha de cadastro.
 *
 * `falha_comunicacao` é o caso delicado exigido pelo lote: a requisição não
 * teve resposta, então é IMPOSSÍVEL saber se a conta foi criada. A mensagem
 * nunca pode afirmar que não foi — orienta a tentar entrar antes de cadastrar
 * de novo, o que evita tanto uma conta duplicada quanto a impressão falsa de
 * que o cadastro se perdeu.
 */
export function mensagemFalhaCadastro(falha: FalhaCadastroReal): string {
  switch (falha.tipo) {
    case "dados_invalidos":
      return falha.mensagem ?? "Alguns dados não foram aceitos. Revise os campos e tente novamente.";
    case "email_em_uso":
      return "Este e-mail já está cadastrado. Entre com ele ou use outro e-mail.";
    case "limite_tentativas":
      return "Muitas tentativas de cadastro seguidas. Aguarde alguns minutos e tente novamente.";
    case "falha_comunicacao":
      return (
        "A conexão falhou antes de o servidor confirmar o cadastro. " +
        "A conta pode ter sido criada: tente entrar com esse e-mail antes de cadastrar de novo."
      );
    default:
      return "Não foi possível concluir o cadastro agora. Tente novamente em instantes.";
  }
}

/** Mensagem do estado `sessao_pendente` — nunca diz que o cadastro falhou. */
export const MENSAGEM_SESSAO_PENDENTE =
  "Sua conta foi criada, mas não foi possível carregar sua sessão agora. " +
  "Tente recuperar a sessão — não é preciso cadastrar de novo.";
