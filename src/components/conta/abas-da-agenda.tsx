"use client";

// Abas da Agenda do dono: "Atendimentos" (a agenda em si) e "Solicitações"
// (pedidos aguardando confirmação). São páginas próprias, com endereço
// próprio, para o sino e as notificações abrirem direto a aba certa.
//
// O contador é o do SolicitacoesProvider (layout de /conta), a MESMA lista
// do sino e dos avisos: nenhuma consulta nova. Sem lista carregada, nenhum
// número é afirmado.
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { CalendarDays, Inbox } from "lucide-react";
import { contagemVisivel, useSolicitacoesPendentes } from "@/lib/agendamento-publico/use-solicitacoes";
import { itemAtivo } from "@/lib/conta/navegacao";
import { ROTA_AGENDA, ROTA_SOLICITACOES } from "@/lib/conta/rotas";

export function AbasDaAgenda() {
  const pathname = usePathname();
  const { estado } = useSolicitacoesPendentes();
  const pendentes = contagemVisivel(estado);
  const naSolicitacao = itemAtivo(pathname, ROTA_SOLICITACOES);
  const abas = [
    { href: ROTA_AGENDA, rotulo: "Atendimentos", icone: CalendarDays, ativa: !naSolicitacao, contador: null },
    { href: ROTA_SOLICITACOES, rotulo: "Solicitações", icone: Inbox, ativa: naSolicitacao, contador: pendentes },
  ];
  return (
    <nav aria-label="Seções da agenda" data-testid="abas-da-agenda">
      <ul className="flex gap-1 border-b border-border">
        {abas.map(({ href, rotulo, icone: Icone, ativa, contador }) => (
          <li key={href} className="min-w-0 flex-1 sm:flex-none">
            <Link
              href={href}
              aria-current={ativa ? "page" : undefined}
              className={clsx(
                "-mb-px flex min-h-11 items-center justify-center gap-2 border-b-2 px-4 text-sm font-medium",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
                ativa
                  ? "border-[color:var(--color-accent)] text-ink"
                  : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              <Icone size={16} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{rotulo}</span>
              {!!contador && (
                <span
                  data-testid="contador-aba-solicitacoes"
                  className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-[11px] leading-5 font-semibold text-on-accent"
                >
                  {contador > 99 ? "99+" : contador}
                  <span className="sr-only"> {contador === 1 ? "solicitação pendente" : "solicitações pendentes"}</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
