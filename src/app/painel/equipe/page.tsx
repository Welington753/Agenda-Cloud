"use client";

import Link from "next/link";
import { Plus, RotateCcw, UserCheck, Users } from "lucide-react";
import { useClientData } from "@/lib/hooks/use-client-data";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { conviteRepository, membershipRepository, usuarioEstabelecimentoRepository } from "@/lib/repositories";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { BadgeStatusConvite, BadgeStatusUsuario } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatarData } from "@/lib/format";

const ROTULO_PAPEL: Record<string, string> = {
  dono: "Dono",
  gerente: "Gerente",
  recepcionista: "Recepcionista",
  profissional: "Profissional",
};

export default function PainelEquipePage() {
  return (
    <RequirePermission permissao="equipe.visualizar">
      <ConteudoEquipe />
    </RequirePermission>
  );
}

function ConteudoEquipe() {
  const { tenantId, terminologia, podeAcessar } = useTenant();
  const { notificar } = useToast();
  const podeGerenciar = podeAcessar("equipe.gerenciar").permitido;

  const { dados, carregando, recarregar } = useClientData(() => {
    const memberships = membershipRepository.listarPorTenant(tenantId);
    const usuarios = usuarioEstabelecimentoRepository.listarTodos();
    return {
      equipe: memberships.map((m) => ({ membership: m, usuario: usuarios.find((u) => u.id === m.usuarioId) })),
      convites: conviteRepository.listarPorTenant(tenantId),
    };
  }, [tenantId]);

  if (carregando || !dados) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { equipe, convites } = dados;

  function aceitarConvite(conviteId: string) {
    const convite = convites.find((c) => c.id === conviteId);
    if (!convite) return;
    const usuarioAlvo = equipe.find((e) => e.usuario?.email === convite.email)?.usuario;
    if (usuarioAlvo) usuarioEstabelecimentoRepository.atualizar(usuarioAlvo.id, { status: "ativo" });
    conviteRepository.atualizarStatus(convite.id, "aceito", { aceitoEm: new Date().toISOString(), usuarioIdGerado: usuarioAlvo?.id });
    notificar("Convite aceito (simulado).", "sucesso");
    recarregar();
  }

  function reenviarConvite(conviteId: string) {
    const novo = conviteRepository.reenviar(conviteId);
    if (!novo) {
      notificar("Só é possível reenviar convites pendentes ou expirados.", "erro");
      return;
    }
    notificar("Convite reenviado.", "sucesso");
    recarregar();
  }

  function alternarStatusUsuario(usuarioId: string, statusAtual: string) {
    usuarioEstabelecimentoRepository.atualizar(usuarioId, { status: statusAtual === "ativo" ? "suspenso" : "ativo" });
    notificar("Status atualizado.", "sucesso");
    recarregar();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-ink">Equipe e acessos</h1>
          <p className="text-sm text-ink-soft">
            Gerentes, recepcionistas e {terminologia.profissional.plural.toLowerCase()} com acesso a este painel.
          </p>
        </div>
        {podeGerenciar && (
          <Link href="/painel/equipe/novo">
            <Botao tamanho="sm">
              <Plus size={16} className="mr-1.5" /> Novo membro
            </Botao>
          </Link>
        )}
      </div>

      {equipe.length === 0 ? (
        <EstadoVazio icone={Users} titulo="Nenhum membro de equipe cadastrado ainda" />
      ) : (
        <Cartao>
          <CartaoCorpo>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-soft">
                    <th className="pb-2 pr-4 font-semibold">Nome</th>
                    <th className="pb-2 pr-4 font-semibold">Papel</th>
                    <th className="pb-2 pr-4 font-semibold">Status</th>
                    <th className="pb-2 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {equipe.map(({ membership, usuario: u }) => (
                    <tr key={membership.id}>
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-ink">{u?.nome ?? "—"}</p>
                        <p className="text-xs text-ink-soft">{u?.email}</p>
                      </td>
                      <td className="py-2.5 pr-4 text-ink-soft">{ROTULO_PAPEL[membership.papel]}</td>
                      <td className="py-2.5 pr-4">{u && <BadgeStatusUsuario status={u.status} />}</td>
                      <td className="py-2.5">
                        {podeGerenciar && u && membership.papel !== "dono" && (
                          <button
                            type="button"
                            onClick={() => alternarStatusUsuario(u.id, u.status)}
                            className="text-xs font-semibold text-accent hover:underline"
                          >
                            {u.status === "ativo" ? "Suspender" : "Reativar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CartaoCorpo>
        </Cartao>
      )}

      <Cartao>
        <CartaoCorpo>
          <CartaoTitulo className="mb-3">Convites</CartaoTitulo>
          {convites.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhum convite enviado ainda.</p>
          ) : (
            <ul className="divide-y divide-border">
              {convites.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="font-medium text-ink">{c.nome}</p>
                    <p className="text-xs text-ink-soft">
                      {c.email} · {ROTULO_PAPEL[c.papel] ?? c.papel} · expira em {formatarData(c.expiraEm)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <BadgeStatusConvite status={c.status} />
                    {podeGerenciar && c.status === "pendente" && (
                      <button type="button" onClick={() => aceitarConvite(c.id)} className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                        <UserCheck size={14} /> Aceitar (simular)
                      </button>
                    )}
                    {podeGerenciar && (c.status === "pendente" || c.status === "expirado") && (
                      <button type="button" onClick={() => reenviarConvite(c.id)} className="flex items-center gap-1 text-xs font-semibold text-ink-soft hover:underline">
                        <RotateCcw size={14} /> Reenviar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}
