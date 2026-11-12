// Regras de tela do segundo fator do portal (verificação, cadastro e
// recuperação). Puras: a tela só desenha. O servidor decide o estado; aqui só
// se traduz o que ele devolveu e se prepara o que a pessoa digita ou cola.
import type { AcessoPlataforma, EstadoDoSegundoFator } from "./contratos";
import type { FalhaDoSegundoFator } from "@/lib/api/segundo-fator-api";

/** O que o portão do portal mostra no lugar do conteúdo. */
export type EtapaDoPortao = "conteudo" | "verificar" | "cadastrar" | "sem-acesso";

export function etapaDoPortao(acesso: AcessoPlataforma): EtapaDoPortao {
  const estado: EstadoDoSegundoFator | undefined = acesso.secondFactor?.state;
  if (estado === "VERIFICATION_REQUIRED") return "verificar";
  if (estado === "ENROLLMENT_REQUIRED") return "cadastrar";
  return acesso.canViewEstablishments ? "conteudo" : "sem-acesso";
}

/** Faixa "ative a verificação" no portal (fase opcional, sem fator). */
export function convidarParaAtivar(acesso: AcessoPlataforma): boolean {
  return acesso.canViewEstablishments && acesso.secondFactor?.state === "ENROLLMENT_OPTIONAL";
}

/** Código do aplicativo como a pessoa digitou ou colou: só dígitos, no
 * máximo 6 (espaços, hífens e texto em volta saem). */
export function limparCodigoDoAplicativo(entrada: string): string {
  return entrada.replace(/\D/g, "").slice(0, 6);
}

export const codigoDoAplicativoCompleto = (codigo: string) => /^\d{6}$/.test(codigo);

/** Código de recuperação: maiúsculas, sem espaços; o servidor confere. */
export function limparCodigoDeRecuperacao(entrada: string): string {
  return entrada.toUpperCase().replace(/[^A-Z2-7-]/g, "").slice(0, 19);
}

export function codigoDeRecuperacaoCompleto(codigo: string): boolean {
  return codigo.replace(/-/g, "").length === 16;
}

/** Arquivo de texto dos códigos de recuperação (gerado no navegador). */
export function textoDosCodigos(codigos: string[], email: string | null, agora: Date): string {
  return [
    "TimVix — códigos de recuperação da verificação em duas etapas",
    ...(email ? [`Conta: ${email}`] : []),
    `Gerados em: ${agora.toISOString().slice(0, 10)}`,
    "",
    "Cada código vale UMA vez. Guarde em lugar seguro, longe do celular.",
    "",
    ...codigos,
    "",
  ].join("\n");
}

export function minutos(segundos: number): string {
  const m = Math.max(1, Math.ceil(segundos / 60));
  return m === 1 ? "1 minuto" : `${m} minutos`;
}

/** Mensagem para cada recusa. Nunca repete o código digitado. */
export function mensagemDaFalha(falha: FalhaDoSegundoFator): string {
  switch (falha.tipo) {
    case "codigo-invalido":
      return "Código incorreto ou expirado. Confira o horário do celular e use o código atual.";
    case "bloqueado":
      return `Muitas tentativas erradas. Tente de novo em ${minutos(falha.segundos)}.`;
    case "indisponivel":
      return "A verificação pelo aplicativo está indisponível agora. Use um código de recuperação.";
    case "reautenticar":
      return "Confirme sua senha para continuar.";
    case "codigo-necessario":
      return "Digite um código atual do aplicativo (ou um código de recuperação) para trocar o autenticador.";
    case "liberacao-necessaria":
      return "Para cadastrar, use o link de liberação enviado ao seu e-mail ou o convite da administração.";
    case "verificacao-necessaria":
      return "Confirme o código do aplicativo autenticador para continuar.";
    case "segundo-fator-recente":
      return "Confirme de novo o código do seu aplicativo autenticador para continuar.";
    case "liberacao-invalida":
      return "Link de liberação inválido, já usado ou vencido. Peça um novo à administração.";
    case "cadastro-expirado":
      return "O cadastro expirou. Comece de novo.";
    case "cadastro-inexistente":
      return "Nenhum cadastro em andamento nesta sessão. Comece de novo.";
    case "conflito":
    case "proibido":
      return falha.mensagem;
    case "sessao":
      return "Sua sessão terminou. Entre de novo.";
    case "limite":
      return "Muitas tentativas seguidas deste aparelho. Aguarde alguns minutos.";
    case "rede":
      return "Não foi possível confirmar com o servidor. Tente de novo.";
    default:
      return "Não foi possível concluir agora. Tente de novo em instantes.";
  }
}
