// Validação de formulário do cadastro REAL (Lote 6C.2) — espelho fiel de
// `backend/src/auth/register.dto.ts` e `backend/src/auth/phone-normalizer.ts`.
// Nenhuma regra inventada aqui: nada de exigir símbolo/maiúscula na senha,
// nada de confirmar e-mail/telefone, nada de campo que o contrato não pede.
// O backend continua sendo a autoridade — isto só evita uma ida à rede para
// um erro que já dá para apontar no campo certo, e nunca aceita algo que o
// backend recusaria.
//
// Módulo puro (sem React, sem `window`), mesma disciplina de
// `real-session-state.ts`.
import type { DadosCadastroReal } from "@/lib/api/auth-api";

export interface FormularioCadastro {
  ownerName: string;
  businessName: string;
  email: string;
  phone: string;
  password: string;
}

export type CampoCadastro = keyof FormularioCadastro;

export type ErrosCadastro = Partial<Record<CampoCadastro, string>>;

/** Espelha `z.string().trim().min(2).max(120)` do DTO. */
const NOME_MIN = 2;
const NOME_MAX = 120;
/** Espelha `z.string().trim().toLowerCase().email().max(254)` do DTO. */
const EMAIL_MAX = 254;
/** Espelha `normalizePhone`: 10 a 13 dígitos, ignorando formatação. */
const TELEFONE_MIN_DIGITOS = 10;
const TELEFONE_MAX_DIGITOS = 13;
/** Espelha `z.string().min(10).max(128)` do DTO — comprimento, nada além. */
export const SENHA_MIN = 10;
export const SENHA_MAX = 128;

// Checagem deliberadamente permissiva (algo@algo.tld): a autoridade é o
// backend. Um regex mais estrito aqui só arriscaria rejeitar um e-mail que o
// servidor aceitaria.
const EMAIL_FORMATO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contarDigitos(valor: string): number {
  return valor.replace(/\D/g, "").length;
}

function validarNome(valor: string, rotulo: string): string | null {
  const limpo = valor.trim();
  if (limpo.length === 0) return `Informe ${rotulo}.`;
  if (limpo.length < NOME_MIN) return `${capitalizar(rotulo)} precisa ter pelo menos ${NOME_MIN} caracteres.`;
  if (limpo.length > NOME_MAX) return `${capitalizar(rotulo)} pode ter no máximo ${NOME_MAX} caracteres.`;
  return null;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function validarCadastro(formulario: FormularioCadastro): ErrosCadastro {
  const erros: ErrosCadastro = {};

  const erroNome = validarNome(formulario.ownerName, "seu nome");
  if (erroNome) erros.ownerName = erroNome;

  const erroNegocio = validarNome(formulario.businessName, "o nome do estabelecimento");
  if (erroNegocio) erros.businessName = erroNegocio;

  const email = formulario.email.trim();
  if (email.length === 0) erros.email = "Informe seu e-mail.";
  else if (email.length > EMAIL_MAX) erros.email = `O e-mail pode ter no máximo ${EMAIL_MAX} caracteres.`;
  else if (!EMAIL_FORMATO.test(email)) erros.email = "Informe um e-mail válido.";

  const digitos = contarDigitos(formulario.phone);
  if (formulario.phone.trim().length === 0) erros.phone = "Informe seu telefone.";
  else if (digitos < TELEFONE_MIN_DIGITOS || digitos > TELEFONE_MAX_DIGITOS) {
    erros.phone = `Informe um telefone com DDD, entre ${TELEFONE_MIN_DIGITOS} e ${TELEFONE_MAX_DIGITOS} dígitos.`;
  }

  if (formulario.password.length === 0) erros.password = "Informe uma senha.";
  else if (formulario.password.length < SENHA_MIN) {
    erros.password = `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
  } else if (formulario.password.length > SENHA_MAX) {
    erros.password = `A senha pode ter no máximo ${SENHA_MAX} caracteres.`;
  }

  return erros;
}

export function formularioEhValido(erros: ErrosCadastro): boolean {
  return Object.keys(erros).length === 0;
}

/** Aplica as mesmas normalizações que o DTO faria (`trim`, `toLowerCase` no
 * e-mail) antes de enviar. A senha NUNCA é normalizada — `trim` nela mudaria
 * silenciosamente a credencial que o usuário digitou. */
export function paraDadosCadastro(formulario: FormularioCadastro): DadosCadastroReal {
  return {
    ownerName: formulario.ownerName.trim(),
    businessName: formulario.businessName.trim(),
    email: formulario.email.trim().toLowerCase(),
    phone: formulario.phone.trim(),
    password: formulario.password,
  };
}
