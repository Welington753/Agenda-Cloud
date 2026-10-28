// Itens do menu da área real (components/conta/shell-conta.tsx): o link de
// cada área, com ícone, marca de página atual e contador de pendentes, e as
// classes de item ativo e inativo.
import Link from "next/link";
import {
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Contact,
  Home,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import type { ItemNavegacaoConta } from "@/lib/conta/navegacao";
import { ROTA_ADMINISTRACAO } from "@/lib/administracao/rotas";
import {
  ROTA_AGENDA,
  ROTA_CLIENTES,
  ROTA_CONFIGURACOES,
  ROTA_INICIO,
  ROTA_MINHA_AGENDA,
  ROTA_PROFISSIONAIS,
  ROTA_SERVICOS,
} from "@/lib/conta/rotas";

export const ICONE_POR_HREF: Record<string, LucideIcon> = {
  [ROTA_INICIO]: Home,
  [ROTA_AGENDA]: CalendarDays,
  [ROTA_CLIENTES]: Contact,
  [ROTA_SERVICOS]: ClipboardList,
  [ROTA_PROFISSIONAIS]: Users,
  [ROTA_CONFIGURACOES]: Settings,
  [ROTA_MINHA_AGENDA]: CalendarCheck,
  [ROTA_ADMINISTRACAO]: ShieldCheck,
};

/** Colunas da barra inferior do celular: uma por área da barra.
 * Classes escritas por extenso para o Tailwind encontrá-las. */
export const COLUNAS_NO_CELULAR: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

export const CLASSE_ITEM = clsx(
  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[11px] leading-tight font-medium tracking-tight md:tracking-normal",
  "md:min-h-11 md:flex-row md:justify-start md:gap-3 md:rounded-[var(--radius-control)] md:px-3 md:text-left md:text-sm",
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-chrome-focus",
);
// Fundo + sombra interna, não borda: a regra global `* { border-color }` de
// globals.css venceria uma cor de borda utilitária.
export const CLASSE_ATIVO =
  "bg-chrome-selected font-semibold text-chrome-ink shadow-[inset_0_3px_0_var(--color-chrome-marker)] md:shadow-[inset_3px_0_0_var(--color-chrome-marker)]";
export const CLASSE_INATIVO = "text-chrome-ink-soft hover:bg-chrome-hover hover:text-chrome-ink";
/** Item em lista: linha inteira, ícone à esquerda, texto legível. */
const CLASSE_ITEM_EM_LISTA =
  "flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-chrome-focus";

/** Contador de pendentes ao lado do rótulo. Só aparece com número
 * positivo vindo do servidor; o texto oculto diz o que o número significa. */
function Contador({ total, naBarra }: { total: number | null | undefined; naBarra: boolean }) {
  if (!total) return null;
  return (
    <span
      data-testid="contador-solicitacoes"
      className={clsx(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-[11px] leading-5 font-semibold text-on-accent",
        // Na barra do celular, por cima do ícone (o rótulo continua inteiro).
        naBarra ? "absolute top-1 left-[calc(50%+4px)] md:static md:ml-auto" : "ml-auto",
      )}
    >
      {total > 99 ? "99+" : total}
      <span className="sr-only"> {total === 1 ? "solicitação pendente" : "solicitações pendentes"}</span>
    </span>
  );
}

export function LinkNavegacao({
  item,
  ativo,
  emLista = false,
  contador,
  className,
}: {
  item: ItemNavegacaoConta;
  ativo: boolean;
  emLista?: boolean;
  contador?: number | null;
  /** Classes extras (ex.: espaço para o botão do submenu de Configurações). */
  className?: string;
}) {
  const Icone = ICONE_POR_HREF[item.href] ?? Home;
  return (
    <Link
      href={item.href}
      aria-current={ativo ? "page" : undefined}
      className={clsx(
        emLista ? CLASSE_ITEM_EM_LISTA : clsx(CLASSE_ITEM, "relative"),
        ativo ? (emLista ? "bg-chrome-selected font-semibold text-chrome-ink" : CLASSE_ATIVO) : CLASSE_INATIVO,
        className,
      )}
    >
      <Icone size={20} aria-hidden="true" className="shrink-0 md:size-[18px]" />
      <span className={emLista ? undefined : "w-full truncate md:w-auto"}>{item.rotulo}</span>
      <Contador total={contador} naBarra={!emLista} />
    </Link>
  );
}
