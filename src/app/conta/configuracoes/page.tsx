"use client";

// Índice de Configurações. O dono vê as seções do estabelecimento e as
// pessoais; o funcionário, o papel sem área e o administrador sem
// estabelecimento veem só as pessoais (Aparência, Perfil e segurança).
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { perfilDoPapel } from "@/lib/conta/papel";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { ListaDeSecoes, useSecoesDeConfiguracoes } from "@/components/conta/configuracoes";

export default function ConfiguracoesPage() {
  const { estado } = useRealAuth();
  const router = useRouter();
  const secoes = useSecoesDeConfiguracoes();
  const sessao = estado.status === "autenticado" ? estado.sessao : null;
  const tenantIdAtivo = estado.status === "autenticado" ? estado.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  if (!sessao || precisaSelecionar) return null;
  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;
  const perfil = perfilDoPapel(contexto?.role);

  return (
    <PaginaConta
      titulo="Configurações"
      descricao={
        contexto && perfil === "dono"
          ? `Ajustes de ${contexto.tenantName} e da sua conta.`
          : "Ajustes da sua conta. As configurações do estabelecimento ficam com o responsável."
      }
    >
      {sessao.contexts.length === 0 && (
        <p
          className="rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-ink-soft"
          data-testid="sem-estabelecimento"
        >
          Sua conta não tem acesso ativo a um estabelecimento agora. Se você trabalha em um, fale com o responsável.
        </p>
      )}
      {contexto && perfil === "sem-area" && (
        <p className="rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-ink-soft" data-testid="papel-sem-area">
          Este papel não tem área liberada neste estabelecimento. Fale com o responsável.
        </p>
      )}
      <ListaDeSecoes secoes={secoes} />
    </PaginaConta>
  );
}
