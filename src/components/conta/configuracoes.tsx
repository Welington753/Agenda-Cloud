"use client";

// Peças comuns de Configurações: quais seções esta sessão usa e a lista de
// seções (índice no celular e no computador; menu lateral nas subpáginas, no
// computador). As seções do estabelecimento só aparecem para o dono com
// estabelecimento ativo; o servidor continua recusando as rotas delas a
// qualquer outro papel.
import Link from "next/link";
import clsx from "clsx";
import {
  Bell,
  ChevronRight,
  ClipboardList,
  KeyRound,
  Palette,
  Store,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { perfilDoPapel } from "@/lib/conta/papel";
import { itemAtivo } from "@/lib/conta/navegacao";
import {
  ROTA_APARENCIA,
  ROTA_CONFIG_ESTABELECIMENTO,
  ROTA_EQUIPE,
  ROTA_NOTIFICACOES,
  ROTA_PERFIL,
  ROTA_PROFISSIONAIS,
  ROTA_SERVICOS,
  secoesDisponiveis,
  type SecaoDeConfiguracoes,
} from "@/lib/conta/rotas";

const ICONE_DA_SECAO: Record<string, LucideIcon> = {
  [ROTA_CONFIG_ESTABELECIMENTO]: Store,
  [ROTA_SERVICOS]: ClipboardList,
  [ROTA_PROFISSIONAIS]: Users,
  [ROTA_EQUIPE]: KeyRound,
  [ROTA_NOTIFICACOES]: Bell,
  [ROTA_APARENCIA]: Palette,
  [ROTA_PERFIL]: UserRound,
};

/** Seções que esta sessão usa (dono com estabelecimento ativo: todas). */
export function useSecoesDeConfiguracoes(): readonly SecaoDeConfiguracoes[] {
  const { estado } = useRealAuth();
  if (estado.status !== "autenticado") return [];
  const contexto = estado.tenantIdAtivo ? encontrarContextoPorTenantId(estado.sessao, estado.tenantIdAtivo) : null;
  return secoesDisponiveis(!!contexto && perfilDoPapel(contexto.role) === "dono");
}

/** Índice: cada seção com o que se faz nela. */
export function ListaDeSecoes({ secoes }: { secoes: readonly SecaoDeConfiguracoes[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" data-testid="secoes-configuracoes">
      {secoes.map((secao) => {
        const Icone = ICONE_DA_SECAO[secao.href] ?? UserRound;
        return (
          <li key={secao.href}>
            <Link
              href={secao.href}
              className="flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 text-ink hover:bg-paper-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Icone size={20} aria-hidden="true" className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{secao.rotulo}</span>
                <span className="block text-sm text-ink-soft">{secao.descricao}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-soft" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Menu lateral das subpáginas (só no computador). */
export function MenuDeSecoes({ secoes, pathname }: { secoes: readonly SecaoDeConfiguracoes[]; pathname: string | null }) {
  return (
    <nav aria-label="Seções de configurações" className="hidden md:block">
      <ul className="space-y-1">
        {secoes.map((secao) => {
          const Icone = ICONE_DA_SECAO[secao.href] ?? UserRound;
          const ativa = itemAtivo(pathname, secao.href);
          return (
            <li key={secao.href}>
              <Link
                href={secao.href}
                aria-current={ativa ? "page" : undefined}
                className={clsx(
                  "flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-medium",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                  ativa ? "bg-accent-soft text-ink" : "text-ink-soft hover:bg-paper-muted hover:text-ink",
                )}
              >
                <Icone size={16} aria-hidden="true" className="shrink-0" />
                {secao.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
