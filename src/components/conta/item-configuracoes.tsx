"use client";

// "Configurações" no menu lateral do computador, com o submenu das seções.
//
// - O texto continua sendo um link para o índice (/conta/configuracoes):
//   clicar nele abre a página, nunca só o submenu.
// - Passar o mouse sobre o item abre o submenu ao lado, sem mover o foco. O
//   submenu fica dentro do mesmo `<li>` (com uma faixa transparente entre os
//   dois), e sair do item espera um instante antes de fechar: dá para levar o
//   mouse até as opções sem que ele suma no caminho.
// - Teclado e toque usam um botão próprio, separado do link: abre e fecha o
//   submenu (aberto pelo mouse, o clique nele o fixa); seta para baixo ou
//   para a direita leva o foco à primeira opção.
// - Fecha ao escolher uma opção, com Escape (devolvendo o foco ao botão, se
//   ele estava no submenu), ao clicar fora, quando o foco sai do item e ao
//   navegar.
// - Fica dentro da tela: se a parte de baixo passar da janela, sobe.
//
// No celular, nada disso aparece: "Configurações" fica na barra inferior e
// leva ao índice, que funciona sem hover. As opções são as que esta sessão
// usa (useSecoesDeConfiguracoes) e nenhuma é carregada ao abrir: só links,
// sem leitura no servidor nem pedido de permissão.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { ItemNavegacaoConta } from "@/lib/conta/navegacao";
import { itemAtivo } from "@/lib/conta/navegacao";
import { LinkNavegacao } from "@/components/conta/link-navegacao";
import { iconeDaSecao, useSecoesDeConfiguracoes } from "@/components/conta/configuracoes";

/** Tempo para o mouse atravessar até o submenu antes de ele fechar. */
const ESPERA_AO_SAIR_MS = 250;
/** Distância mínima das bordas da janela. */
const MARGEM_DA_JANELA = 8;
/** O submenu só existe com o menu lateral (mesmo ponto `md` do Tailwind). */
const COM_MENU_LATERAL = "(min-width: 768px)";

export function ItemConfiguracoes({ item, ativo }: { item: ItemNavegacaoConta; ativo: boolean }) {
  const secoes = useSecoesDeConfiguracoes();
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const [deslocamento, setDeslocamento] = useState(0);
  const raizRef = useRef<HTMLLIElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const esperaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "hover": aberto só pela passagem do mouse (sair do item fecha). "fixo":
  // aberto pelo botão (teclado, toque ou clique); só fecha por escolha,
  // Escape, clique fora, foco saindo ou o próprio botão.
  const modoRef = useRef<"hover" | "fixo">("hover");
  const idPainel = useId();

  const cancelarEspera = useCallback(() => {
    if (esperaRef.current) clearTimeout(esperaRef.current);
    esperaRef.current = null;
  }, []);
  const fechar = useCallback(() => {
    cancelarEspera();
    setAberto(false);
  }, [cancelarEspera]);

  // Navegar fecha (também cobre a escolha de uma opção).
  useEffect(() => fechar(), [pathname, fechar]);
  useEffect(() => cancelarEspera, [cancelarEspera]);

  // Escape e clique fora.
  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key !== "Escape") return;
      const focoDentro = raizRef.current?.contains(document.activeElement);
      fechar();
      if (focoDentro) botaoRef.current?.focus();
    }
    function aoTocarFora(evento: PointerEvent) {
      if (!raizRef.current?.contains(evento.target as Node)) fechar();
    }
    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("pointerdown", aoTocarFora);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("pointerdown", aoTocarFora);
    };
  }, [aberto, fechar]);

  // Dentro da tela: sobe o que passar da borda de baixo.
  useLayoutEffect(() => {
    if (!aberto) {
      setDeslocamento(0);
      return;
    }
    function ajustar() {
      const painel = painelRef.current;
      const raiz = raizRef.current;
      if (!painel || !raiz) return;
      const topo = raiz.getBoundingClientRect().top;
      const sobra = topo + painel.offsetHeight - (window.innerHeight - MARGEM_DA_JANELA);
      setDeslocamento(sobra > 0 ? -Math.min(sobra, Math.max(0, topo - MARGEM_DA_JANELA)) : 0);
    }
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, [aberto]);

  if (secoes.length === 0) {
    return (
      <li className="min-w-0">
        <LinkNavegacao item={item} ativo={ativo} />
      </li>
    );
  }

  const comMenuLateral = () => window.matchMedia(COM_MENU_LATERAL).matches;

  return (
    <li
      ref={raizRef}
      className="relative min-w-0"
      onPointerEnter={(evento) => {
        if (evento.pointerType !== "mouse" || !comMenuLateral()) return;
        cancelarEspera();
        if (!aberto) modoRef.current = "hover";
        setAberto(true);
      }}
      onPointerLeave={(evento) => {
        if (evento.pointerType !== "mouse" || modoRef.current !== "hover") return;
        cancelarEspera();
        esperaRef.current = setTimeout(() => setAberto(false), ESPERA_AO_SAIR_MS);
      }}
      onBlur={(evento) => {
        // O foco saiu do item (Tab além da última opção, por exemplo).
        if (evento.relatedTarget && !raizRef.current?.contains(evento.relatedTarget as Node)) fechar();
      }}
      onFocus={(evento) => {
        // Foco numa opção fixa o submenu: tirar o mouse não o fecha com o
        // foco dentro (o foco iria parar no corpo da página).
        if (painelRef.current?.contains(evento.target as Node)) modoRef.current = "fixo";
      }}
    >
      <LinkNavegacao item={item} ativo={ativo} className="md:pr-12" />
      <button
        ref={botaoRef}
        type="button"
        aria-expanded={aberto}
        aria-controls={idPainel}
        aria-label="Opções de Configurações"
        data-testid="abrir-submenu-configuracoes"
        onClick={() => {
          cancelarEspera();
          // Aberto pela passagem do mouse: o clique fixa, em vez de fechar.
          const fixar = aberto && modoRef.current === "hover";
          modoRef.current = "fixo";
          setAberto(fixar || !aberto);
        }}
        onKeyDown={(evento) => {
          if (evento.key !== "ArrowDown" && evento.key !== "ArrowRight") return;
          evento.preventDefault();
          cancelarEspera();
          modoRef.current = "fixo";
          setAberto(true);
          // Depois de montar o painel.
          requestAnimationFrame(() => painelRef.current?.querySelector("a")?.focus());
        }}
        className={clsx(
          "absolute top-1/2 right-1 hidden size-9 -translate-y-1/2 items-center justify-center rounded-[var(--radius-control)] text-chrome-ink-soft hover:bg-chrome-hover hover:text-chrome-ink md:inline-flex",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-chrome-focus",
          aberto && "bg-chrome-selected text-chrome-ink",
        )}
      >
        <ChevronRight size={16} aria-hidden="true" className={clsx("transition-transform", aberto && "rotate-180")} />
      </button>

      {aberto && (
        <div
          ref={painelRef}
          id={idPainel}
          data-testid="submenu-configuracoes"
          // A faixa transparente (pl-3) faz parte do item: atravessá-la não
          // conta como sair dele.
          className="absolute top-0 left-full z-50 hidden pl-3 md:block"
          style={deslocamento ? { transform: `translateY(${deslocamento}px)` } : undefined}
        >
          <nav
            aria-label="Opções de Configurações"
            className="w-72 rounded-[var(--radius-card)] border border-border bg-card p-2 text-ink shadow-[var(--shadow-lift)]"
          >
            <ul className="space-y-0.5">
              {secoes.map((secao) => {
                const Icone = iconeDaSecao(secao.href);
                const atual = itemAtivo(pathname, secao.href);
                return (
                  <li key={secao.href}>
                    <Link
                      href={secao.href}
                      prefetch={false}
                      aria-current={atual ? "page" : undefined}
                      onClick={fechar}
                      className={clsx(
                        "flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium",
                        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
                        atual ? "bg-accent-soft text-ink shadow-[inset_3px_0_0_var(--color-ink)]" : "text-ink hover:bg-paper-muted",
                      )}
                    >
                      <Icone size={18} aria-hidden="true" className="shrink-0 text-accent" />
                      {secao.rotulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      )}
    </li>
  );
}
