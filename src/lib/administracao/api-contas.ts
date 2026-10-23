// Ações da gestão de contas (tudo que ESCREVE). Cada resposta vira um
// resultado explícito, sem exceção solta:
//
// - `reautenticar`: o servidor pediu a senha de novo (mudança sensível);
// - `conflito`: outra tela mudou antes, já existe convite, limite etc.;
// - `rede`: a resposta não chegou. Para criação, a tela consulta o resultado
//   pela chave do formulário ANTES de oferecer outra tentativa: o pedido
//   pode ter sido gravado.
import { apiRequest } from "@/lib/api/http-client";

export type ResultadoAcao<T> =
  | { tipo: "ok"; dados: T }
  | { tipo: "reautenticar" }
  | { tipo: "conflito"; codigo: string | null; mensagem: string; dados: unknown }
  | { tipo: "proibido"; mensagem: string }
  | { tipo: "invalido"; mensagem: string }
  | { tipo: "nao-encontrado"; mensagem: string }
  | { tipo: "sessao" }
  | { tipo: "limite" }
  | { tipo: "rede" }
  | { tipo: "erro"; mensagem: string };

const REAUTENTICACAO = "REAUTENTICACAO_NECESSARIA";

function mensagemDe(dados: unknown, padrao: string): string {
  if (typeof dados === "object" && dados !== null && "message" in dados) {
    const m = (dados as { message: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return padrao;
}

function codigoDe(dados: unknown): string | null {
  if (typeof dados === "object" && dados !== null && "code" in dados) {
    const c = (dados as { code: unknown }).code;
    return typeof c === "string" ? c : null;
  }
  return null;
}

export async function acaoAdministrativa<T>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<ResultadoAcao<T>> {
  const r = await apiRequest<T>(path, { method, body });
  if (r.kind === "network-error") return { tipo: "rede" };
  if (r.kind === "success") return { tipo: "ok", dados: r.data };
  const codigo = codigoDe(r.data);
  if (r.status === 401) return { tipo: "sessao" };
  if (r.status === 403 && codigo === REAUTENTICACAO) return { tipo: "reautenticar" };
  if (r.status === 403) return { tipo: "proibido", mensagem: mensagemDe(r.data, "Sua conta não tem permissão para esta ação.") };
  if (r.status === 404) return { tipo: "nao-encontrado", mensagem: mensagemDe(r.data, "Registro não encontrado.") };
  if (r.status === 409 || r.status === 410) {
    return { tipo: "conflito", codigo, mensagem: mensagemDe(r.data, "A operação não pôde ser feita agora."), dados: r.data };
  }
  if (r.status === 400) return { tipo: "invalido", mensagem: "Confira os campos: algum valor não foi aceito." };
  if (r.status === 429) return { tipo: "limite" };
  return { tipo: "erro", mensagem: "O servidor não conseguiu concluir a operação." };
}

/** Confirma a senha de quem está na sessão (vale 10 minutos nesta sessão). */
export async function confirmarSenha(senha: string): Promise<"ok" | "senha-incorreta" | "limite" | "rede" | "erro"> {
  const r = await apiRequest<null>("/platform/reauth", { method: "POST", body: { password: senha } });
  if (r.kind === "network-error") return "rede";
  if (r.kind === "success") return "ok";
  if (r.status === 401) return "senha-incorreta";
  if (r.status === 429) return "limite";
  return "erro";
}

/** Chave de idempotência de UM formulário aberto: repetir o envio com a
 * mesma chave nunca cria outro registro. */
export function novaChaveDeFormulario(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** Mensagem curta para cada resultado que não é "ok". */
export function mensagemDoResultado(resultado: Exclude<ResultadoAcao<unknown>, { tipo: "ok" }>): string {
  switch (resultado.tipo) {
    case "reautenticar":
      return "Confirme sua senha para continuar.";
    case "sessao":
      return "Sua sessão terminou. Entre de novo.";
    case "limite":
      return "Muitas tentativas seguidas. Aguarde alguns minutos.";
    case "rede":
      return "Não foi possível confirmar com o servidor. Confira o resultado antes de tentar de novo.";
    default:
      return resultado.mensagem;
  }
}
