"use client";

// Estrutura comum da área REAL (`/conta/**`): menu lateral no computador
// (inspirado no da demonstração) e, no celular, barra superior com o
// estabelecimento, o sino "Notificações" e o menu da conta (aparência,
// notificações deste aparelho e "Sair", ver menu-conta.tsx) mais uma barra
// inferior com quatro áreas e um
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
// vínculos que o backend devolveu — nunca um id vindo da URL. A navegação da
// operação só aparece quando há um estabelecimento ativo: antes da escolha
// (quem tem mais de um vínculo) as páginas nem teriam o que mostrar.
//
// Quem administra a plataforma (acesso confirmado por `GET /platform/access`,
// ver lib/administracao/use-acesso-plataforma.tsx) ganha "Administração" no
// mesmo menu — no "Mais" do celular — mesmo sem vínculo com estabelecimento.
// Nas páginas da administração o cabeçalho diz "Administração da plataforma";
// o estabelecimento ativo continua o mesmo, porque a ficha de outra empresa
// nunca vira contexto da sessão.
//
// Nada aqui importa a demonstração (`AdminShell` usa a sessão simulada): é
// por isso que este shell é próprio, e não uma variação daquele.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontal, Repeat, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { itensDaNavegacao, itemAtivo } from "@/lib/conta/navegacao";
import {
  CLASSE_ATIVO,
  CLASSE_INATIVO,
  CLASSE_ITEM,
  COLUNAS_NO_CELULAR,
  LinkNavegacao,
} from "@/components/conta/link-navegacao";
import { NOME_PRODUTO } from "@/lib/config";
import { useToast } from "@/components/ui/toast";
import {
  contagemVisivel,
  useSolicitacoesPendentes,
} from "@/lib/agendamento-publico/use-solicitacoes";
import { AvisosNovasSolicitacoes } from "@/components/conta/avisos-novas-solicitacoes";
import { MenuConta, SinoNotificacoes } from "@/components/conta/menu-conta";
import { encerrarNoDispositivo } from "@/lib/push/dispositivo";
import { acessoConfirmado, useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { emAdministracao } from "@/lib/administracao/rotas";
import { perfilDoPapel, redirecionamentoDoPerfil } from "@/lib/conta/papel";

/** Classe no `<html>` enquanto o shell está montado: sobe as notificações no
 * celular para não cobrirem a barra inferior (ver globals.css). */
const CLASSE_SHELL_ATIVO = "shell-conta-ativo";

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

  // Lista do SolicitacoesProvider (layout de /conta), que já relê a cada
  // navegação e periodicamente com a página visível.
  const { estado: estadoSolicitacoes } = useSolicitacoesPendentes();
  const pendentes = contagemVisivel(estadoSolicitacoes);

  // "Administração" só entra com o acesso confirmado pelo backend.
  const { estado: estadoAcesso } = useAcessoPlataforma();

  // Papel no estabelecimento ATIVO: o funcionário vê só a agenda dele e Minha
  // conta; uma página que não é do perfil (aberta pelo endereço) leva à do
  // perfil ANTES de montar, para não disparar leituras que o servidor recusaria.
  const contextoAtivo =
    estado.status === "autenticado" && estado.tenantIdAtivo
      ? encontrarContextoPorTenantId(estado.sessao, estado.tenantIdAtivo)
      : null;
  const perfil = perfilDoPapel(contextoAtivo?.role);
  const destinoDoPerfil = contextoAtivo ? redirecionamentoDoPerfil(perfil, pathname) : null;
  useEffect(() => {
    if (destinoDoPerfil) router.replace(destinoDoPerfil);
  }, [destinoDoPerfil, router]);

  if (estado.status !== "autenticado") return <>{children}</>;

  const { sessao, tenantIdAtivo } = estado;
  const contexto = contextoAtivo;
  const ehDono = perfil === "dono";
  const podeTrocar = sessao.contexts.length > 1;
  const itens = itensDaNavegacao({
    comEstabelecimento: !!contexto,
    comAdministracao: acessoConfirmado(estadoAcesso),
    perfil,
  });
  const itensMais = itens.filter((item) => item.noCelular === "mais");
  const maisAtivo = itensMais.some((item) => itemAtivo(pathname, item.href));
  const colunasNoCelular = itens.length - itensMais.length + (itensMais.length ? 1 : 0);
  // Administrando a plataforma ou operando o estabelecimento: o cabeçalho diz.
  const modoAdministracao = emAdministracao(pathname);

  async function aoSair() {
    if (saindo) return;
    setSaindo(true);
    // Notificações deste aparelho param junto com a sessão (no máximo 1,5 s
    // de espera; o servidor já não envia para sessão encerrada).
    await encerrarNoDispositivo(tenantIdAtivo);
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
      <aside className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-chrome px-4 py-3 text-white md:fixed md:inset-y-0 md:left-0 md:w-64 md:flex-col md:items-stretch md:justify-start md:gap-0 md:p-0">
        {/* Marca, estabelecimento ativo e o sino "Notificações" */}
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2 md:flex-none md:px-5 md:py-6">
          <div className="min-w-0">
          <Link
            href={contexto && ehDono ? "/conta/visao-geral" : "/conta"}
            className="font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-white"
          >
            {NOME_PRODUTO}
          </Link>
          {modoAdministracao && (
            <p
              data-testid="modo-administracao"
              className="mt-0.5 flex max-w-full items-start gap-1 text-xs font-semibold text-white md:mt-2"
            >
              <ShieldCheck size={14} aria-hidden="true" className="mt-px shrink-0" />
              {/* No celular cabe numa linha; no computador, o sino divide a
                  largura do menu e o texto quebra em vez de ser cortado. */}
              <span className="truncate md:whitespace-normal">Administração da plataforma</span>
            </p>
          )}
          {contexto && modoAdministracao && (
            <p className="mt-3 hidden text-[11px] font-semibold tracking-wider text-white/50 uppercase md:block">
              Seu estabelecimento
            </p>
          )}
          {contexto && (
            <p
              className={clsx(
                "truncate text-xs text-white/70 md:mt-1 md:text-sm md:text-white",
                // No celular, a faixa da administração já diz qual é.
                modoAdministracao && "hidden md:block",
              )}
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
          {contexto && ehDono && <SinoNotificacoes pendentes={pendentes} />}
        </div>

        {itens.length > 0 && (
          <nav
            ref={navRef}
            aria-label="Áreas da conta"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-chrome pb-[env(safe-area-inset-bottom)] md:static md:flex-1 md:border-0 md:px-3 md:pb-0"
          >
            <ul className={clsx("grid md:flex md:flex-col md:gap-1", COLUNAS_NO_CELULAR[colunasNoCelular])}>
              {itens.map((item) => (
                <li
                  key={item.href}
                  // Itens do "Mais" saem da barra do celular com
                  // `display: none` (fora da árvore de acessibilidade): só
                  // a cópia do menu "Mais" existe ali.
                  className={clsx("min-w-0", item.noCelular === "mais" && "hidden md:block")}
                >
                  {/* No computador, a administração fica num grupo próprio,
                      separado da operação do estabelecimento. */}
                  {item.grupo === "plataforma" && contexto && (
                    <span className="mt-4 hidden border-t border-white/10 px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-white/50 uppercase md:block">
                      Plataforma
                    </span>
                  )}
                  <LinkNavegacao
                    item={item}
                    ativo={itemAtivo(pathname, item.href)}
                    contador={item.href === "/conta/solicitacoes" ? pendentes : undefined}
                  />
                </li>
              ))}
              {itensMais.length > 0 && (
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
              )}
            </ul>
            {maisAberto && itensMais.length > 0 && (
              <ul
                id="menu-mais"
                className="absolute inset-x-0 bottom-full border-t border-white/10 bg-chrome p-2 shadow-lg md:hidden"
              >
                {itensMais.map((item) => (
                  <li
                    key={item.href}
                    className={clsx(item.grupo === "plataforma" && "mt-1 border-t border-white/10 pt-1")}
                  >
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

        {/* Menu da conta (quem está conectado, notificações, aparência e
            Sair): no rodapé do menu no computador, no canto da barra superior
            no celular. */}
        <div className="flex shrink-0 items-center gap-1 md:mt-auto md:block md:border-t md:border-white/10 md:px-3 md:py-4">
          {podeTrocar && (
            <Link
              href="/conta/selecionar-estabelecimento"
              aria-label="Trocar de estabelecimento"
              className="inline-flex size-11 items-center justify-center rounded-[var(--radius-control)] text-white/80 hover:text-white focus-visible:outline-2 focus-visible:outline-white md:hidden"
            >
              <Repeat size={18} aria-hidden="true" />
            </Link>
          )}
          <MenuConta
            nome={sessao.user.name}
            email={sessao.user.email}
            tenantId={contexto && ehDono ? tenantIdAtivo : null}
            pendentes={ehDono ? pendentes : null}
            saindo={saindo}
            aoSair={() => void aoSair()}
          />
        </div>
      </aside>

      <main
        className={clsx(
          "px-4 py-6 sm:px-6 md:ml-64 md:py-8 lg:px-8",
          // Espaço para a barra inferior do celular não cobrir o fim da página.
          itens.length > 0 ? "pb-28 md:pb-8" : undefined,
        )}
      >
        {destinoDoPerfil ? null : children}
      </main>

      {contexto && ehDono && <AvisosNovasSolicitacoes />}
    </div>
  );
}
