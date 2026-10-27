"use client";

// Moldura das subpáginas de Configurações. No computador, o menu das seções
// fica ao lado do conteúdo; no celular, um link de volta para o índice (a
// tela é estreita demais para os dois). No próprio índice não há menu: ele já
// é a lista das seções.
//
// Cada subpágina continua sendo a tela que já existia (Serviços,
// Profissionais, Equipe e acessos...), com as mesmas leituras e regras.
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MenuDeSecoes, useSecoesDeConfiguracoes } from "@/components/conta/configuracoes";
import { ROTA_CONFIGURACOES } from "@/lib/conta/rotas";

export default function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const secoes = useSecoesDeConfiguracoes();
  const noIndice = (pathname ?? "").replace(/\/+$/, "") === ROTA_CONFIGURACOES;

  if (noIndice) return <>{children}</>;

  return (
    <div className="mx-auto w-full max-w-6xl md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8">
      <div>
        <Link
          href={ROTA_CONFIGURACOES}
          className="mb-2 inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--color-accent-hover)] hover:underline md:hidden"
        >
          <ArrowLeft size={14} className="mr-1" aria-hidden="true" />
          Configurações
        </Link>
        <p className="mb-2 hidden px-3 text-[11px] font-semibold tracking-wider text-ink-soft uppercase md:block">
          Configurações
        </p>
        <MenuDeSecoes secoes={secoes} pathname={pathname} />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
