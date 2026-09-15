// Cliente tipado das rotas reais de serviços (Lote 6D.1) — espelha
// `backend/src/services/services.controller.ts` e `service.dto.ts`. Nenhum
// campo inventado: são exatamente as colunas de `services`.
//
// Reutiliza `apiRequest` (http-client.ts), que já envia o cookie de sessão com
// `credentials: "include"` e nunca usa cache compartilhado — nenhuma
// infraestrutura de autenticação é duplicada aqui.
//
// O `tenantId` vai na URL porque o cliente precisa DIZER em qual
// estabelecimento está operando. Isso nunca é autorização: quem decide é a
// Membership que o backend reconsulta a cada requisição. A preferência salva
// no localStorage só escolhe qual tenant pedir.
import { apiRequest } from "./http-client";

export type ModalidadeServicoReal = "IN_PERSON" | "REMOTE" | "HOME";

export interface ServicoReal {
  id: string;
  name: string;
  shortDescription: string;
  /** SEMPRE centavos inteiros — a unidade da coluna `price_cents`. `null` é o
   * valor de domínio "sob consulta", diferente de zero. Nunca converter para
   * decimal fora da camada de exibição. */
  priceCents: number | null;
  priceVisible: boolean;
  durationMinutes: number;
  bufferAfterMinutes: number;
  modality: ModalidadeServicoReal;
  activeInPublicBooking: boolean;
  requiresManualConfirmation: boolean;
  active: boolean;
  createdAt: string;
}

export interface DadosServicoReal {
  name: string;
  shortDescription: string;
  priceCents: number | null;
  priceVisible: boolean;
  durationMinutes: number;
  bufferAfterMinutes: number;
  modality: ModalidadeServicoReal;
  activeInPublicBooking: boolean;
  requiresManualConfirmation: boolean;
}

export type FalhaServicosReal =
  | { tipo: "nao_autenticado" }
  /** 404 do backend: o estabelecimento não existe OU não há vínculo. Os dois
   * são deliberadamente indistinguíveis (nunca confirmam a existência de um
   * estabelecimento de terceiros). */
  | { tipo: "sem_acesso" }
  | { tipo: "sem_permissao" }
  | { tipo: "dados_invalidos"; mensagem: string | null }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoServicosReal<T> = { ok: true; dados: T } | { ok: false; falha: FalhaServicosReal };

function ehServicoReal(valor: unknown): valor is ServicoReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.durationMinutes === "number" &&
    typeof v.active === "boolean"
  );
}

function mensagemDeErroDoBackend(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const mensagem = (data as Record<string, unknown>).message;
  return typeof mensagem === "string" ? mensagem : null;
}

/** Mapeamento único de status HTTP para falha de domínio — todas as chamadas
 * deste módulo passam por aqui, para nunca divergirem. */
function falhaPorStatus(status: number, data: unknown): FalhaServicosReal {
  if (status === 401) return { tipo: "nao_autenticado" };
  if (status === 403) return { tipo: "sem_permissao" };
  if (status === 404) return { tipo: "sem_acesso" };
  if (status === 400) return { tipo: "dados_invalidos", mensagem: mensagemDeErroDoBackend(data) };
  return { tipo: "indisponivel" };
}

function caminhoBase(tenantId: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/services`;
}

/** Todas as chamadas aceitam um `AbortSignal`: ao trocar de estabelecimento a
 * tela aborta o que estava em voo, para uma resposta atrasada do tenant
 * anterior nunca alcançar a UI (ver use-servicos-reais.ts). */
export async function listarServicos(
  tenantId: string,
  signal?: AbortSignal,
): Promise<ResultadoServicosReal<ServicoReal[]>> {
  const resultado = await apiRequest<unknown>(caminhoBase(tenantId), { method: "GET", signal });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { services?: unknown };
  if (!Array.isArray(corpo?.services) || !corpo.services.every(ehServicoReal)) {
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  return { ok: true, dados: corpo.services };
}

async function enviarServico(
  caminho: string,
  method: "POST" | "PATCH",
  body: unknown,
  signal?: AbortSignal,
): Promise<ResultadoServicosReal<ServicoReal>> {
  const resultado = await apiRequest<unknown>(caminho, { method, body, signal });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { service?: unknown };
  if (!ehServicoReal(corpo?.service)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: corpo.service };
}

export function criarServico(
  tenantId: string,
  dados: DadosServicoReal,
  signal?: AbortSignal,
): Promise<ResultadoServicosReal<ServicoReal>> {
  return enviarServico(caminhoBase(tenantId), "POST", dados, signal);
}

export function editarServico(
  tenantId: string,
  serviceId: string,
  dados: Partial<DadosServicoReal>,
  signal?: AbortSignal,
): Promise<ResultadoServicosReal<ServicoReal>> {
  return enviarServico(
    `${caminhoBase(tenantId)}/${encodeURIComponent(serviceId)}`,
    "PATCH",
    dados,
    signal,
  );
}

/** Desativação — nunca exclusão. O registro continua no banco, só `active`
 * muda (ver services.service.ts). */
export function desativarServico(
  tenantId: string,
  serviceId: string,
  signal?: AbortSignal,
): Promise<ResultadoServicosReal<ServicoReal>> {
  return enviarServico(
    `${caminhoBase(tenantId)}/${encodeURIComponent(serviceId)}/deactivate`,
    "POST",
    undefined,
    signal,
  );
}
