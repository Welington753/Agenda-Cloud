"use client";

// Chegada pela notificação: /conta/agendamentos/solicitacoes?estabelecimento=…&solicitacao=…
//
// A URL é só um DESTINO. Antes de qualquer dado aparecer:
// - a sessão já foi confirmada (RequireRealSession; sem sessão, o login
//   volta para esta mesma URL);
// - o estabelecimento precisa estar entre os vínculos que o BACKEND devolveu
//   para esta sessão — senão, nada é aberto e a pessoa é avisada;
// - se for outro estabelecimento da mesma conta, ele vira o ativo (a lista é
//   relida dele, com a autorização conferida pela API);
// - a solicitação é só DESTACADA; nenhuma ação é feita.
// Depois, os parâmetros saem da URL (recarregar não repete o destaque).
import { useEffect, useState } from "react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { useAvisosDeSolicitacoes, useSolicitacoesPendentes } from "@/lib/agendamento-publico/use-solicitacoes";
import { lerDestinoDaNotificacao, type DestinoDaNotificacao } from "./suporte";

export type AvisoDoDestino = "sem_acesso" | "respondida" | "fora_da_lista" | null;

export const MENSAGEM_DO_DESTINO: Record<Exclude<AvisoDoDestino, null>, string> = {
  sem_acesso:
    "Esta notificação é de um estabelecimento que esta conta não acessa mais. Nenhum dado dele foi aberto.",
  respondida: "Esta solicitação não está mais aguardando confirmação: ela já foi respondida, remarcada ou cancelada.",
  fora_da_lista: "Esta solicitação não está entre as primeiras da lista. Responda às mais antigas para vê-la aqui.",
};

function limparUrl() {
  window.history.replaceState(null, "", window.location.pathname);
}

export function useDestinoDaNotificacao(): { pendente: boolean; aviso: AvisoDoDestino } {
  const { estado: sessao, selecionarTenantAtivo } = useRealAuth();
  const { estado: lista } = useSolicitacoesPendentes();
  const { abrirSolicitacao } = useAvisosDeSolicitacoes();
  // `undefined` = URL ainda não lida (só no navegador, depois de montar).
  const [destino, setDestino] = useState<DestinoDaNotificacao | null | undefined>(undefined);
  const [conferir, setConferir] = useState<string | null>(null);
  const [aviso, setAviso] = useState<AvisoDoDestino>(null);

  useEffect(() => setDestino(lerDestinoDaNotificacao(window.location.search)), []);

  useEffect(() => {
    if (!destino || sessao.status !== "autenticado") return;
    if (!encontrarContextoPorTenantId(sessao.sessao, destino.tenantId)) {
      setAviso("sem_acesso");
      limparUrl();
      setDestino(null);
      return;
    }
    if (sessao.tenantIdAtivo !== destino.tenantId) {
      selecionarTenantAtivo(destino.tenantId);
      return;
    }
    abrirSolicitacao(destino.solicitacaoId);
    setConferir(destino.solicitacaoId);
    limparUrl();
    setDestino(null);
  }, [destino, sessao, selecionarTenantAtivo, abrirSolicitacao]);

  // A lista (já do estabelecimento certo) tem a solicitação?
  useEffect(() => {
    if (!conferir || lista.status === "carregando") return;
    if (lista.status === "carregada" && !lista.lista.solicitacoes.some((s) => s.id === conferir)) {
      setAviso(lista.lista.completa ? "respondida" : "fora_da_lista");
    }
    setConferir(null);
  }, [conferir, lista]);

  return { pendente: destino !== null, aviso };
}
