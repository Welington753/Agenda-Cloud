"use client";

// Cabeçalho da área real: o sino "Notificações" e o menu da conta.
//
// - SINO: leva à análise das solicitações (/conta/solicitacoes). O número é
//   o do SolicitacoesProvider — a mesma lista do menu lateral, sem consulta
//   própria. Abrir o sino não confirma, recusa nem remarca nada.
// - MENU DA CONTA: quem está conectado, "Notificações" (pendentes, situação
//   neste aparelho e acesso aos controles que já existem na tela de
//   Solicitações), Aparência, Minha conta e Sair.
//   A situação do push é verificada UMA vez a cada abertura do menu
//   (lib/push/use-notificacoes-do-dispositivo.ts, o mesmo do cartão); nada
//   aqui pede permissão ao navegador nem ativa/desativa sozinho.
//
// O menu é um painel de divulgação (botão + região), não `role="menu"`: tem
// rádios e links, e o padrão de menu exigiria só itens de menu.
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Bell, ChevronRight, LogOut, Settings2, UserRound, Volume2, VolumeX } from "lucide-react";
import { rotuloDoSino } from "@/lib/conta/navegacao";
import { textoPendentes } from "@/lib/agendamento-publico/solicitacoes";
import { lerPreferenciaDeSom } from "@/lib/agendamento-publico/som-dos-avisos";
import { useNotificacoesDoDispositivo } from "@/lib/push/use-notificacoes-do-dispositivo";
import { resumoDoPush } from "@/lib/push/suporte";
import { SeletorAparencia } from "@/components/aparencia/aparencia";

const FOCO_NO_ESCURO = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white";

/** Iniciais para o avatar do botão do menu (até duas letras). */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const letras = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : (partes[0] ?? "").slice(0, 2);
  return letras.toLocaleUpperCase("pt-BR") || "?";
}

export function SinoNotificacoes({ pendentes }: { pendentes: number | null }) {
  return (
    <Link
      href="/conta/solicitacoes"
      aria-label={rotuloDoSino(pendentes)}
      data-testid="sino-notificacoes"
      className={clsx(
        "relative inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-white/80 hover:bg-white/5 hover:text-white",
        FOCO_NO_ESCURO,
      )}
    >
      <Bell size={20} aria-hidden="true" />
      {!!pendentes && (
        <span
          aria-hidden="true"
          data-testid="contador-notificacoes"
          className="absolute top-1 right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] leading-5 font-semibold text-on-accent"
        >
          {pendentes > 99 ? "99+" : pendentes}
        </span>
      )}
    </Link>
  );
}

/** Linhas "Neste aparelho" e "Som". Só montado com o menu aberto: a
 * verificação acontece ao abrir, uma vez. */
function SituacaoDoAparelho({ tenantId }: { tenantId: string }) {
  const { estado } = useNotificacoesDoDispositivo(tenantId);
  const resumo = resumoDoPush(estado.tipo);
  const [som] = useState(() => lerPreferenciaDeSom());
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
      <dt className="text-ink-soft">Neste aparelho</dt>
      <dd className="font-medium text-ink" data-testid="menu-push-estado" data-situacao={resumo.situacao}>
        {resumo.texto}
      </dd>
      <dt className="text-ink-soft">Som</dt>
      <dd className="flex items-center gap-1 font-medium text-ink" data-testid="menu-som">
        {som ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
        {som ? "Ligado neste navegador" : "Desligado"}
      </dd>
    </dl>
  );
}

const CLASSE_LINHA =
  "flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-2 text-sm font-medium text-ink hover:bg-paper-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

export function MenuConta({
  nome,
  email,
  tenantId,
  pendentes,
  saindo,
  aoSair,
}: {
  nome: string;
  email: string;
  /** Sem estabelecimento ativo (tela de escolha), não há notificações. */
  tenantId: string | null;
  pendentes: number | null;
  saindo: boolean;
  aoSair: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const raizRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const idPainel = useId();

  // Navegar fecha o menu.
  useEffect(() => setAberto(false), [pathname]);

  // Escape (devolvendo o foco ao botão) ou toque fora fecham.
  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key !== "Escape") return;
      setAberto(false);
      botaoRef.current?.focus();
    }
    function aoTocarFora(evento: PointerEvent) {
      if (!raizRef.current?.contains(evento.target as Node)) setAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("pointerdown", aoTocarFora);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("pointerdown", aoTocarFora);
    };
  }, [aberto]);

  return (
    <div ref={raizRef} className="relative md:w-full">
      <button
        ref={botaoRef}
        type="button"
        aria-expanded={aberto}
        aria-controls={idPainel}
        onClick={() => setAberto((a) => !a)}
        data-testid="abrir-menu-conta"
        className={clsx(
          "flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-1.5 text-left text-white hover:bg-white/5 md:w-full md:px-3 md:py-2",
          aberto && "bg-white/10",
          FOCO_NO_ESCURO,
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-xs font-semibold"
        >
          {iniciais(nome)}
        </span>
        <span className="sr-only">Menu da conta</span>
        <span className="hidden min-w-0 flex-1 md:block" data-testid="usuario-conectado">
          <span className="block text-xs text-white/60">Conectado como</span>
          <span className="block truncate text-sm font-medium">{nome}</span>
        </span>
        <Settings2 size={16} aria-hidden="true" className="hidden shrink-0 text-white/60 md:block" />
      </button>

      {aberto && (
        <div
          id={idPainel}
          role="region"
          aria-label="Menu da conta"
          data-testid="menu-conta"
          className={clsx(
            "absolute top-full right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-3 text-ink shadow-[var(--shadow-lift)]",
            "md:top-auto md:right-auto md:bottom-full md:left-0 md:mt-0 md:mb-2 md:w-80",
          )}
        >
          <div className="min-w-0 px-2">
            <p className="truncate text-sm font-semibold">{nome}</p>
            <p className="truncate text-xs text-ink-soft">{email}</p>
          </div>

          {tenantId && (
            <section aria-label="Notificações" className="space-y-2 border-t border-border pt-3">
              <Link href="/conta/solicitacoes" className={CLASSE_LINHA} data-testid="menu-notificacoes">
                <Bell size={18} aria-hidden="true" className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block">Notificações</span>
                  <span className="block text-xs font-normal text-ink-soft" data-testid="menu-pendentes">
                    {pendentes === null ? "Carregando solicitações…" : textoPendentes(pendentes)}
                  </span>
                </span>
                <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-soft" />
              </Link>
              <div className="px-2">
                <SituacaoDoAparelho tenantId={tenantId} />
              </div>
              <Link
                href="/conta/solicitacoes#notificacoes"
                className={clsx(CLASSE_LINHA, "text-[color:var(--color-accent-hover)]")}
                data-testid="menu-gerenciar-notificacoes"
              >
                Ativar ou desativar notificações e som
              </Link>
            </section>
          )}

          <div className="border-t border-border px-2 pt-3">
            <SeletorAparencia />
          </div>

          <div className="space-y-1 border-t border-border pt-2">
            <Link href="/conta" className={CLASSE_LINHA}>
              <UserRound size={18} aria-hidden="true" className="shrink-0 text-ink-soft" />
              Minha conta
            </Link>
            <button
              type="button"
              disabled={saindo}
              aria-busy={saindo}
              onClick={aoSair}
              className={clsx(CLASSE_LINHA, "w-full disabled:opacity-50")}
            >
              <LogOut size={18} aria-hidden="true" className="shrink-0 text-ink-soft" />
              Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
