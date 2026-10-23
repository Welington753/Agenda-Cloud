"use client";

// Reenviar (emite outro link; o anterior deixa de valer) e revogar um
// convite pendente. Cada ação confirma antes e mostra o resultado real.
import { useState } from "react";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import { textoEnvio } from "@/lib/administracao/rotulos";
import type { Convite } from "@/lib/administracao/contas";

type Pergunta = "reenviar" | "revogar" | null;

export function AcoesConvite({ convite, aoMudar }: { convite: Convite; aoMudar: () => void }) {
  const [pergunta, setPergunta] = useState<Pergunta>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  if (convite.status !== "PENDING" && convite.status !== "EXPIRED") return null;
  const podeReenviar = convite.sendCount < convite.maxSends;

  async function executar() {
    if (!pergunta || ocupado) return;
    setOcupado(true);
    const caminho = `/platform/invites/${encodeURIComponent(convite.id)}/${pergunta === "reenviar" ? "resend" : "revoke"}`;
    const r = await acaoAdministrativa<{ invite?: Convite; delivery?: { status: string; failure?: string } | null }>(caminho, "POST");
    setOcupado(false);
    setPergunta(null);
    if (r.tipo === "ok") {
      setMensagem(
        pergunta === "revogar"
          ? "Convite revogado. O link enviado não funciona mais."
          : `Novo link emitido. ${r.dados.delivery ? textoEnvio(r.dados.delivery) : ""}`,
      );
      aoMudar();
    } else setMensagem(mensagemDoResultado(r));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {podeReenviar && (
          <Botao variante="secundaria" tamanho="sm" className="min-h-11" onClick={() => setPergunta("reenviar")}>
            Reenviar
          </Botao>
        )}
        {convite.status === "PENDING" && (
          <Botao variante="fantasma" tamanho="sm" className="min-h-11" onClick={() => setPergunta("revogar")}>
            Revogar
          </Botao>
        )}
      </div>
      {!podeReenviar && <p className="text-xs text-ink-soft">Limite de links atingido. Revogue e crie outro convite.</p>}
      {mensagem && (
        <p role="status" className="text-xs text-ink-soft">
          {mensagem}
        </p>
      )}
      <Modal
        aberto={pergunta !== null}
        aoFechar={() => setPergunta(null)}
        titulo={pergunta === "revogar" ? "Revogar convite?" : "Reenviar convite?"}
        rodape={
          <>
            <Botao variante="secundaria" onClick={() => setPergunta(null)} className="min-h-11">
              Cancelar
            </Botao>
            <Botao variante={pergunta === "revogar" ? "perigo" : "primaria"} onClick={() => void executar()} disabled={ocupado} className="min-h-11">
              {pergunta === "revogar" ? "Revogar" : "Reenviar"}
            </Botao>
          </>
        }
      >
        <p>
          {pergunta === "revogar"
            ? `O link enviado para ${convite.targetEmail} deixa de funcionar. A conta não é apagada.`
            : `Um link novo vai para ${convite.targetEmail}, válido por 24 horas. O link anterior deixa de funcionar.`}
        </p>
      </Modal>
    </div>
  );
}
