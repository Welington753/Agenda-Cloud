"use client";

// Estado da consulta real de disponibilidade (Lote 6D.4) — mesma disciplina
// de use-horarios-reais.ts, com uma diferença importante: aqui NÃO existe
// gravação nenhuma, só consulta.
//
// A consulta é SOB DEMANDA, nunca automática ao digitar: o efeito depende de
// uma "consulta pedida" explícita, para a tela não disparar uma requisição a
// cada tecla no campo de data. O estado começa em "ociosa" — vazio antes de
// consultar é diferente de vazio depois de consultar, e a tela precisa dos
// dois.
//
// Descarte ao trocar de contexto: tenant, profissional, serviço e data
// compõem a chave da consulta; resposta atrasada de uma combinação anterior
// nunca escreve na tela da combinação atual (guarda a chave + AbortController).
import { useCallback, useEffect, useRef, useState } from "react";
import { consultarDisponibilidade } from "@/lib/api/availability-api";
import type {
  DisponibilidadeReal,
  FalhaDisponibilidadeReal,
} from "@/lib/api/availability-api";

export type EstadoDisponibilidade =
  /** Ainda não pediram nenhuma consulta — não é "sem horários". */
  | { status: "ociosa" }
  | { status: "consultando" }
  | { status: "carregada"; disponibilidade: DisponibilidadeReal }
  | { status: "falha"; falha: FalhaDisponibilidadeReal };

/** Um serviço (`serviceId`) ou vários (`serviceIds`, mesmo profissional, na
 * ordem do atendimento). */
export interface Selecao {
  serviceId?: string;
  serviceIds?: readonly string[];
  date: string;
}

const servicosDa = (selecao: Selecao): readonly string[] => selecao.serviceIds ?? (selecao.serviceId ? [selecao.serviceId] : []);

export interface DisponibilidadeControlada {
  estado: EstadoDisponibilidade;
  /** Dispara (ou repete) a consulta com a seleção informada. */
  consultar: (selecao: Selecao) => void;
  /** Volta para o estado inicial — usado quando a seleção muda e o resultado
   * na tela deixa de corresponder ao que está nos campos. */
  limpar: () => void;
}

export function useDisponibilidadeReal(
  tenantId: string | null,
  professionalId: string | null,
): DisponibilidadeControlada {
  const [estado, setEstado] = useState<EstadoDisponibilidade>({ status: "ociosa" });
  /** Consulta pedida + um contador, para que pedir a MESMA consulta de novo
   * (botão "Consultar" outra vez) realmente refaça a requisição. */
  const [pedido, setPedido] = useState<{ selecao: Selecao; tentativa: number } | null>(null);
  const chaveAtualRef = useRef<string | null>(null);

  const consultar = useCallback((selecao: Selecao) => {
    setPedido((anterior) => ({ selecao, tentativa: (anterior?.tentativa ?? 0) + 1 }));
  }, []);

  const limpar = useCallback(() => {
    setPedido(null);
    setEstado({ status: "ociosa" });
  }, []);

  // Trocar de estabelecimento ou de profissional invalida o resultado na
  // tela: ele é de outro contexto e nunca pode continuar visível.
  useEffect(() => {
    setPedido(null);
    setEstado({ status: "ociosa" });
  }, [tenantId, professionalId]);

  useEffect(() => {
    if (!pedido || !tenantId || !professionalId) return;

    // JSON, e não uma junção por separador: um id que contivesse o
    // separador poderia formar a mesma chave de outra combinação.
    const servicos = servicosDa(pedido.selecao);
    const chave = JSON.stringify([
      tenantId,
      professionalId,
      servicos,
      pedido.selecao.date,
      pedido.tentativa,
    ]);
    chaveAtualRef.current = chave;
    setEstado({ status: "consultando" });

    const controller = new AbortController();
    let cancelado = false;

    void (async () => {
      const resultado = await consultarDisponibilidade(
        tenantId,
        professionalId,
        servicos,
        pedido.selecao.date,
        controller.signal,
      );
      if (cancelado || chaveAtualRef.current !== chave) return;

      setEstado(
        resultado.ok
          ? { status: "carregada", disponibilidade: resultado.dados }
          : { status: "falha", falha: resultado.falha },
      );
    })();

    return () => {
      cancelado = true;
      controller.abort();
    };
  }, [tenantId, professionalId, pedido]);

  return { estado, consultar, limpar };
}
