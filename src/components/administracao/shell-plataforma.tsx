"use client";

// Estrutura do portal da plataforma (`/portal/**`): cabeçalho, menu e
// área central PRÓPRIOS, separados da operação dos estabelecimentos
// (components/conta/shell-conta.tsx). Reaproveita a sessão, a aparência e o
// "Sair" da área real, mas não tem atalho para a operação: o "Sair" e a
// sessão expirada levam à entrada do portal, não ao login da operação.
//
// O menu só aparece com o acesso confirmado pelo servidor
// (`GET /platform/access`); sem ele, a área central mostra a recusa e nada do
// portal é lido. Esconder o menu nunca substitui a autorização: cada leitura
// e escrita é recusada no servidor para quem não é proprietário da plataforma.
//
// Senha temporária: enquanto a sessão pedir a troca, a área central é só a
// troca de senha do portal (troca-de-senha-do-portal.tsx), sem menu.
//
// No celular o menu quebra linha em vez de rolar de lado.
import type { ReactNode } from "react";
import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { MarcaAgendaCloud } from "@/components/marca/marca";
import { SeletorAparencia } from "@/components/aparencia/aparencia";
import { useSair } from "@/components/conta/use-sair";
import { acessoConfirmado, useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { ROTA_ADMINISTRACAO } from "@/lib/administracao/rotas";
import { AbasAdministracao } from "./abas-administracao";
import { PortaoAdministracao } from "./acesso-administracao";
import { TrocaDeSenhaDoPortal } from "./troca-de-senha-do-portal";

const FOCO = "focus-visible:outline-2 focus-visible:outline-chrome-focus";

export function ShellPlataforma({ children }: { children: ReactNode }) {
  const { estado } = useRealAuth();
  const { estado: acesso } = useAcessoPlataforma();
  const { saindo, sair } = useSair(ROTA_ADMINISTRACAO);
  const sessao = estado.status === "autenticado" ? estado.sessao : null;
  const trocaObrigatoria = sessao?.user.mustChangePassword === true;
  const confirmado = acessoConfirmado(acesso) && !trocaObrigatoria;

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-chrome text-chrome-ink">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={ROTA_ADMINISTRACAO} className={`inline-flex rounded-[var(--radius-control)] ${FOCO}`}>
              <MarcaAgendaCloud />
            </Link>
            <p data-testid="portal-plataforma" className="flex min-w-0 items-center gap-1 text-sm font-semibold">
              <ShieldCheck size={16} aria-hidden="true" className="shrink-0" />
              <span className="truncate">Portal da plataforma</span>
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            {sessao && <span className="hidden max-w-[16rem] truncate text-chrome-ink-soft sm:inline">{sessao.user.name}</span>}
            <button
              type="button"
              onClick={() => void sair()}
              disabled={saindo}
              aria-busy={saindo}
              className={`inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-2 text-chrome-ink-soft hover:text-chrome-ink disabled:opacity-50 ${FOCO}`}
            >
              <LogOut size={16} aria-hidden="true" />
              Sair
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        {confirmado && (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <AbasAdministracao />
            <SeletorAparencia className="shrink-0" />
          </div>
        )}
        <main>
          {trocaObrigatoria ? <TrocaDeSenhaDoPortal /> : <PortaoAdministracao>{children}</PortaoAdministracao>}
        </main>
      </div>
    </div>
  );
}
