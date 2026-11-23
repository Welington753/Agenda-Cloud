// Formatos das respostas de clientes (espelham backend/src/consumers) e os
// validadores que o cliente da API usa antes de entregar qualquer dado à
// tela. Separado de consumers-api.ts só pelo tamanho; nenhuma chamada aqui.
import type { ClienteReal } from "./appointments-api";

export function ehCliente(valor: unknown): valor is ClienteReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.whatsapp === "string" &&
    (v.email === null || typeof v.email === "string")
  );
}

export const texto = (v: unknown): v is string => typeof v === "string";
export const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
export const textoOuNulo = (v: unknown): v is string | null => v === null || texto(v);
export const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Relação entre cadastros: só sugestão de revisão, nunca união automática. */
export type RelacaoEntreCadastros = "MESMO_TELEFONE" | "NUMERO_PARECIDO" | "MESMO_NOME";
const RELACOES: readonly string[] = ["MESMO_TELEFONE", "NUMERO_PARECIDO", "MESMO_NOME"];
const ehRelacao = (v: unknown): v is RelacaoEntreCadastros => texto(v) && RELACOES.includes(v);

export interface MembroDoGrupo extends ClienteReal {
  relacoes: Exclude<RelacaoEntreCadastros, "MESMO_NOME">[];
  /** Cadastros com o mesmo nome fora deste grupo ("Mesmo nome — confira"). */
  mesmoNome: number;
}

export interface GrupoDeClientes {
  chave: string;
  membros: MembroDoGrupo[];
}

function ehMembro(v: unknown): v is MembroDoGrupo {
  return (
    ehCliente(v) &&
    Array.isArray((v as unknown as Record<string, unknown>).relacoes) &&
    ((v as unknown as Record<string, unknown>).relacoes as unknown[]).every((r) => r === "MESMO_TELEFONE" || r === "NUMERO_PARECIDO") &&
    inteiro((v as unknown as Record<string, unknown>).mesmoNome)
  );
}

export function ehGrupo(v: unknown): v is GrupoDeClientes {
  return objeto(v) && texto(v.chave) && Array.isArray(v.membros) && v.membros.length > 0 && v.membros.every(ehMembro);
}

export interface AtendimentoResumido {
  id: string;
  startAt: string;
  /** Data (`YYYY-MM-DD`) e hora (`HH:mm`) no fuso do estabelecimento. */
  localDate: string;
  localStart: string;
  status: string;
  professionalName: string;
  services: string[];
}

function ehAtendimento(v: unknown): v is AtendimentoResumido {
  return (
    objeto(v) &&
    texto(v.id) &&
    texto(v.startAt) &&
    texto(v.localDate) &&
    texto(v.localStart) &&
    texto(v.status) &&
    texto(v.professionalName) &&
    Array.isArray(v.services) &&
    v.services.every(texto)
  );
}

export interface OutroCadastro extends ClienteReal {
  relacoes: RelacaoEntreCadastros[];
}

export interface FichaDoCliente {
  consumer: ClienteReal & { updatedAt: string; createdAt: string; telefoneAgrupavel: boolean };
  resumo: {
    total: number;
    concluidos: number;
    cancelados: number;
    faltas: number;
    ultimoConcluido: AtendimentoResumido | null;
    proximo: AtendimentoResumido | null;
  };
  nomesUsados: string[];
  historicoPossivelmenteCompartilhado: boolean;
  outrosCadastros: OutroCadastro[];
}

export function ehFicha(v: unknown): v is FichaDoCliente {
  if (!objeto(v) || !objeto(v.consumer) || !objeto(v.resumo)) return false;
  const c = v.consumer;
  const r = v.resumo;
  return (
    ehCliente(c) &&
    texto(c.updatedAt) &&
    texto(c.createdAt) &&
    typeof c.telefoneAgrupavel === "boolean" &&
    [r.total, r.concluidos, r.cancelados, r.faltas].every(inteiro) &&
    (r.ultimoConcluido === null || ehAtendimento(r.ultimoConcluido)) &&
    (r.proximo === null || ehAtendimento(r.proximo)) &&
    Array.isArray(v.nomesUsados) &&
    v.nomesUsados.every(texto) &&
    typeof v.historicoPossivelmenteCompartilhado === "boolean" &&
    Array.isArray(v.outrosCadastros) &&
    v.outrosCadastros.every((o) => ehCliente(o) && Array.isArray((o as unknown as Record<string, unknown>).relacoes) && ((o as unknown as Record<string, unknown>).relacoes as unknown[]).every(ehRelacao))
  );
}

export interface ItemDoHistorico extends AtendimentoResumido {
  /** `null`: quem pediu não vê dinheiro, ou há item sob consulta. */
  priceCents: number | null;
  /** Ausente para quem não vê recebimentos. */
  payment?: { amountCents: number; method: string; receivedOn: string; refunded: boolean } | null;
  hidden: ("price" | "payment")[];
}

export function ehItemDoHistorico(v: unknown): v is ItemDoHistorico {
  if (!ehAtendimento(v)) return false;
  const i = v as unknown as Record<string, unknown>;
  const p = i.payment;
  return (
    (i.priceCents === null || inteiro(i.priceCents)) &&
    (p === undefined ||
      p === null ||
      (objeto(p) && inteiro(p.amountCents) && texto(p.method) && texto(p.receivedOn) && typeof p.refunded === "boolean")) &&
    Array.isArray(i.hidden) &&
    i.hidden.every((h) => h === "price" || h === "payment")
  );
}

export interface ResumoDaTransferencia {
  agendamentos: number;
  concluidos: number;
  cancelados: number;
  faltas: number;
  outros: number;
  recebimentos: number;
  comissoes: number;
  pedidosPublicos: number;
}

export interface PreviaDaUnificacao {
  principal: ClienteReal;
  secundario: ClienteReal;
  relacoes: RelacaoEntreCadastros[];
  transferir: ResumoDaTransferencia;
  versaoDaPrevia: string;
}

function ehResumo(v: unknown): v is ResumoDaTransferencia {
  return (
    objeto(v) &&
    ["agendamentos", "concluidos", "cancelados", "faltas", "outros", "recebimentos", "comissoes", "pedidosPublicos"].every((k) =>
      inteiro(v[k]),
    )
  );
}

export function ehPrevia(v: unknown): v is PreviaDaUnificacao {
  return (
    objeto(v) &&
    ehCliente(v.principal) &&
    ehCliente(v.secundario) &&
    Array.isArray(v.relacoes) &&
    v.relacoes.every(ehRelacao) &&
    ehResumo(v.transferir) &&
    texto(v.versaoDaPrevia) &&
    /^[0-9a-f]{64}$/.test(v.versaoDaPrevia)
  );
}

export interface ResultadoDaUnificacao {
  principal: ClienteReal;
  secundarioId: string;
  mergedAt: string;
  repeated: boolean;
  transferido: ResumoDaTransferencia;
}

export function ehResultadoDaUnificacao(v: unknown): v is ResultadoDaUnificacao {
  return (
    objeto(v) &&
    ehCliente(v.principal) &&
    texto(v.secundarioId) &&
    texto(v.mergedAt) &&
    typeof v.repeated === "boolean" &&
    ehResumo(v.transferido)
  );
}
