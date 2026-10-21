// Regras puras da tela de Clientes — validação do formulário e mensagens de
// falha, sem React, para serem testadas sem montar componente.
//
// A validação aqui só ANTECIPA o que o backend recusaria (consumer.dto.ts):
// a autoridade continua sendo o servidor. Os campos são exatamente os do DTO
// — nome, WhatsApp e e-mail opcional — nenhum inventado.
import type { DadosCadastroCliente, FalhaClientesReal } from "@/lib/api/consumers-api";
import { contarDigitos } from "@/lib/auth/cadastro-validacao";

/** Espelha `name: z.string().trim().min(1).max(120)`. */
const NOME_MAX = 120;
/** Espelha `whatsapp: max(30)` e `normalizePhone` (10 a 13 dígitos). */
const WHATSAPP_MAX = 30;
const TELEFONE_MIN_DIGITOS = 10;
const TELEFONE_MAX_DIGITOS = 13;
/** Espelha `email: z.string().trim().max(160).email()`. */
const EMAIL_MAX = 160;
// Permissiva de propósito (algo@algo.tld), mesma de cadastro-validacao.ts.
const EMAIL_FORMATO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FormularioCliente {
  nome: string;
  whatsapp: string;
  email: string;
}

export type ErrosCliente = Partial<Record<keyof FormularioCliente, string>>;

export function validarCliente(formulario: FormularioCliente): ErrosCliente {
  const erros: ErrosCliente = {};

  const nome = formulario.nome.trim();
  if (nome.length === 0) erros.nome = "Informe o nome do cliente.";
  else if (nome.length > NOME_MAX) erros.nome = `O nome pode ter no máximo ${NOME_MAX} caracteres.`;

  const whatsapp = formulario.whatsapp.trim();
  const digitos = contarDigitos(whatsapp);
  if (whatsapp.length === 0) erros.whatsapp = "Informe o WhatsApp do cliente.";
  else if (
    whatsapp.length > WHATSAPP_MAX ||
    digitos < TELEFONE_MIN_DIGITOS ||
    digitos > TELEFONE_MAX_DIGITOS
  ) {
    erros.whatsapp = "Informe um telefone válido com DDD.";
  }

  const email = formulario.email.trim();
  if (email.length > EMAIL_MAX) erros.email = `O e-mail pode ter no máximo ${EMAIL_MAX} caracteres.`;
  else if (email.length > 0 && !EMAIL_FORMATO.test(email)) erros.email = "Informe um e-mail válido.";

  return erros;
}

/** Corpo do POST: só campos do DTO; e-mail vazio não é enviado. */
export function paraDadosCliente(formulario: FormularioCliente): DadosCadastroCliente {
  const email = formulario.email.trim();
  return {
    name: formulario.nome.trim(),
    whatsapp: formulario.whatsapp.trim(),
    ...(email ? { email } : {}),
  };
}

export function mensagemFalhaBusca(falha: FalhaClientesReal): string {
  switch (falha.tipo) {
    case "nao_autenticado":
      return "Sua sessão expirou. Entre novamente para continuar.";
    case "sem_acesso":
      return "Você não tem acesso a este estabelecimento.";
    case "sem_permissao":
      return "Você não tem permissão para ver os clientes deste estabelecimento.";
    case "falha_comunicacao":
      return "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.";
    case "dados_invalidos":
      return falha.mensagem ?? "A busca não foi aceita. Revise o termo e tente de novo.";
    default:
      return "Não foi possível buscar agora. Tente novamente em instantes.";
  }
}

export function mensagemFalhaCadastro(falha: FalhaClientesReal): string {
  switch (falha.tipo) {
    case "duplicado":
      return (
        falha.mensagem ??
        "Já existe um cliente com este WhatsApp neste estabelecimento. Busque por ele em vez de cadastrar de novo."
      );
    case "sem_permissao":
      return "Você não tem permissão para cadastrar clientes neste estabelecimento.";
    case "dados_invalidos":
      return falha.mensagem ?? "Alguns dados não foram aceitos. Revise os campos e tente novamente.";
    // Resultado INCERTO: a requisição pode ter sido gravada. Nunca afirma que
    // não foi — orienta a pesquisar antes de repetir.
    case "falha_comunicacao":
      return (
        "A conexão caiu antes de o servidor confirmar. O cliente pode ter sido cadastrado: " +
        "pesquise pelo nome ou WhatsApp antes de tentar de novo."
      );
    default:
      return mensagemFalhaBusca(falha);
  }
}
