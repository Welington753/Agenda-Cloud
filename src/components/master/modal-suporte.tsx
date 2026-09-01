"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Botao } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth/auth-context";
import { podeAdministrarPlataforma } from "@/lib/access/access-control";
import { auditoriaRepository, usuarioPlataformaRepository } from "@/lib/repositories";
import type { Estabelecimento, PapelPlataforma } from "@/lib/types";

export function ModalSuporte({
  estabelecimento,
  aoFechar,
}: {
  estabelecimento: Estabelecimento | null;
  aoFechar: () => void;
}) {
  const { usuario } = useAuth();
  const { notificar } = useToast();
  const [motivo, setMotivo] = useState("");

  function fechar() {
    setMotivo("");
    aoFechar();
  }

  function confirmarAcesso() {
    if (!estabelecimento || !usuario) return;
    const contaMaster = usuarioPlataformaRepository.obterPorId(usuario.id);
    const verificacao = podeAdministrarPlataforma(
      usuario.papel as PapelPlataforma,
      contaMaster?.permissoesExtras ?? [],
      contaMaster?.status ?? "suspenso",
      "suporte.acessar"
    );
    if (!verificacao.permitido) {
      notificar("Seu perfil de administrador não tem permissão de acesso a suporte.", "erro");
      return;
    }
    if (!motivo.trim()) {
      notificar("Informe o motivo do acesso de suporte.", "erro");
      return;
    }
    auditoriaRepository.registrar({
      acao: "suporte.acessado",
      usuarioResponsavelId: usuario.id,
      usuarioResponsavelNome: usuario.nome,
      tenantId: estabelecimento.tenantId,
      resumo: `Acesso de suporte a ${estabelecimento.identidadeVisual.nome}: ${motivo.trim()}`,
    });
    notificar("Acesso de suporte registrado na auditoria.", "sucesso");
    fechar();
  }

  return (
    <Modal aberto={Boolean(estabelecimento)} aoFechar={fechar} titulo="Acesso de suporte (simulado)">
      {estabelecimento && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warning-soft p-3 text-[color:var(--color-warning)]">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            <p className="text-sm">
              Todo acesso de suporte a um estabelecimento é registrado e auditado, com o motivo informado abaixo.
            </p>
          </div>
          <p>
            Você estaria entrando como suporte no painel de <strong>{estabelecimento.identidadeVisual.nome}</strong>.
            Nesta demonstração, nenhum acesso real ao painel é realizado — só o registro de auditoria.
          </p>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Motivo do acesso</label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: Investigar dúvida sobre remarcação."
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>
        </div>
      )}
      <div className="mt-5 flex gap-2">
        <Botao variante="secundaria" className="flex-1" onClick={fechar}>
          Cancelar
        </Botao>
        <Botao className="flex-1" onClick={confirmarAcesso}>
          Confirmar acesso
        </Botao>
      </div>
    </Modal>
  );
}
