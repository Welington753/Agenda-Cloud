// Cliente tipado da tela de Clientes (`/conta/clientes`) — espelha
// backend/src/consumers/consumers.controller.ts e consumer.dto.ts: BUSCA por
// termo (mínimo 2 caracteres, no máximo 20 linhas, usada no seletor da
// Agenda), LISTAGEM paginada, LISTA AGRUPADA por telefone, CADASTRO (com
// chave de pedido e "outra pessoa" no mesmo telefone), FICHA, HISTÓRICO,
// EDIÇÃO, PRÉVIA e UNIFICAÇÃO (só o dono). Sem exclusão.
//
// Cada recusa que a tela distingue vem pelo `code` do corpo, nunca pelo
// texto de `message`.
//
// O formato do cliente (`ClienteReal`) é o mesmo que o seletor da Agenda já
// usa (appointments-api.ts) — um cliente cadastrado aqui aparece lá sem
// conversão nenhuma.
import { apiRequest, mensagemDoBackend } from "./http-client";
import type { ClienteReal } from "./appointments-api";
import {
  ehCliente,
  ehFicha,
  ehGrupo,
  ehItemDoHistorico,
  ehPrevia,
  ehResultadoDaUnificacao,
  inteiro,
  objeto,
  texto,
  textoOuNulo,
  type GrupoDeClientes,
  type ItemDoHistorico,
  type PreviaDaUnificacao,
} from "./consumers-formatos";

export type {
  AtendimentoResumido,
  FichaDoCliente,
  GrupoDeClientes,
  ItemDoHistorico,
  MembroDoGrupo,
  OutroCadastro,
  PreviaDaUnificacao,
  RelacaoEntreCadastros,
  ResultadoDaUnificacao,
  ResumoDaTransferencia,
} from "./consumers-formatos";

export type { ClienteReal };

/** Teto da busca no backend (`LIMITE_DE_BUSCA` em consumers.service.ts): uma
 * resposta com este número de linhas pode ter deixado clientes de fora. */
export const LIMITE_BUSCA_CLIENTES = 20;
/** Espelha `z.string().trim().min(2)` de `consumerSearchSchema`. */
export const TERMO_MINIMO_BUSCA = 2;

export interface DadosCadastroCliente {
  name: string;
  whatsapp: string;
  email?: string;
  /** Chave do formulário aberto: o reenvio devolve o mesmo cadastro. */
  requestKey?: string;
  /** Outra pessoa num telefone que já tem cadastro (exige `requestKey`). */
  outraPessoa?: true;
}

export type FalhaClientesReal =
  | { tipo: "nao_autenticado" }
  /** 404: o estabelecimento não existe OU não há vínculo — indistinguíveis. */
  | { tipo: "sem_acesso" }
  | { tipo: "sem_permissao" }
  | { tipo: "dados_invalidos"; mensagem: string | null }
  /** 409: já existe cliente com este WhatsApp neste estabelecimento. Nada foi
   * sobrescrito. `cadastros`: os que usam o telefone (API com telefone
   * compartilhado). */
  | { tipo: "duplicado"; mensagem: string | null; cadastros?: ClienteReal[] }
  /** 409: este formulário já foi usado com outros dados. */
  | { tipo: "chave_reutilizada"; mensagem: string | null }
  /** 409: o cadastro virou lápide; `principalId` ficou com o histórico. */
  | { tipo: "cliente_unificado"; mensagem: string | null; principalId: string | null }
  /** 409: outra pessoa salvou o cadastro depois da leitura. */
  | { tipo: "cliente_alterado"; mensagem: string | null }
  /** 409: o conteúdo mudou desde a prévia; nada foi transferido. */
  | { tipo: "previa_desatualizada"; mensagem: string | null; previa: PreviaDaUnificacao | null }
  /** Outro 409 com explicação do servidor (ex.: par não sugerido). */
  | { tipo: "conflito"; mensagem: string | null }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoClientesReal<T> =
  | { ok: true; dados: T }
  | { ok: false; falha: FalhaClientesReal };

function codigoDe(data: unknown): string | null {
  const code = (data as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

function conflitoPorCodigo(data: unknown): FalhaClientesReal {
  const mensagem = mensagemDoBackend(data);
  const corpo = (data ?? {}) as { consumers?: unknown; principalId?: unknown; previa?: unknown };
  switch (codigoDe(data)) {
    case null:
    case "TELEFONE_EM_USO":
      return Array.isArray(corpo.consumers) && corpo.consumers.every(ehCliente)
        ? { tipo: "duplicado", mensagem, cadastros: corpo.consumers }
        : { tipo: "duplicado", mensagem };
    case "CHAVE_REUTILIZADA":
      return { tipo: "chave_reutilizada", mensagem };
    case "CLIENTE_UNIFICADO":
      return { tipo: "cliente_unificado", mensagem, principalId: typeof corpo.principalId === "string" ? corpo.principalId : null };
    case "CLIENTE_ALTERADO":
      return { tipo: "cliente_alterado", mensagem };
    case "PREVIA_DESATUALIZADA":
      return { tipo: "previa_desatualizada", mensagem, previa: ehPrevia(corpo.previa) ? corpo.previa : null };
    default:
      return { tipo: "conflito", mensagem };
  }
}

function falhaPorStatus(status: number, data: unknown): FalhaClientesReal {
  if (status === 401) return { tipo: "nao_autenticado" };
  if (status === 403) return { tipo: "sem_permissao" };
  if (status === 404) return { tipo: "sem_acesso" };
  if (status === 409) return conflitoPorCodigo(data);
  if (status === 400) return { tipo: "dados_invalidos", mensagem: mensagemDoBackend(data) };
  return { tipo: "indisponivel" };
}


const caminhoClientes = (tenantId: string) =>
  `/tenants/${encodeURIComponent(tenantId)}/consumers`;

export async function pesquisarClientes(
  tenantId: string,
  termo: string,
  signal?: AbortSignal,
): Promise<ResultadoClientesReal<ClienteReal[]>> {
  const resultado = await apiRequest<unknown>(
    `${caminhoClientes(tenantId)}?q=${encodeURIComponent(termo)}`,
    { method: "GET", signal },
  );

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { consumers?: unknown };
  if (!Array.isArray(corpo?.consumers) || !corpo.consumers.every(ehCliente)) {
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  return { ok: true, dados: corpo.consumers };
}

/** Sem `signal` de propósito: um cadastro já enviado não é abortado pela
 * tela — abortar só esconderia se ele foi gravado ou não. */
export async function cadastrarCliente(
  tenantId: string,
  dados: DadosCadastroCliente,
): Promise<ResultadoClientesReal<ClienteReal>> {
  const resultado = await apiRequest<unknown>(caminhoClientes(tenantId), {
    method: "POST",
    body: dados,
  });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { consumer?: unknown };
  if (!ehCliente(corpo?.consumer)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: corpo.consumer };
}

/** Uma página da listagem de Clientes (`GET .../consumers/page`). `total`
 * conta todos os que passam no filtro, no servidor. */
export interface PaginaDeClientes {
  clientes: ClienteReal[];
  proximoCursor: string | null;
  total: number;
}

/** Espelha o padrão de `consumerPageSchema` no backend. */
export const TAMANHO_PAGINA_CLIENTES = 20;

export async function listarPaginaDeClientes(
  tenantId: string,
  opcoes: { termo?: string; cursor?: string | null },
  signal?: AbortSignal,
): Promise<ResultadoClientesReal<PaginaDeClientes>> {
  const busca = new URLSearchParams({ limit: String(TAMANHO_PAGINA_CLIENTES) });
  const termo = opcoes.termo?.trim();
  if (termo && termo.length >= TERMO_MINIMO_BUSCA) busca.set("q", termo);
  if (opcoes.cursor) busca.set("cursor", opcoes.cursor);
  const resultado = await apiRequest<unknown>(`${caminhoClientes(tenantId)}/page?${busca.toString()}`, {
    method: "GET",
    signal,
  });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { consumers?: unknown; nextCursor?: unknown; total?: unknown };
  if (
    !Array.isArray(corpo?.consumers) ||
    !corpo.consumers.every(ehCliente) ||
    !(corpo.nextCursor === null || typeof corpo.nextCursor === "string") ||
    typeof corpo.total !== "number"
  ) {
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  return { ok: true, dados: { clientes: corpo.consumers, proximoCursor: corpo.nextCursor, total: corpo.total } };
}

/** Resultado de uma chamada: a forma validada, ou a falha classificada. */
async function chamar<T>(
  caminho: string,
  init: Parameters<typeof apiRequest>[1],
  valida: (corpo: unknown) => corpo is T,
): Promise<ResultadoClientesReal<T>> {
  const resultado = await apiRequest<unknown>(caminho, init);
  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  return valida(resultado.data) ? { ok: true, dados: resultado.data } : { ok: false, falha: { tipo: "indisponivel" } };
}

// ---------------------------------------------------------------- lista agrupada

export interface PaginaDeGrupos {
  grupos: GrupoDeClientes[];
  proximoCursor: string | null;
  total: number;
}

/** Lista agrupada por telefone (`GET .../consumers/groups`). A busca casa
 * qualquer membro e devolve o grupo inteiro. Nenhum total somado. */
export async function listarGruposDeClientes(
  tenantId: string,
  opcoes: { termo?: string; cursor?: string | null },
  signal?: AbortSignal,
): Promise<ResultadoClientesReal<PaginaDeGrupos>> {
  const busca = new URLSearchParams({ limit: String(TAMANHO_PAGINA_CLIENTES) });
  const termo = opcoes.termo?.trim();
  if (termo && termo.length >= TERMO_MINIMO_BUSCA) busca.set("q", termo);
  if (opcoes.cursor) busca.set("cursor", opcoes.cursor);
  const resultado = await chamar(
    `${caminhoClientes(tenantId)}/groups?${busca.toString()}`,
    { method: "GET", signal },
    (corpo): corpo is { groups: GrupoDeClientes[]; nextCursor: string | null; total: number } =>
      objeto(corpo) &&
      Array.isArray(corpo.groups) &&
      corpo.groups.every(ehGrupo) &&
      textoOuNulo(corpo.nextCursor) &&
      inteiro(corpo.total),
  );
  if (!resultado.ok) return resultado;
  return {
    ok: true,
    dados: { grupos: resultado.dados.groups, proximoCursor: resultado.dados.nextCursor, total: resultado.dados.total },
  };
}

// ---------------------------------------------------------------- ficha e histórico

const caminhoDoCliente = (tenantId: string, id: string) => `${caminhoClientes(tenantId)}/${encodeURIComponent(id)}`;

export function lerFichaDoCliente(tenantId: string, id: string, signal?: AbortSignal) {
  return chamar(caminhoDoCliente(tenantId, id), { method: "GET", signal }, ehFicha);
}

export interface PaginaDoHistorico {
  itens: ItemDoHistorico[];
  proximoCursor: string | null;
}

export const TAMANHO_PAGINA_HISTORICO = 20;

export async function lerHistoricoDoCliente(
  tenantId: string,
  id: string,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ResultadoClientesReal<PaginaDoHistorico>> {
  const busca = new URLSearchParams({ limit: String(TAMANHO_PAGINA_HISTORICO) });
  if (cursor) busca.set("cursor", cursor);
  const resultado = await chamar(
    `${caminhoDoCliente(tenantId, id)}/appointments?${busca.toString()}`,
    { method: "GET", signal },
    (corpo): corpo is { appointments: ItemDoHistorico[]; nextCursor: string | null } =>
      objeto(corpo) && Array.isArray(corpo.appointments) && corpo.appointments.every(ehItemDoHistorico) && textoOuNulo(corpo.nextCursor),
  );
  if (!resultado.ok) return resultado;
  return { ok: true, dados: { itens: resultado.dados.appointments, proximoCursor: resultado.dados.nextCursor } };
}

// ---------------------------------------------------------------- edição

export interface EdicaoDoCliente {
  name?: string;
  whatsapp?: string;
  /** Vazio apaga o e-mail. */
  email?: string;
  /** `updatedAt` lido na ficha. */
  expectedUpdatedAt: string;
  outraPessoa?: true;
}

/** Sem `signal`: uma edição enviada não é abortada pela tela. */
export async function editarCliente(
  tenantId: string,
  id: string,
  dados: EdicaoDoCliente,
): Promise<ResultadoClientesReal<ClienteReal & { updatedAt: string }>> {
  const resultado = await chamar(
    caminhoDoCliente(tenantId, id),
    { method: "PATCH", body: dados },
    (corpo): corpo is { consumer: ClienteReal & { updatedAt: string } } =>
      objeto(corpo) && ehCliente(corpo.consumer) && texto((corpo.consumer as unknown as Record<string, unknown>).updatedAt),
  );
  return resultado.ok ? { ok: true, dados: resultado.dados.consumer } : resultado;
}

// ---------------------------------------------------------------- unificação

/** Prévia, só leitura: o cadastro do caminho é o secundário (vira lápide). */
export function lerPreviaDaUnificacao(tenantId: string, secundarioId: string, principalId: string, signal?: AbortSignal) {
  return chamar(
    `${caminhoDoCliente(tenantId, secundarioId)}/merge-preview?${new URLSearchParams({ principalId }).toString()}`,
    { method: "GET", signal },
    ehPrevia,
  );
}

/** Unificação confirmada com a versão revisada. Sem `signal` e nunca
 * reenviada sozinha: o reenvio pela pessoa é seguro (o servidor devolve o
 * que já gravou). */
export function unificarClientes(tenantId: string, secundarioId: string, dados: { principalId: string; versaoDaPrevia: string }) {
  return chamar(`${caminhoDoCliente(tenantId, secundarioId)}/merge`, { method: "POST", body: dados }, ehResultadoDaUnificacao);
}

/** Chave de um formulário de cadastro aberto (o reenvio com a mesma chave
 * devolve o mesmo cadastro). */
export function novaChaveDeCadastro(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
