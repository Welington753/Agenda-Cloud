// Moldura comum das páginas da área REAL: largura de conteúdo, espaçamento,
// título, descrição e o lugar do botão principal — iguais em toda a área.
//
// O estabelecimento ativo NÃO entra aqui: ele já aparece no menu
// (shell-conta.tsx), e repeti-lo em cada título só ocuparia espaço.
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface PaginaContaProps {
  titulo: string;
  descricao?: ReactNode;
  /** Botão principal da página, alinhado à direita do título no computador. */
  acoes?: ReactNode;
  /** Link de volta, para subpáginas (ex.: Horários de um profissional). */
  voltar?: { href: string; rotulo: string };
  children: ReactNode;
}

export function PaginaConta({ titulo, descricao, acoes, voltar, children }: PaginaContaProps) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="space-y-2">
        {voltar && (
          <Link
            href={voltar.href}
            className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--color-accent-hover)] hover:underline"
          >
            <ArrowLeft size={14} className="mr-1" aria-hidden="true" />
            {voltar.rotulo}
          </Link>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">{titulo}</h1>
            {descricao && <p className="mt-1 text-sm text-ink-soft">{descricao}</p>}
          </div>
          {acoes && <div className="flex shrink-0 flex-wrap gap-2">{acoes}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
