// Regras puras dos avisos de NOVAS solicitações (sem React, testáveis sem
// montar componente). Quem consulta o servidor e mostra o aviso é
// use-solicitacoes.tsx; aqui só se decide O QUE é novo e QUANDO consultar.
//
// "Nova" é comparação com o que ESTA aba já viu nesta sessão, não um estado
// do servidor: o backend não guarda "lido/não lido" e nada aqui grava nada.
// A primeira leitura de cada estabelecimento é só a referência — o que já
// estava pendente ao entrar aparece na lista e no contador, sem aviso.
import type { ListaDeSolicitacoes, SolicitacaoPendente } from "@/lib/api/booking-requests-api";

/** Consulta periódica enquanto a página está visível e com conexão. */
export const INTERVALO_DE_CONSULTA_MS = 30_000;

export interface MemoriaDeAvisos {
  /** Toda solicitação já vista nesta sessão. Só cresce: uma solicitação que
   * sai e volta à lista nunca avisa de novo. */
  vistos: ReadonlySet<string>;
  /** A leitura anterior estava cortada pelo limite do servidor? */
  anteriorIncompleta: boolean;
  /** Maior `startAt` (ms) da leitura anterior; `null` com lista vazia. */
  ultimoInicioAnterior: number | null;
}

export interface Comparacao {
  novas: SolicitacaoPendente[];
  memoria: MemoriaDeAvisos;
}

function instante(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Compara uma leitura com a memória da sessão.
 *
 * - Sem memória (primeira leitura do estabelecimento): nenhuma é nova.
 * - Só pedidos do agendamento online (`PUBLIC`) avisam: reserva criada pela
 *   própria agenda foi feita por alguém da equipe.
 * - O servidor devolve as pendentes por `startAt` com limite. Se a leitura
 *   anterior veio cortada, uma solicitação ANTIGA que estava além do corte
 *   pode "aparecer" quando outra é respondida — e ela sempre começa no fim
 *   da lista anterior ou depois. Essas entram na memória sem aviso: na
 *   dúvida, não avisar (a lista e o contador continuam mostrando).
 */
export function compararLeitura(
  memoria: MemoriaDeAvisos | null,
  lista: ListaDeSolicitacoes,
): Comparacao {
  const vistos = new Set(memoria?.vistos ?? []);
  const novas: SolicitacaoPendente[] = [];
  let ultimoInicio: number | null = null;

  for (const s of lista.solicitacoes) {
    const inicio = instante(s.startAt);
    if (ultimoInicio === null || inicio > ultimoInicio) ultimoInicio = inicio;
    if (vistos.has(s.id)) continue;
    vistos.add(s.id);
    if (!memoria || s.origin !== "PUBLIC") continue;
    const talvezAntiga =
      memoria.anteriorIncompleta &&
      memoria.ultimoInicioAnterior !== null &&
      inicio >= memoria.ultimoInicioAnterior;
    if (!talvezAntiga) novas.push(s);
  }

  return {
    novas,
    memoria: { vistos, anteriorIncompleta: !lista.completa, ultimoInicioAnterior: ultimoInicio },
  };
}

/** Consultar agora? Só com a página visível e sem estar sabidamente offline. */
export function podeConsultar(visibilidade: DocumentVisibilityState, online: boolean): boolean {
  return visibilidade === "visible" && online;
}

/** Falhas que não melhoram sozinhas: a consulta periódica para (ações
 * explícitas — navegar, "Atualizar" — ainda tentam de novo). */
export function falhaDefinitiva(tipo: string): boolean {
  return tipo === "nao_autenticado" || tipo === "sem_permissao" || tipo === "sem_acesso";
}

/** Texto do aviso: quem pediu, o quê, com quem e quando. */
export function descricaoDoAviso(s: SolicitacaoPendente, data: string | null): string {
  const quando = data ? `${data} às ${s.localStart}` : `às ${s.localStart}`;
  return `${s.consumer.name} pediu ${s.service.name} com ${s.professional.name}, ${quando}.`;
}
