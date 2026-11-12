"use client";

// Confirmação do segundo fator NESTA sessão: código do aplicativo ou, sem o
// celular, um código de recuperação (vale uma vez). Só o servidor decide; a
// tela relê o acesso depois de um acerto.
import { useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { usarCodigoDeRecuperacao, verificarCodigo } from "@/lib/api/segundo-fator-api";
import {
  codigoDeRecuperacaoCompleto,
  codigoDoAplicativoCompleto,
  mensagemDaFalha,
} from "@/lib/administracao/segundo-fator";
import { CampoCodigoDeRecuperacao, CampoCodigoDoAplicativo, Erro } from "./campos";

export function VerificacaoDoSegundoFator({
  aoConfirmar,
  titulo = "Verificação em duas etapas",
  explicacao = "Digite o código que aparece agora no seu aplicativo autenticador.",
}: {
  aoConfirmar: () => void;
  titulo?: string;
  explicacao?: string;
}) {
  const [modo, setModo] = useState<"aplicativo" | "recuperacao">("aplicativo");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const completo = modo === "aplicativo" ? codigoDoAplicativoCompleto(codigo) : codigoDeRecuperacaoCompleto(codigo);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando || !completo) return;
    setEnviando(true);
    setErro("");
    const r = modo === "aplicativo" ? await verificarCodigo(codigo) : await usarCodigoDeRecuperacao(codigo);
    setEnviando(false);
    setCodigo("");
    if (r.ok) aoConfirmar();
    else setErro(mensagemDaFalha(r.falha));
  }

  function trocarModo() {
    setModo(modo === "aplicativo" ? "recuperacao" : "aplicativo");
    setCodigo("");
    setErro("");
  }

  return (
    <form onSubmit={(e) => void enviar(e)} className="space-y-4" data-testid="verificacao-segundo-fator">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{titulo}</h2>
        <p className="text-sm text-ink-soft">
          {modo === "aplicativo"
            ? explicacao
            : "Sem o celular, use um dos códigos de recuperação que você guardou. Cada um vale uma única vez."}
        </p>
      </div>
      {modo === "aplicativo" ? (
        <CampoCodigoDoAplicativo valor={codigo} aoMudar={setCodigo} autoFocus />
      ) : (
        <CampoCodigoDeRecuperacao valor={codigo} aoMudar={setCodigo} />
      )}
      <Erro texto={erro} />
      <div className="flex flex-wrap items-center gap-3">
        <Botao type="submit" className="min-h-11" disabled={!completo || enviando}>
          {enviando ? "Confirmando…" : "Confirmar"}
        </Botao>
        <button type="button" onClick={trocarModo} className="inline-flex min-h-11 items-center text-sm font-medium text-accent">
          {modo === "aplicativo" ? "Usar um código de recuperação" : "Usar o código do aplicativo"}
        </button>
      </div>
    </form>
  );
}
