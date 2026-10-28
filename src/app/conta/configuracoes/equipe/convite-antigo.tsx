"use client";

// Convite de funcionário por e-mail ainda pendente, do fluxo anterior. Novos
// acessos são criados com login e senha ("Criar acesso"); os convites já
// enviados não somem calados: continuam valendo até vencer, ocupam a vaga e
// o profissional reservados, e o dono decide reenviar ou revogar.
import { useState } from "react";
import { Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import { dataHora, textoEnvio } from "@/lib/administracao/rotulos";
import type { MembroDaEquipe, VisaoDaEquipe } from "@/lib/equipe/contratos";

type Pergunta = "revogar" | "reenviar";

export function ConviteAntigo({
  membro,
  visao,
  aoMudar,
}: {
  membro: MembroDaEquipe & { invite: NonNullable<MembroDaEquipe["invite"]> };
  visao: VisaoDaEquipe;
  aoMudar: () => void;
}) {
  const { notificar } = useToast();
  const [pergunta, setPergunta] = useState<Pergunta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const convite = membro.invite;
  const base = `/tenants/${encodeURIComponent(visao.tenant.id)}/team/invites/${encodeURIComponent(convite.id)}`;

  async function confirmar() {
    if (!pergunta || ocupado) return;
    setOcupado(true);
    const r = await acaoAdministrativa(`${base}/${pergunta === "revogar" ? "revoke" : "resend"}`, "POST");
    setOcupado(false);
    setPergunta(null);
    if (r.tipo === "ok") {
      setMensagem("");
      notificar(pergunta === "revogar" ? "Convite revogado." : "Novo link emitido.", "sucesso");
      aoMudar();
    } else setMensagem(mensagemDoResultado(r));
  }

  return (
    <li className="space-y-2 rounded-[var(--radius-card)] border border-border bg-card p-4" data-testid="convite-antigo">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold text-ink">{convite.name}</p>
          <p className="break-all text-sm text-ink-soft">
            Convite para {convite.email} · {membro.professional.name}
          </p>
        </div>
        <Badge cor="info">
          <Mail size={14} aria-hidden="true" />
          Convite pendente
        </Badge>
      </div>
      <p className="text-xs text-ink-soft">
        Link válido até {dataHora(convite.expiresAt)} · {convite.sendCount} de {visao.maxInviteSends} links emitidos ·{" "}
        {textoEnvio(convite.delivery)}
        {convite.accountExists ? " · e-mail com conta: a pessoa aceita com a senha dela" : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {convite.sendCount < visao.maxInviteSends && (
          <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => setPergunta("reenviar")}>
            Reenviar convite
          </Botao>
        )}
        <Botao type="button" variante="fantasma" className="min-h-11" onClick={() => setPergunta("revogar")}>
          Revogar convite
        </Botao>
      </div>
      {mensagem && (
        <p role="status" className="text-sm text-ink-soft">
          {mensagem}
        </p>
      )}
      <Modal
        aberto={pergunta !== null}
        aoFechar={() => !ocupado && setPergunta(null)}
        titulo={pergunta === "revogar" ? "Revogar o convite?" : "Reenviar o convite?"}
        rodape={
          <>
            <Botao variante="secundaria" onClick={() => setPergunta(null)} disabled={ocupado} className="min-h-11">
              Cancelar
            </Botao>
            <Botao
              variante={pergunta === "revogar" ? "perigo" : "primaria"}
              onClick={() => void confirmar()}
              disabled={ocupado}
              className="min-h-11"
            >
              {pergunta === "revogar" ? "Revogar convite" : "Reenviar"}
            </Botao>
          </>
        }
      >
        <p>
          {pergunta === "revogar"
            ? `O link enviado para ${convite.email} deixa de funcionar e a vaga do plano fica livre. A conta da pessoa não é apagada. Depois, você pode criar um acesso com login e senha para este profissional.`
            : `Um link novo vai para ${convite.email}, válido por 24 horas. O link anterior deixa de funcionar. Não ocupa outra vaga.`}
        </p>
      </Modal>
    </li>
  );
}
