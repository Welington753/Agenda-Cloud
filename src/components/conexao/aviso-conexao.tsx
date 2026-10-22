"use client";

// Avisos da conexão com a API (ver lib/auth/conexao.ts). Um só lugar para o
// texto: conta, login e cadastro mostram a mesma coisa para a mesma
// situação. Nenhum deles envia nada por conta própria: "Tentar novamente"
// refaz só a LEITURA da sessão.
import { CloudOff, Loader2, WifiOff } from "lucide-react";
import { Botao } from "@/components/ui/button";
import type { EstadoConexao } from "@/lib/auth/conexao";

export const TEXTO_ACORDANDO =
  "Depois de um tempo sem uso, o servidor pode levar cerca de um minuto para responder. Esta tela continua sozinha quando ele responder.";

/** Conteúdo de tela inteira enquanto a sessão ainda não foi decidida. */
export function ConectandoAoServidor({ conexao }: { conexao: "acordando" | "sem_internet" }) {
  if (conexao === "sem_internet") {
    return (
      <div role="status" className="space-y-2 text-center" data-testid="conexao-sem-internet">
        <WifiOff size={24} className="mx-auto text-ink-soft" aria-hidden="true" />
        <h1 className="text-lg font-bold text-ink">Sem conexão com a internet</h1>
        <p className="text-sm text-ink-soft">Assim que a conexão voltar, continuamos daqui. Nada foi alterado.</p>
      </div>
    );
  }
  return (
    <div role="status" className="space-y-2 text-center" data-testid="conexao-acordando">
      <Loader2 size={24} className="mx-auto animate-spin text-ink-soft" aria-hidden="true" />
      <h1 className="text-lg font-bold text-ink">Conectando ao servidor…</h1>
      <p className="text-sm text-ink-soft">{TEXTO_ACORDANDO}</p>
    </div>
  );
}

/** Faixa discreta com a tela já aberta (ou no login/cadastro): nunca
 * esconde o conteúdo nem o que foi digitado. `null` com a conexão normal. */
export function FaixaConexao({ conexao, aoTentarDeNovo }: { conexao: EstadoConexao; aoTentarDeNovo: () => void }) {
  if (conexao === "ok") return null;
  const base =
    "flex items-start gap-2 rounded-[var(--radius-control)] border border-border bg-paper-muted p-3 text-sm text-ink";
  if (conexao === "acordando") {
    return (
      <div role="status" className={base} data-testid="faixa-conexao-acordando">
        <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
        <span>Conectando ao servidor… {TEXTO_ACORDANDO}</span>
      </div>
    );
  }
  if (conexao === "sem_internet") {
    return (
      <div role="status" className={base} data-testid="faixa-conexao-sem-internet">
        <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>Sem conexão com a internet. Assim que ela voltar, continuamos.</span>
      </div>
    );
  }
  return (
    <div role="alert" className={base} data-testid="faixa-conexao-sem-resposta">
      <CloudOff size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <p>O servidor não respondeu a tempo. O que está na tela foi mantido.</p>
        <Botao type="button" variante="secundaria" tamanho="sm" onClick={aoTentarDeNovo}>
          Tentar novamente
        </Botao>
      </div>
    </div>
  );
}
