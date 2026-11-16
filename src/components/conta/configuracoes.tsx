"use client";

// Peças comuns de Configurações: quais seções esta sessão usa, o ícone de
// cada uma e a lista de seções do índice (no celular e no computador). O
// submenu do menu lateral (item-configuracoes.tsx) usa as mesmas seções e
// ícones. O índice agrupa por assunto (Estabelecimento, Financeiro e Sua
// conta). As seções do estabelecimento só aparecem para o dono com
// estabelecimento ativo; o servidor continua recusando as rotas delas a
// qualquer outro papel.
import Link from "next/link";
import { Bell, ChevronRight, Palette, Store, UserRound, Wallet, type LucideIcon } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { perfilDoPapel } from "@/lib/conta/papel";
import {
  ROTA_APARENCIA,
  ROTA_CONFIG_ESTABELECIMENTO,
  ROTA_NOTIFICACOES,
  ROTA_PERFIL,
  ROTA_RECEBIMENTOS,
  agruparSecoes,
  secoesDisponiveis,
  type SecaoDeConfiguracoes,
} from "@/lib/conta/rotas";

const ICONE_DA_SECAO: Record<string, LucideIcon> = {
  [ROTA_CONFIG_ESTABELECIMENTO]: Store,
  [ROTA_NOTIFICACOES]: Bell,
  [ROTA_RECEBIMENTOS]: Wallet,
  [ROTA_APARENCIA]: Palette,
  [ROTA_PERFIL]: UserRound,
};

export function iconeDaSecao(href: string): LucideIcon {
  return ICONE_DA_SECAO[href] ?? UserRound;
}

/** Seções que esta sessão usa (dono com estabelecimento ativo: todas). */
export function useSecoesDeConfiguracoes(): readonly SecaoDeConfiguracoes[] {
  const { estado } = useRealAuth();
  if (estado.status !== "autenticado") return [];
  const contexto = estado.tenantIdAtivo ? encontrarContextoPorTenantId(estado.sessao, estado.tenantIdAtivo) : null;
  return secoesDisponiveis(!!contexto && perfilDoPapel(contexto.role) === "dono");
}

/** Índice: as seções agrupadas por assunto, cada uma com o que se faz nela. */
export function ListaDeSecoes({ secoes }: { secoes: readonly SecaoDeConfiguracoes[] }) {
  return (
    <div className="space-y-8" data-testid="secoes-configuracoes">
      {agruparSecoes(secoes).map((grupo) => (
        <section key={grupo.grupo} aria-labelledby={`grupo-${grupo.grupo}`} data-testid={`grupo-${grupo.grupo}`}>
          <h2 id={`grupo-${grupo.grupo}`} className="mb-3 text-sm font-semibold tracking-wide text-ink-soft uppercase">
            {grupo.titulo}
          </h2>
          <GradeDeSecoes secoes={grupo.secoes} />
        </section>
      ))}
    </div>
  );
}

function GradeDeSecoes({ secoes }: { secoes: readonly SecaoDeConfiguracoes[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {secoes.map((secao) => {
        const Icone = iconeDaSecao(secao.href);
        return (
          <li key={secao.href}>
            <Link
              href={secao.href}
              className="flex h-full min-h-20 items-center gap-4 rounded-[var(--radius-card)] border border-border bg-card p-4 text-ink shadow-[var(--shadow-soft)] hover:border-border-control hover:bg-paper-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-accent-soft text-accent"
              >
                <Icone size={20} />
              </span>
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
