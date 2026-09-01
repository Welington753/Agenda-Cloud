"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Botao } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { conviteRepository, auditoriaRepository } from "@/lib/repositories";
import type { PapelPlataforma } from "@/lib/types";

const PAPEIS: { valor: PapelPlataforma; rotulo: string }[] = [
  { valor: "MASTER_ADMIN", rotulo: "MASTER_ADMIN — permissões configuráveis" },
  { valor: "MASTER_SUPPORT", rotulo: "MASTER_SUPPORT — acesso a suporte" },
];

export function ModalConvitePlataforma({
  aberto,
  aoFechar,
  responsavelId,
  responsavelNome,
  onCriado,
}: {
  aberto: boolean;
  aoFechar: () => void;
  responsavelId: string;
  responsavelNome: string;
  onCriado: () => void;
}) {
  const { notificar } = useToast();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<PapelPlataforma>("MASTER_ADMIN");

  function confirmar() {
    if (!nome.trim() || !email.trim()) {
      notificar("Informe nome e e-mail.", "erro");
      return;
    }
    conviteRepository.criar({
      tipo: "plataforma",
      nome: nome.trim(),
      email: email.trim(),
      papel,
      expiraEm: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    auditoriaRepository.registrar({
      acao: "usuario.convidado",
      usuarioResponsavelId: responsavelId,
      usuarioResponsavelNome: responsavelNome,
      resumo: `Convite de administrador (${papel}) enviado para ${email.trim()}.`,
    });
    notificar("Convite criado. A pessoa aparece como pendente até aceitar (simulado).", "sucesso");
    setNome("");
    setEmail("");
    setPapel("MASTER_ADMIN");
    onCriado();
    aoFechar();
  }

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Convidar administrador">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Nome</label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Perfil</label>
          <select
            value={papel}
            onChange={(e) => setPapel(e.target.value as PapelPlataforma)}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          >
            {PAPEIS.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-5">
        <Botao className="w-full" onClick={confirmar}>
          Enviar convite (simulado)
        </Botao>
      </div>
    </Modal>
  );
}
