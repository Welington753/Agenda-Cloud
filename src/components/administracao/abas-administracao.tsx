"use client";

// Seções do portal da plataforma, em lista vertical: no menu lateral do
// computador e no menu recolhível do celular (shell-plataforma.tsx). O
// mesmo elemento serve aos dois tamanhos: links duplicados confundiriam
// leitor de tela e localizadores.
//
// Agrupadas por assunto (GRUPOS_SECOES_ADMINISTRACAO). O título e a linha
// entre grupos só aparecem no tema "Azul e branco" (`azul:`); nos outros
// temas os grupos ficam colados, com o mesmo espaço entre itens, e o menu
// continua igual a uma coluna única.
import { useId } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  BarChart3,
  Building2,
  CreditCard,
  History,
  LayoutDashboard,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Tags,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  GRUPOS_SECOES_ADMINISTRACAO,
  ROTA_CONVITES,
  ROTA_ESTABELECIMENTOS_ADMINISTRADOS,
  ROTA_HISTORICO,
  ROTA_PAGAMENTOS_ASSINATURAS,
  ROTA_PAPEIS,
  ROTA_PLANOS_E_PRECOS,
  ROTA_RELATORIOS,
  ROTA_SEGURANCA,
  ROTA_USUARIOS,
  ROTA_VISAO_GERAL,
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

/** Ícones que só o tema azul usa: nos outros temas essas seções continuam
 * com o ícone de sempre (Building2). */
const ICONE_AZUL: Partial<Record<string, LucideIcon>> = {
  [ROTA_RELATORIOS]: BarChart3,
  [ROTA_SEGURANCA]: LockKeyhole,
};

export function AbasAdministracao({ id, className }: { id?: string; className?: string }) {
  const pathname = usePathname();
  const base = useId();
  return (
    <nav id={id} aria-label="Seções do portal" className={className}>
      <div className="flex flex-col gap-1 azul:gap-3">
        {GRUPOS_SECOES_ADMINISTRACAO.map((grupo, indice) => {
          const idTitulo = `${base}-grupo-${indice}`;
          return (
            <div key={grupo.titulo ?? "inicio"} className={clsx(indice > 0 && "azul:border-t azul:border-chrome-border azul:pt-3")}>
              {grupo.titulo && (
                <p
                  id={idTitulo}
                  className="mb-1 hidden px-3 text-[11px] font-semibold tracking-wider text-chrome-ink-soft uppercase azul:block"
                >
                  {grupo.titulo}
                </p>
              )}
              <ul className="flex flex-col gap-1" aria-labelledby={grupo.titulo ? idTitulo : undefined}>
                {grupo.secoes.map((secao) => {
                  const ativa = secaoAtiva(pathname, secao.href);
                  const Icone = ICONE[secao.href] ?? Building2;
                  const IconeAzul = ICONE_AZUL[secao.href];
                  return (
                    <li key={secao.href}>
                      <Link
                        href={secao.href}
                        aria-current={ativa ? "page" : undefined}
                        className={clsx(
                          "flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium",
                          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-chrome-focus",
                          ativa
                            ? "bg-chrome-selected font-semibold text-chrome-ink shadow-[inset_3px_0_0_var(--color-chrome-marker)] azul:text-[color:var(--color-accent-hover)]"
                            : "text-chrome-ink-soft hover:bg-chrome-hover hover:text-chrome-ink",
                        )}
                      >
                        <Icone size={18} aria-hidden="true" className={clsx("shrink-0", IconeAzul && "azul:hidden")} />
                        {IconeAzul && <IconeAzul size={18} aria-hidden="true" className="hidden shrink-0 azul:block" />}
                        <span className="min-w-0 break-words">{secao.rotulo}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
