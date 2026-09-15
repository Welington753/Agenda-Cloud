// Cliente tipado das rotas reais de profissionais (Lote 6D.2) — espelha
// backend/src/professionals/professionals.controller.ts e
// professional.dto.ts. Nenhum campo inventado: são exatamente as colunas de
// `professionals` (menos `unitId`, fora de escopo nesta fase) mais os
// vínculos de `professional_services`.
//
// Reutiliza `apiRequest` (http-client.ts) — mesma disciplina de
// services-api.ts, nenhuma infraestrutura de autenticação duplicada. O
// `tenantId` vai na URL porque o cliente precisa DIZER em qual
// estabelecimento está operando; a Membership é reconsultada a cada
// requisição no servidor.
import { apiRequest } from "./http-client";

export interface VinculoServicoReal {
  id: string;
  serviceId: string;
  serviceName: string;
  /** Ativo é do SERVIÇO, não do vínculo — um vínculo existente com serviço
   * desativado continua aqui, só marcado. */
  serviceActive: boolean;
}

export interface ProfissionalReal {
  id: string;
  name: string;
  avatarInitials: string;
  avatarColor: string;
  active: boolean;
  createdAt: string;
  services: VinculoServicoReal[];
}

export interface DadosProfissionalReal {
  name: string;
  /** Serviços vinculados na criação — opcional, cadastro sem serviço nenhum
   * é permitido. */
  serviceIds: string[];
}

export interface DadosEdicaoProfissionalReal {
  name: string;
}

/** Conjunto FINAL desejado de serviços vinculados — o servidor calcula o
 * diff contra o que já existe (adições validadas, remoções sempre aceitas). */
export interface DadosVinculosReal {
  serviceIds: string[];
}

export type FalhaProfissionaisReal =
  | { tipo: "nao_autenticado" }
  | { tipo: "sem_acesso" }
  | { tipo: "sem_permissao" }
  | { tipo: "dados_invalidos"; mensagem: string | null }
  /** Corrida concorrente vinculando o mesmo serviço ao mesmo tempo — a
   * constraint única do banco recusou (ver professionals.service.ts). */
  | { tipo: "conflito" }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoProfissionaisReal<T> =
  | { ok: true; dados: T }
  | { ok: false; falha: FalhaProfissionaisReal };

function ehVinculoServico(valor: unknown): valor is VinculoServicoReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.serviceId === "string" &&
    typeof v.serviceName === "string" &&
    typeof v.serviceActive === "boolean"
  );
}

function ehProfissionalReal(valor: unknown): valor is ProfissionalReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.avatarInitials === "string" &&
    typeof v.avatarColor === "string" &&
    typeof v.active === "boolean" &&
    Array.isArray(v.services) &&
    v.services.every(ehVinculoServico)
  );
}

function mensagemDeErroDoBackend(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const mensagem = (data as Record<string, unknown>).message;
  return typeof mensagem === "string" ? mensagem : null;
}

function falhaPorStatus(status: number, data: unknown): FalhaProfissionaisReal {
  if (status === 401) return { tipo: "nao_autenticado" };
  if (status === 403) return { tipo: "sem_permissao" };
  if (status === 404) return { tipo: "sem_acesso" };
  if (status === 409) return { tipo: "conflito" };
  if (status === 400) return { tipo: "dados_invalidos", mensagem: mensagemDeErroDoBackend(data) };
  return { tipo: "indisponivel" };
}

function caminhoBase(tenantId: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/professionals`;
}

export async function listarProfissionais(
  tenantId: string,
  signal?: AbortSignal,
): Promise<ResultadoProfissionaisReal<ProfissionalReal[]>> {
  const resultado = await apiRequest<unknown>(caminhoBase(tenantId), { method: "GET", signal });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { professionals?: unknown };
  if (!Array.isArray(corpo?.professionals) || !corpo.professionals.every(ehProfissionalReal)) {
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  return { ok: true, dados: corpo.professionals };
}

async function enviarProfissional(
  caminho: string,
  method: "POST" | "PATCH" | "PUT",
  body: unknown,
  signal?: AbortSignal,
): Promise<ResultadoProfissionaisReal<ProfissionalReal>> {
  const resultado = await apiRequest<unknown>(caminho, { method, body, signal });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { professional?: unknown };
  if (!ehProfissionalReal(corpo?.professional)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: corpo.professional };
}

export function criarProfissional(
  tenantId: string,
  dados: DadosProfissionalReal,
  signal?: AbortSignal,
): Promise<ResultadoProfissionaisReal<ProfissionalReal>> {
  return enviarProfissional(caminhoBase(tenantId), "POST", dados, signal);
}

export function editarProfissional(
  tenantId: string,
  professionalId: string,
  dados: DadosEdicaoProfissionalReal,
  signal?: AbortSignal,
): Promise<ResultadoProfissionaisReal<ProfissionalReal>> {
  return enviarProfissional(
    `${caminhoBase(tenantId)}/${encodeURIComponent(professionalId)}`,
    "PATCH",
    dados,
    signal,
  );
}

/** Desativação — nunca exclusão. O registro e seus vínculos de serviço
 * continuam no banco, só `active` do profissional muda. */
export function desativarProfissional(
  tenantId: string,
  professionalId: string,
  signal?: AbortSignal,
): Promise<ResultadoProfissionaisReal<ProfissionalReal>> {
  return enviarProfissional(
    `${caminhoBase(tenantId)}/${encodeURIComponent(professionalId)}/deactivate`,
    "POST",
    undefined,
    signal,
  );
}

/** Reativação — espelho de `desativarProfissional`. */
export function reativarProfissional(
  tenantId: string,
  professionalId: string,
  signal?: AbortSignal,
): Promise<ResultadoProfissionaisReal<ProfissionalReal>> {
  return enviarProfissional(
    `${caminhoBase(tenantId)}/${encodeURIComponent(professionalId)}/reactivate`,
    "POST",
    undefined,
    signal,
  );
}

/** Define o conjunto final de serviços vinculados — o servidor calcula o
 * diff contra o que já existe (ver professionals.service.ts, `setServices`). */
export function definirServicosDoProfissional(
  tenantId: string,
  professionalId: string,
  dados: DadosVinculosReal,
  signal?: AbortSignal,
): Promise<ResultadoProfissionaisReal<ProfissionalReal>> {
  return enviarProfissional(
    `${caminhoBase(tenantId)}/${encodeURIComponent(professionalId)}/services`,
    "PUT",
    dados,
    signal,
  );
}
