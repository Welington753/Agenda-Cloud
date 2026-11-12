"use client";

// Estrutura do portal da plataforma (`/portal/**`): menu lateral no
// computador e, no celular, barra superior com o botão "Menu" (seções
// recolhíveis) e o menu do usuário (aparência e "Sair"). Separado da operação
// dos estabelecimentos (components/conta/shell-conta.tsx): reaproveita a
// sessão, a aparência e o "Sair" da área real, mas não tem atalho para a
// operação. O "Sair" e a sessão expirada levam à entrada do portal.
//
// Seções e menu do usuário existem UMA vez no DOM e só mudam de lugar com CSS
// (grade no celular, coluna no computador). No celular, fechadas, as seções
// ficam em `display: none` (fora da árvore de acessibilidade). Abrir uma
// seção ou apertar Escape fecha o menu.
//
// As seções só aparecem com o acesso confirmado pelo servidor
// (`GET /platform/access`); sem ele, a área central mostra a recusa e nada do
// portal é lido. Esconder o menu nunca substitui a autorização: cada leitura
// e escrita é recusada no servidor para quem não é proprietário da plataforma.
// O menu do usuário aparece sempre, inclusive na recusa.
//
// Senha temporária: enquanto a sessão pedir a troca, a área central é só a
// troca de senha do portal (troca-de-senha-do-portal.tsx), sem seções.
import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Menu, ShieldCheck, X } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { identificacaoDaConta } from "@/lib/api/auth-api";
import { MarcaTimVix } from "@/components/marca/marca";
import { useSair } from "@/components/conta/use-sair";
import { acessoConfirmado, useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { ROTA_ADMINISTRACAO } from "@/lib/administracao/rotas";
import { AbasAdministracao } from "./abas-administracao";
import { MenuUsuarioPortal } from "./menu-usuario-portal";
import { PortaoAdministracao } from "./acesso-administracao";
import { TrocaDeSenhaDoPortal } from "./troca-de-senha-do-portal";

const FOCO = "focus-visible:outline-2 focus-visible:outline-chrome-focus";

export function ShellPlataforma({ children }: { children: ReactNode }) {
  const { estado } = useRealAuth();
  const { estado: acesso } = useAcessoPlataforma();
  const { saindo, sair } = useSair(ROTA_ADMINISTRACAO);
  const pathname = usePathname();
  const idSecoes = useId();
  const [menuAberto, setMenuAberto] = useState(false);
  const sessao = estado.status === "autenticado" ? estado.sessao : null;
  const trocaObrigatoria = sessao?.user.mustChangePassword === true;
  const confirmado = acessoConfirmado(acesso) && !trocaObrigatoria;

  useEffect(() => setMenuAberto(false), [pathname]);
  useEffect(() => {
    if (!menuAberto) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setMenuAberto(false);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [menuAberto]);

  return (
    <div className="min-h-screen bg-paper">
      <aside className="sticky top-0 z-30 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1 bg-chrome px-4 py-3 text-chrome-ink md:fixed md:inset-y-0 md:left-0 md:flex md:w-64 md:flex-col md:items-stretch md:gap-0 md:p-0">
        <div className="col-start-1 row-start-1 min-w-0 md:px-5 md:py-6">
          <Link href={ROTA_ADMINISTRACAO} className={`inline-flex rounded-[var(--radius-control)] ${FOCO}`}>
            <MarcaTimVix />
          </Link>
          <p
            data-testid="portal-plataforma"
            className="flex min-w-0 items-center gap-1 text-xs font-semibold text-chrome-ink-soft md:mt-1 md:text-sm md:text-chrome-ink"
          >
            <ShieldCheck size={16} aria-hidden="true" className="shrink-0" />
            <span className="truncate">Portal da plataforma</span>
          </p>
        </div>

        {confirmado && (
          <button
            type="button"
            aria-expanded={menuAberto}
            aria-controls={idSecoes}
            onClick={() => setMenuAberto((a) => !a)}
            data-testid="abrir-menu-portal"
            className={clsx(
              "col-start-2 row-start-1 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-medium text-chrome-ink hover:bg-chrome-hover md:hidden",
              menuAberto && "bg-chrome-selected",
              FOCO,
            )}
          >
            {menuAberto ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            Menu
          </button>
        )}

        {confirmado && (
          <AbasAdministracao
            id={idSecoes}
            className={clsx(
              "col-span-3 row-start-2 -mx-4 mt-3 border-t border-chrome-border px-3 pt-3 md:mx-0 md:mt-0 md:block md:flex-1 md:overflow-y-auto md:border-0 md:pt-0",
              menuAberto ? "block" : "hidden",
            )}
          />
        )}

        {/* Celular: canto da barra superior. Computador: rodapé do menu. */}
        {sessao && (
          <div className="col-start-3 row-start-1 md:mt-auto md:border-t md:border-chrome-border md:px-3 md:py-4">
            <MenuUsuarioPortal
              nome={sessao.user.name}
              identificacao={identificacaoDaConta(sessao.user)}
              saindo={saindo}
              aoSair={() => void sair()}
            />
          </div>
        )}
      </aside>

      <main className="px-4 py-6 sm:px-6 md:ml-64 md:py-8 lg:px-8">
        <div className="mx-auto w-full max-w-6xl">
          {trocaObrigatoria ? <TrocaDeSenhaDoPortal /> : <PortaoAdministracao>{children}</PortaoAdministracao>}
        </div>
      </main>
    </div>
  );
}
