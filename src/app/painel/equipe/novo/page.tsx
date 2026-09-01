"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { useClientData } from "@/lib/hooks/use-client-data";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { conviteRepository, membershipRepository, profissionalRepository, usuarioEstabelecimentoRepository } from "@/lib/repositories";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { PapelEstabelecimento } from "@/lib/types";

export default function NovoMembroEquipePage() {
  return (
    <RequirePermission permissao="equipe.gerenciar">
      <ConteudoNovoMembro />
    </RequirePermission>
  );
}

function ConteudoNovoMembro() {
  const { tenantId, terminologia } = useTenant();
  const { usuario } = useAuth();
  const { notificar } = useToast();
  const router = useRouter();

  const { dados, carregando } = useClientData(
    () => profissionalRepository.listarPorTenant(tenantId).filter((p) => p.ativo),
    [tenantId]
  );

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [papel, setPapel] = useState<PapelEstabelecimento>("recepcionista");
  const [profissionalId, setProfissionalId] = useState("");

  if (carregando || !dados || !usuario) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  function confirmar() {
    if (!nome.trim() || !email.trim()) {
      notificar("Informe nome e e-mail.", "erro");
      return;
    }
    const novoUsuario = usuarioEstabelecimentoRepository.criar({
      nome: nome.trim(),
      email: email.trim(),
      telefone: telefone.trim() || undefined,
      status: "convidado",
      criadoEm: new Date().toISOString(),
    });
    membershipRepository.criar({
      usuarioId: novoUsuario.id,
      tenantId,
      papel,
      profissionalId: papel === "profissional" && profissionalId ? profissionalId : undefined,
      permissoesLiberadas: [],
      permissoesNegadas: [],
    });
    conviteRepository.criar({
      tipo: "estabelecimento",
      nome: nome.trim(),
      email: email.trim(),
      tenantId,
      papel,
      expiraEm: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    notificar("Convite enviado (simulado). A pessoa aparece como convidada até aceitar.", "sucesso");
    router.push("/painel/equipe");
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <Link href="/painel/equipe" className="text-xs font-semibold text-accent hover:underline">
          ← Equipe e acessos
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">Novo membro da equipe</h1>
      </div>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Nome</label>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Telefone (opcional)</label>
            <input type="text" value={telefone} onChange={(e) => setTelefone(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Papel</label>
            <select
              value={papel}
              onChange={(e) => setPapel(e.target.value as PapelEstabelecimento)}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="gerente">Gerente</option>
              <option value="recepcionista">Recepcionista</option>
              <option value="profissional">Profissional</option>
            </select>
            <p className="mt-1 text-xs text-ink-soft">
              O dono nunca é criado por aqui, e nenhum papel de administrador master pode ser atribuído a um membro do
              estabelecimento.
            </p>
          </div>
          {papel === "profissional" && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">
                Vincular {terminologia.profissional.artigo === "a" ? "à" : "ao"} {terminologia.profissional.singular.toLowerCase()} (opcional)
              </label>
              <select
                value={profissionalId}
                onChange={(e) => setProfissionalId(e.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              >
                <option value="">Nenhum — cadastre em {terminologia.equipe} depois</option>
                {dados.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
        </CartaoCorpo>
      </Cartao>

      <Botao className="w-full" onClick={confirmar}>
        Enviar convite (simulado)
      </Botao>
    </div>
  );
}
