"use client";

// Seções da administração, dentro da área central (o menu principal da conta
// continua o mesmo). No celular as abas quebram linha em vez de rolar de lado.
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { SECOES_ADMINISTRACAO, secaoAtiva } from "@/lib/administracao/rotas";

export function AbasAdministracao() {
  const pathname = usePathname();
  return (
    <nav aria-label="Seções da administração">
      <ul className="flex flex-wrap gap-2">
        {SECOES_ADMINISTRACAO.map((secao) => {
          const ativa = secaoAtiva(pathname, secao.href);
          return (
            <li key={secao.href}>
              <Link
                href={secao.href}
                aria-current={ativa ? "page" : undefined}
                className={clsx(
                  "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium",
                  ativa
                    ? "border-transparent bg-accent text-on-accent"
                    : "border-border bg-card text-ink hover:bg-paper-muted",
                )}
              >
                {secao.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
