"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, X, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/lib/auth/auth-context";
import { NOME_PRODUTO } from "@/lib/config";

export interface ItemNavegacao {
  href: string;
  rotulo: string;
  icone: LucideIcon;
}

interface AdminShellProps {
  itens: ItemNavegacao[];
  subtitulo: string;
  children: ReactNode;
}

export function AdminShell({ itens, subtitulo, children }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { usuario, sair } = useAuth();
  const [menuAberto, setMenuAberto] = useState(false);

  function aoSair() {
    sair();
    router.push("/login");
  }

  const conteudoNav = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {itens.map((item) => {
        const ativo = pathname === item.href;
        const Icone = item.icone;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMenuAberto(false)}
            className={clsx(
              "flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-medium transition-colors",
              ativo ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
            )}
          >
            <Icone size={18} />
            {item.rotulo}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Sidebar desktop */}
      <aside className="hidden w-64 shrink-0 flex-col bg-ink text-white md:flex">
        <div className="px-5 py-6">
          <p className="font-bold tracking-tight">{NOME_PRODUTO}</p>
          <p className="text-xs text-white/60">{subtitulo}</p>
        </div>
        {conteudoNav}
        <RodapeUsuario usuarioNome={usuario?.nome} onSair={aoSair} />
      </aside>

      {/* Topbar mobile */}
      <div className="flex items-center justify-between border-b border-border bg-ink px-4 py-3 text-white md:hidden">
        <div>
          <p className="font-bold leading-none">{NOME_PRODUTO}</p>
          <p className="text-xs text-white/60">{subtitulo}</p>
        </div>
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={() => setMenuAberto(true)}
          className="rounded-md p-2 hover:bg-white/10"
        >
          <Menu size={22} />
        </button>
      </div>

      {menuAberto && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMenuAberto(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-ink text-white shadow-xl">
            <div className="flex items-center justify-between px-5 py-6">
              <div>
                <p className="font-bold tracking-tight">{NOME_PRODUTO}</p>
                <p className="text-xs text-white/60">{subtitulo}</p>
              </div>
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => setMenuAberto(false)}
                className="rounded-md p-2 hover:bg-white/10"
              >
                <X size={20} />
              </button>
            </div>
            {conteudoNav}
            <RodapeUsuario usuarioNome={usuario?.nome} onSair={aoSair} />
          </div>
        </div>
      )}

      <main className="flex-1 bg-paper px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

function RodapeUsuario({
  usuarioNome,
  onSair,
}: {
  usuarioNome?: string;
  onSair: () => void;
}) {
  return (
    <div className="mt-auto space-y-1 border-t border-white/10 px-3 py-4">
      <div className="px-3 py-1 text-xs text-white/50">Logado como</div>
      <div className="px-3 pb-2 text-sm font-medium text-white">{usuarioNome ?? "—"}</div>
      <button
        type="button"
        onClick={onSair}
        className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white"
      >
        <LogOut size={16} />
        Sair
      </button>
    </div>
  );
}
