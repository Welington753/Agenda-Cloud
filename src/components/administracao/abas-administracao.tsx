"use client";

// Seções do portal da plataforma, em lista vertical: no menu lateral do
// computador e no menu recolhível do celular (shell-plataforma.tsx). O
// mesmo elemento serve aos dois tamanhos: links duplicados confundiriam
// leitor de tela e localizadores.
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  Building2,
  CreditCard,
  History,
  LayoutDashboard,
  Mail,
  ShieldCheck,
  Tags,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  ROTA_CONVITES,
  ROTA_ESTABELECIMENTOS_ADMINISTRADOS,
  ROTA_HISTORICO,
  ROTA_PAGAMENTOS_ASSINATURAS,
  ROTA_PAPEIS,
  ROTA_PLANOS_E_PRECOS,
  ROTA_USUARIOS,
  ROTA_VISAO_GERAL,
  SECOES_ADMINISTRACAO,
  secaoAtiva,
} from "@/lib/administracao/rotas";

const ICONE: Record<string, LucideIcon> = {
  [ROTA_VISAO_GERAL]: LayoutDashboard,
  [ROTA_ESTABELECIMENTOS_ADMINISTRADOS]: Building2,
  [ROTA_USUARIOS]: UsersRound,
  [ROTA_CONVITES]: Mail,
  [ROTA_PLANOS_E_PRECOS]: Tags,
  [ROTA_PAGAMENTOS_ASSINATURAS]: CreditCard,
  [ROTA_PAPEIS]: ShieldCheck,
  [ROTA_HISTORICO]: History,
};

export function AbasAdministracao({ id, className }: { id?: string; className?: string }) {
  const pathname = usePathname();
  return (
    <nav id={id} aria-label="Seções do portal" className={className}>
      <ul className="flex flex-col gap-1">
        {SECOES_ADMINISTRACAO.map((secao) => {
          const ativa = secaoAtiva(pathname, secao.href);
          const Icone = ICONE[secao.href] ?? Building2;
          return (
            <li key={secao.href}>
              <Link
                href={secao.href}
                aria-current={ativa ? "page" : undefined}
                className={clsx(
                  "flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-chrome-focus",
                  ativa
                    ? "bg-chrome-selected font-semibold text-chrome-ink shadow-[inset_3px_0_0_var(--color-chrome-marker)]"
                    : "text-chrome-ink-soft hover:bg-chrome-hover hover:text-chrome-ink",
                )}
              >
                <Icone size={18} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 break-words">{secao.rotulo}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
