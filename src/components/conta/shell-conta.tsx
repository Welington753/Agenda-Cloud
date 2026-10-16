"use client";

// Estrutura comum da área REAL (`/conta/**`): menu lateral no computador
// (inspirado no da demonstração) e, no celular, barra superior com o
// estabelecimento e "Sair" mais uma barra inferior com as cinco áreas — sem
// menu escondido e sem rolagem horizontal.
//
// A navegação, o estabelecimento e o "Sair" existem UMA vez no DOM e só mudam
// de lugar com CSS: links duplicados (um por tamanho de tela) confundiriam
// leitor de tela e localizadores. A única exceção é "Trocar", que tem uma
// forma por tamanho, com a outra em `display: none` (fora da árvore de
// acessibilidade).
//
// Só LÊ a sessão que `RequireRealSession` já validou (via `useRealAuth`): a
// única requisição própria é o logout, com o mesmo comportamento de antes. O
// estabelecimento exibido é o contexto ATIVO da sessão, escolhido entre os
// vínculos que o backend devolveu — nunca um id vindo da URL. A navegação só
// aparece quando há um estabelecimento ativo: antes da escolha (quem tem mais
// de um vínculo) as páginas nem teriam o que mostrar.
//
// Nada aqui importa a demonstração (`AdminShell` usa a sessão simulada): é
// por isso que este shell é próprio, e não uma variação daquele.
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Repeat,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { ITENS_NAVEGACAO_CONTA, itemAtivo } from "@/lib/conta/navegacao";
import { NOME_PRODUTO } from "@/lib/config";
import { useToast } from "@/components/ui/toast";

const ICONE_POR_HREF: Record<string, LucideIcon> = {
  "/conta/visao-geral": LayoutDashboard,
  "/conta/agendamentos": CalendarDays,
  "/conta/servicos": ClipboardList,
  "/conta/profissionais": Users,
  "/conta": UserRound,
};

/** Classe no `<html>` enquanto o shell está montado: sobe as notificações no
 * celular para não cobrirem a barra inferior (ver globals.css). */
const CLASSE_SHELL_ATIVO = "shell-conta-ativo";

export function ShellConta({ children }: { children: ReactNode }) {
  const { estado, logout } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  // Barreira contra clique duplo no "Sair" enquanto o logout está em voo.
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add(CLASSE_SHELL_ATIVO);
    return () => document.documentElement.classList.remove(CLASSE_SHELL_ATIVO);
  }, []);

  if (estado.status !== "autenticado") return <>{children}</>;

  const { sessao, tenantIdAtivo } = estado;
  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;
  const podeTrocar = sessao.contexts.length > 1;

  async function aoSair() {
    if (saindo) return;
    setSaindo(true);
    const resultado = await logout();
    notificar(
      resultado.confirmadoPeloServidor
        ? "Sessão encerrada."
        : "Não foi possível confirmar o encerramento com o servidor. Você saiu apenas neste dispositivo.",
      resultado.confirmadoPeloServidor ? "sucesso" : "info",
    );
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-paper">
      <aside className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-ink px-4 py-3 text-white md:fixed md:inset-y-0 md:left-0 md:w-64 md:flex-col md:items-stretch md:justify-start md:gap-0 md:p-0">
        {/* Marca e estabelecimento ativo */}
        <div className="min-w-0 md:px-5 md:py-6">
          <Link
            href="/conta/visao-geral"
            className="font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-white"
          >
            {NOME_PRODUTO}
          </Link>
          {contexto && (
            <p
              className="truncate text-xs text-white/70 md:mt-1 md:text-sm md:text-white"
              data-testid="estabelecimento-ativo"
            >
              {contexto.tenantName}
            </p>
          )}
          {podeTrocar && (
            <Link
              href="/conta/selecionar-estabelecimento"
              className="hidden min-h-11 items-center text-xs text-white/70 hover:text-white focus-visible:outline-2 focus-visible:outline-white md:inline-flex"
            >
              <Repeat size={14} className="mr-1.5" aria-hidden="true" />
              Trocar
              <span className="sr-only"> de estabelecimento</span>
            </Link>
          )}
        </div>

        {contexto && (
          <nav
            aria-label="Áreas da conta"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink pb-[env(safe-area-inset-bottom)] md:static md:flex-1 md:border-0 md:px-3 md:pb-0"
          >
            <ul className="grid grid-cols-5 md:flex md:flex-col md:gap-1">
              {ITENS_NAVEGACAO_CONTA.map((item) => {
                const ativo = itemAtivo(pathname, item.href);
                const Icone = ICONE_POR_HREF[item.href] ?? LayoutDashboard;
                return (
                  <li key={item.href} className="min-w-0">
                    <Link
                      href={item.href}
                      aria-current={ativo ? "page" : undefined}
                      className={clsx(
                        "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-center text-[11px] leading-tight font-medium",
                        "md:min-h-11 md:flex-row md:justify-start md:gap-3 md:rounded-[var(--radius-control)] md:px-3 md:text-left md:text-sm",
                        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white",
                        // Fundo + sombra interna, não borda: a regra global
                        // `* { border-color }` de globals.css venceria uma cor
                        // de borda utilitária.
                        ativo
                          ? "bg-white/10 font-semibold text-white shadow-[inset_0_3px_0_var(--color-accent)] md:shadow-[inset_3px_0_0_var(--color-accent)]"
                          : "text-white/70 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icone size={20} aria-hidden="true" className="shrink-0 md:size-[18px]" />
                      <span className="w-full truncate md:w-auto">{item.rotulo}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {/* Usuário e Sair: no rodapé do menu no computador, no canto da barra
            superior no celular. */}
        <div className="flex shrink-0 items-center gap-1 md:mt-auto md:block md:space-y-1 md:border-t md:border-white/10 md:px-3 md:py-4">
          {podeTrocar && (
            <Link
              href="/conta/selecionar-estabelecimento"
              aria-label="Trocar de estabelecimento"
              className="inline-flex size-11 items-center justify-center rounded-[var(--radius-control)] text-white/80 hover:text-white focus-visible:outline-2 focus-visible:outline-white md:hidden"
            >
              <Repeat size={18} aria-hidden="true" />
            </Link>
          )}
          <div className="hidden px-3 md:block" data-testid="usuario-conectado">
            <p className="text-xs text-white/50">Conectado como</p>
            <p className="truncate text-sm font-medium text-white">{sessao.user.name}</p>
          </div>
          <button
            type="button"
            disabled={saindo}
            aria-busy={saindo}
            onClick={() => void aoSair()}
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm text-white/80 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50 md:w-full"
          >
            <LogOut size={16} aria-hidden="true" />
            Sair
          </button>
        </div>
      </aside>

      <main
        className={clsx(
          "px-4 py-6 sm:px-6 md:ml-64 md:py-8 lg:px-8",
          // Espaço para a barra inferior do celular não cobrir o fim da página.
          contexto ? "pb-28 md:pb-8" : undefined,
        )}
      >
        {children}
      </main>
    </div>
  );
}
