// Itens do menu da área real (components/conta/shell-conta.tsx): o link de
// cada área, com ícone, marca de página atual e contador de pendentes, e as
// classes que o botão "Mais" do celular também usa.
import Link from "next/link";
import {
  CalendarDays,
  ClipboardList,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Contact,
  ShieldCheck,
  UserRound,
  Users,
  CalendarCheck,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import type { ItemNavegacaoConta } from "@/lib/conta/navegacao";
import { ROTA_ADMINISTRACAO } from "@/lib/administracao/rotas";
import { ROTA_EQUIPE, ROTA_MINHA_AGENDA } from "@/lib/conta/papel";

const ICONE_POR_HREF: Record<string, LucideIcon> = {
  "/conta/visao-geral": LayoutDashboard,
  "/conta/agendamentos": CalendarDays,
  "/conta/solicitacoes": Inbox,
  "/conta/clientes": Contact,
  "/conta/servicos": ClipboardList,
  "/conta/profissionais": Users,
  [ROTA_EQUIPE]: KeyRound,
  [ROTA_MINHA_AGENDA]: CalendarCheck,
  "/conta": UserRound,
  [ROTA_ADMINISTRACAO]: ShieldCheck,
};

/** Colunas da barra inferior do celular: as áreas da barra mais o "Mais",
 * quando há. Classes escritas por extenso para o Tailwind encontrá-las. */
export const COLUNAS_NO_CELULAR: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

export const CLASSE_ITEM = clsx(
  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-center text-[11px] leading-tight font-medium",
  "md:min-h-11 md:flex-row md:justify-start md:gap-3 md:rounded-[var(--radius-control)] md:px-3 md:text-left md:text-sm",
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white",
);
// Fundo + sombra interna, não borda: a regra global `* { border-color }` de
// globals.css venceria uma cor de borda utilitária.
export const CLASSE_ATIVO =
  "bg-white/10 font-semibold text-white shadow-[inset_0_3px_0_var(--color-accent)] md:shadow-[inset_3px_0_0_var(--color-accent)]";
export const CLASSE_INATIVO = "text-white/70 hover:bg-white/5 hover:text-white";
/** Item dentro do menu "Mais": linha inteira, ícone à esquerda, texto legível. */
const CLASSE_ITEM_EM_LISTA =
  "flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white";

/** Contador de pendentes ao lado do rótulo. Só aparece com número
 * positivo vindo do servidor; o texto oculto diz o que o número significa. */
function Contador({ total }: { total: number | null | undefined }) {
  if (!total) return null;
  return (
    <span
      data-testid="contador-solicitacoes"
      className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-[11px] leading-5 font-semibold text-on-accent"
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
}: {
  item: ItemNavegacaoConta;
  ativo: boolean;
  emLista?: boolean;
  contador?: number | null;
}) {
  const Icone = ICONE_POR_HREF[item.href] ?? LayoutDashboard;
  return (
    <Link
      href={item.href}
      aria-current={ativo ? "page" : undefined}
      className={clsx(
        emLista ? CLASSE_ITEM_EM_LISTA : CLASSE_ITEM,
        ativo ? (emLista ? "bg-white/10 font-semibold text-white" : CLASSE_ATIVO) : CLASSE_INATIVO,
      )}
    >
      <Icone size={20} aria-hidden="true" className="shrink-0 md:size-[18px]" />
      <span className={emLista ? undefined : "w-full truncate md:w-auto"}>{item.rotulo}</span>
      <Contador total={contador} />
    </Link>
  );
}
