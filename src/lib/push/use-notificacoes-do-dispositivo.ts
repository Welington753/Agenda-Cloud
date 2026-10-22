"use client";

// Estado REAL das notificações (Web Push) neste aparelho, para o cartão
// "Notificações neste dispositivo" e para o resumo do menu da conta. Uma
// verificação ao montar (nunca periódica): capacidades do navegador, push
// ligado no servidor, permissão e se a inscrição DESTE navegador está ativa
// para este estabelecimento e esta sessão.
//
// - A permissão do navegador só é pedida em `ativar`, chamado pelo clique.
// - Sair da conta desliga (ver encerrarNoDispositivo e a migration WebPush).
import { useCallback, useEffect, useState } from "react";
import {
  ativarInscricao,
  consultarInscricao,
  desativarInscricao,
  obterConfiguracaoPush,
  type FalhaPush,
} from "@/lib/api/push-api";
import { mensagemFalhaPrivada } from "@/lib/agendamento-publico/solicitacoes";
import { inscrever, inscricaoAtual, lerAmbiente } from "./dispositivo";
import { avaliarSuporte } from "./suporte";

export type EstadoPushDoDispositivo =
  | { tipo: "verificando" }
  | { tipo: "nao_suportado" }
  | { tipo: "instalar_no_iphone" }
  | { tipo: "servidor_sem_push" }
  | { tipo: "bloqueado" }
  | { tipo: "desativado"; publicKey: string }
  | { tipo: "ativado"; publicKey: string }
  | { tipo: "falha"; mensagem: string };

function mensagemDaFalha(falha: FalhaPush): string {
  if (falha.tipo === "push_desligado") return "O servidor ainda não está configurado para enviar notificações.";
  if (falha.tipo === "inscricao_recusada") return falha.mensagem ?? "Este navegador não pôde ser inscrito. Tente de novo.";
  return mensagemFalhaPrivada(falha);
}

export function useNotificacoesDoDispositivo(tenantId: string) {
  const [estado, setEstado] = useState<EstadoPushDoDispositivo>({ tipo: "verificando" });
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const verificar = useCallback(
    async (signal?: AbortSignal) => {
      const suporte = avaliarSuporte(lerAmbiente());
      if (suporte !== "suportado") return setEstado({ tipo: suporte });
      const config = await obterConfiguracaoPush(signal);
      if (signal?.aborted) return;
      if (!config.ok) return setEstado({ tipo: "falha", mensagem: mensagemFalhaPrivada(config.falha) });
      if (!config.dados.enabled || !config.dados.publicKey) return setEstado({ tipo: "servidor_sem_push" });
      const publicKey = config.dados.publicKey;
      if (Notification.permission === "denied") return setEstado({ tipo: "bloqueado" });
      const atual = Notification.permission === "granted" ? await inscricaoAtual().catch(() => null) : null;
      if (!atual) return setEstado({ tipo: "desativado", publicKey });
      const r = await consultarInscricao(tenantId, atual.endpoint, signal);
      if (signal?.aborted) return;
      if (!r.ok) return setEstado({ tipo: "falha", mensagem: mensagemDaFalha(r.falha) });
      setEstado({ tipo: r.dados ? "ativado" : "desativado", publicKey });
    },
    [tenantId],
  );

  useEffect(() => {
    const controle = new AbortController();
    void verificar(controle.signal);
    return () => controle.abort();
  }, [verificar]);

  async function ativar(publicKey: string) {
    if (ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      // Pedido de permissão SÓ aqui, no clique.
      const permissao = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (permissao === "denied") return setEstado({ tipo: "bloqueado" });
      if (permissao !== "granted") {
        setAviso("A permissão não foi concedida. Toque em ativar de novo quando quiser.");
        return;
      }
      const inscricao = await inscrever(publicKey);
      const r = await ativarInscricao(tenantId, inscricao.toJSON());
      if (!r.ok) {
        setAviso(mensagemDaFalha(r.falha));
        return;
      }
      setEstado({ tipo: "ativado", publicKey });
    } catch {
      setAviso("O navegador não conseguiu ativar as notificações agora. Tente de novo em instantes.");
    } finally {
      setOcupado(false);
    }
  }

  async function desativar(publicKey: string) {
    if (ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      const atual = await inscricaoAtual();
      if (atual) {
        const r = await desativarInscricao(tenantId, atual.endpoint);
        if (!r.ok) {
          setAviso(mensagemDaFalha(r.falha));
          return;
        }
      }
      setEstado({ tipo: "desativado", publicKey });
    } catch {
      setAviso("Não foi possível desativar agora. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  }

  return { estado, ocupado, aviso, verificar, ativar, desativar };
}
