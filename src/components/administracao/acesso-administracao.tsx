"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Building2, LogOut } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { ehAcesso } from "@/lib/administracao/contratos";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { EstadoLeitura } from "./estado-leitura";
import { Botao } from "@/components/ui/button";
import { NOME_PRODUTO } from "@/lib/config";
import { useToast } from "@/components/ui/toast";
import { encerrarNoDispositivo } from "@/lib/push/dispositivo";

export function LinkAdministracao() {
  const { estado } = useLeituraPlataforma("/platform/access", ehAcesso);
  if (estado.status !== "pronto" || !estado.dados.canViewEstablishments)
    return null;
  return (
    <Link
      href="/administracao"
      className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent hover:underline"
    >
      <ShieldCheck size={18} aria-hidden="true" /> Administração da plataforma
    </Link>
  );
}

export function AcessoAdministracao({ children }: { children: ReactNode }) {
  const { estado, recarregar } = useLeituraPlataforma(
    "/platform/access",
    ehAcesso,
  );
  const { estado: auth, logout } = useRealAuth();
  const [saindo, setSaindo] = useState(false);
  const { notificar } = useToast();
  const trava = useRef(false);
  const router = useRouter();
  async function sair() {
    if (trava.current) return;
    trava.current = true;
    setSaindo(true);
    try {
      await encerrarNoDispositivo(
        auth.status === "autenticado" ? auth.tenantIdAtivo : null,
      );
      const result = await logout();
      notificar(
        result.confirmadoPeloServidor
          ? "Sessão encerrada."
          : "Não foi possível confirmar o encerramento com o servidor. Você saiu apenas neste dispositivo.",
        result.confirmadoPeloServidor ? "sucesso" : "info",
      );
      router.replace("/login?next=%2Fadministracao");
    } finally {
      trava.current = false;
      setSaindo(false);
    }
  }
  if (estado.status !== "pronto")
    return (
      <main className="mx-auto w-full max-w-2xl p-5">
        <EstadoLeitura estado={estado} recarregar={recarregar} />
      </main>
    );
  if (!estado.dados.canViewEstablishments)
    return (
      <main className="mx-auto w-full max-w-2xl p-5">
        <EstadoLeitura
          estado={{ status: "erro", motivo: "permissao" }}
          recarregar={recarregar}
        />
      </main>
    );
  return (
    <div className="min-h-screen bg-paper md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b border-border bg-card p-4 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0 md:p-6">
        <Link
          href="/administracao"
          className="flex items-center gap-2 text-lg font-bold"
        >
          <ShieldCheck className="text-accent" aria-hidden="true" size={24} />
          {NOME_PRODUTO}
        </Link>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">
          Administração da plataforma
        </p>
        <nav
          aria-label="Administração"
          className="mt-5 flex flex-wrap gap-2 md:flex-col"
        >
          <Link
            href="/administracao/estabelecimentos"
            aria-current="page"
            className="flex min-h-11 items-center gap-2 rounded-lg bg-accent-soft px-3 text-sm font-semibold"
          >
            <Building2 size={18} aria-hidden="true" />
            Estabelecimentos
          </Link>
          <Link
            href="/conta"
            className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-paper-muted"
          >
            Minha conta
          </Link>
        </nav>
        <div className="mt-4 flex items-center gap-3 md:mt-10 md:flex-col md:items-start">
          <p className="min-w-0 break-words text-sm text-ink-soft">
            {auth.status === "autenticado" ? auth.sessao.user.name : ""}
          </p>
          <Botao
            variante="fantasma"
            onClick={() => {
              void sair();
            }}
            disabled={saindo}
            className="min-h-11"
          >
            <LogOut size={16} aria-hidden="true" />
            {saindo ? "Saindo…" : "Sair"}
          </Botao>
        </div>
      </aside>
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
