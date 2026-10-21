"use client";

// Estrutura comum da área REAL (`/conta/**`): menu lateral no computador
// (inspirado no da demonstração) e, no celular, barra superior com o
// estabelecimento e "Sair" mais uma barra inferior com quatro áreas e um
// botão "Mais" (Profissionais e Minha conta) — seis rótulos lado a lado em
// 360 px ficariam ilegíveis. Sem rolagem horizontal.
//
// A navegação, o estabelecimento e o "Sair" existem UMA vez no DOM e só mudam
// de lugar com CSS: links duplicados (um por tamanho de tela) confundiriam
// leitor de tela e localizadores. As exceções são "Trocar", que tem uma forma
// por tamanho, e os itens do "Mais", que no celular saem da barra e só
// aparecem no menu aberto — em ambos a outra forma fica em `display: none`
// (fora da árvore de acessibilidade).
//
// Só LÊ a sessão que `RequireRealSession` já validou (via `useRealAuth`): a
// única requisição própria é o logout, com o mesmo comportamento de antes. O
// estabelecimento exibido é o contexto ATIVO da sessão, escolhido entre os
// vínculos que o backend devolveu — nunca um id vindo da URL. A navegação só
// aparece quando há um estabelecimento ativo: antes da escolha (quem tem mais
// de um vínculo) as páginas nem teriam o que mostrar.
//
// Nada aqui importa a demonstração (`AdminShell` usa a sessão simulada): é
// por isso que este shell é próprio, e não uma variação daquele.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  Contact,
  LogOut,
  MoreHorizontal,
  Repeat,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import {
  ITENS_MENU_MAIS,
  ITENS_NAVEGACAO_CONTA,
  itemAtivo,
  type ItemNavegacaoConta,
} from "@/lib/conta/navegacao";
import { NOME_PRODUTO } from "@/lib/config";
import { useToast } from "@/components/ui/toast";
import {
  contagemVisivel,
  useSolicitacoesPendentes,
} from "@/lib/agendamento-publico/use-solicitacoes";
import { AvisosNovasSolicitacoes } from "@/components/conta/avisos-novas-solicitacoes";

const ICONE_POR_HREF: Record<string, LucideIcon> = {
  "/conta/visao-geral": LayoutDashboard,
  "/conta/agendamentos": CalendarDays,
  "/conta/solicitacoes": Inbox,
  "/conta/clientes": Contact,
  "/conta/servicos": ClipboardList,
  "/conta/profissionais": Users,
  "/conta": UserRound,
};

/** Classe no `<html>` enquanto o shell está montado: sobe as notificações no
 * celular para não cobrirem a barra inferior (ver globals.css). */
const CLASSE_SHELL_ATIVO = "shell-conta-ativo";

const CLASSE_ITEM = clsx(
  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-center text-[11px] leading-tight font-medium",
  "md:min-h-11 md:flex-row md:justify-start md:gap-3 md:rounded-[var(--radius-control)] md:px-3 md:text-left md:text-sm",
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white",
);
// Fundo + sombra interna, não borda: a regra global `* { border-color }` de
// globals.css venceria uma cor de borda utilitária.
const CLASSE_ATIVO =
  "bg-white/10 font-semibold text-white shadow-[inset_0_3px_0_var(--color-accent)] md:shadow-[inset_3px_0_0_var(--color-accent)]";
const CLASSE_INATIVO = "text-white/70 hover:bg-white/5 hover:text-white";
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
      className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-[11px] leading-5 font-semibold text-white"
    >
      {total > 99 ? "99+" : total}
      <span className="sr-only"> {total === 1 ? "solicitação pendente" : "solicitações pendentes"}</span>
    </span>
  );
}

function LinkNavegacao({
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

export function ShellConta({ children }: { children: ReactNode }) {
  const { estado, logout } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  // Barreira contra clique duplo no "Sair" enquanto o logout está em voo.
  const [saindo, setSaindo] = useState(false);
  const [maisAberto, setMaisAberto] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.documentElement.classList.add(CLASSE_SHELL_ATIVO);
    return () => document.documentElement.classList.remove(CLASSE_SHELL_ATIVO);
  }, []);

  // Navegar fecha o "Mais".
  useEffect(() => setMaisAberto(false), [pathname]);

  // Escape ou toque fora fecham o "Mais".
  useEffect(() => {
    if (!maisAberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setMaisAberto(false);
    }
    function aoTocarFora(evento: PointerEvent) {
      if (!navRef.current?.contains(evento.target as Node)) setMaisAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("pointerdown", aoTocarFora);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("pointerdown", aoTocarFora);
    };
  }, [maisAberto]);

  const maisAtivo = ITENS_MENU_MAIS.some((item) => itemAtivo(pathname, item.href));

  // Lista do SolicitacoesProvider (layout de /conta), que já relê a cada
  // navegação e periodicamente com a página visível.
  const { estado: estadoSolicitacoes } = useSolicitacoesPendentes();
  const pendentes = contagemVisivel(estadoSolicitacoes);

  if (estado.status !== "autenticado") return <>{children}</>;

  const { sessao, tenantIdAtivo } = estado;
  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;
  const podeTrocar = sessao.contexts.length > 1;

  async function aoSair() {
    if (saindo) return;
    setSaindo(true);
    const resultado = await logout();
    notificar(
      resultado.confirmadoPeloServidor
        ? "Sessão encerrada."
        : "Não foi possível confirmar o encerramento com o servidor. Você saiu apenas neste dispositivo.",
      resultado.confirmadoPeloServidor ? "sucesso" : "info",
    );
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-paper">
      <aside className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-ink px-4 py-3 text-white md:fixed md:inset-y-0 md:left-0 md:w-64 md:flex-col md:items-stretch md:justify-start md:gap-0 md:p-0">
        {/* Marca e estabelecimento ativo */}
        <div className="min-w-0 md:px-5 md:py-6">
          <Link
            href="/conta/visao-geral"
            className="font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-white"
          >
            {NOME_PRODUTO}
          </Link>
          {contexto && (
            <p
              className="truncate text-xs text-white/70 md:mt-1 md:text-sm md:text-white"
              data-testid="estabelecimento-ativo"
            >
              {contexto.tenantName}
            </p>
          )}
          {podeTrocar && (
            <Link
              href="/conta/selecionar-estabelecimento"
              className="hidden min-h-11 items-center text-xs text-white/70 hover:text-white focus-visible:outline-2 focus-visible:outline-white md:inline-flex"
            >
              <Repeat size={14} className="mr-1.5" aria-hidden="true" />
              Trocar
              <span className="sr-only"> de estabelecimento</span>
            </Link>
          )}
        </div>

        {contexto && (
          <nav
            ref={navRef}
            aria-label="Áreas da conta"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink pb-[env(safe-area-inset-bottom)] md:static md:flex-1 md:border-0 md:px-3 md:pb-0"
          >
            <ul className="grid grid-cols-5 md:flex md:flex-col md:gap-1">
              {ITENS_NAVEGACAO_CONTA.map((item) => (
                <li
                  key={item.href}
                  // Itens do "Mais" saem da barra do celular com
                  // `display: none` (fora da árvore de acessibilidade): só
                  // a cópia do menu "Mais" existe ali.
                  className={clsx("min-w-0", item.noCelular === "mais" && "hidden md:block")}
                >
                  <LinkNavegacao
                    item={item}
                    ativo={itemAtivo(pathname, item.href)}
                    contador={item.href === "/conta/solicitacoes" ? pendentes : undefined}
                  />
                </li>
              ))}
              <li className="min-w-0 md:hidden">
                <button
                  type="button"
                  aria-expanded={maisAberto}
                  aria-controls="menu-mais"
                  onClick={() => setMaisAberto((aberto) => !aberto)}
                  className={clsx(CLASSE_ITEM, maisAtivo || maisAberto ? CLASSE_ATIVO : CLASSE_INATIVO, "relative w-full")}
                >
                  <MoreHorizontal size={20} aria-hidden="true" className="shrink-0" />
                  <span className="w-full truncate">Mais</span>
                  {!!pendentes && (
                    <span
                      aria-hidden="true"
                      data-testid="contador-mais"
                      className="absolute top-1.5 right-[calc(50%-18px)] size-2.5 rounded-full bg-[var(--color-accent)]"
                    />
                  )}
                  {!!pendentes && <span className="sr-only"> ({pendentes} solicitações pendentes)</span>}
                  {maisAtivo && <span className="sr-only"> (página atual aqui)</span>}
                </button>
              </li>
            </ul>
            {maisAberto && (
              <ul
                id="menu-mais"
                className="absolute inset-x-0 bottom-full border-t border-white/10 bg-ink p-2 shadow-lg md:hidden"
              >
                {ITENS_MENU_MAIS.map((item) => (
                  <li key={item.href}>
                    <LinkNavegacao
                      item={item}
                      ativo={itemAtivo(pathname, item.href)}
                      emLista
                      contador={item.href === "/conta/solicitacoes" ? pendentes : undefined}
                    />
                  </li>
                ))}
              </ul>
            )}
          </nav>
        )}

        {/* Usuário e Sair: no rodapé do menu no computador, no canto da barra
            superior no celular. */}
        <div className="flex shrink-0 items-center gap-1 md:mt-auto md:block md:space-y-1 md:border-t md:border-white/10 md:px-3 md:py-4">
          {podeTrocar && (
            <Link
              href="/conta/selecionar-estabelecimento"
              aria-label="Trocar de estabelecimento"
              className="inline-flex size-11 items-center justify-center rounded-[var(--radius-control)] text-white/80 hover:text-white focus-visible:outline-2 focus-visible:outline-white md:hidden"
            >
              <Repeat size={18} aria-hidden="true" />
            </Link>
          )}
          <div className="hidden px-3 md:block" data-testid="usuario-conectado">
            <p className="text-xs text-white/50">Conectado como</p>
            <p className="truncate text-sm font-medium text-white">{sessao.user.name}</p>
          </div>
          <button
            type="button"
            disabled={saindo}
            aria-busy={saindo}
            onClick={() => void aoSair()}
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm text-white/80 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50 md:w-full"
          >
            <LogOut size={16} aria-hidden="true" />
            Sair
          </button>
        </div>
      </aside>

      <main
        className={clsx(
          "px-4 py-6 sm:px-6 md:ml-64 md:py-8 lg:px-8",
          // Espaço para a barra inferior do celular não cobrir o fim da página.
          contexto ? "pb-28 md:pb-8" : undefined,
        )}
      >
        {children}
      </main>

      {contexto && <AvisosNovasSolicitacoes />}
    </div>
  );
}
