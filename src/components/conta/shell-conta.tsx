"use client";

// Estrutura comum da área REAL (`/conta/**`): menu lateral no computador
// (inspirado no da demonstração) e, no celular, barra superior com o
// estabelecimento, o sino "Notificações" e o menu da conta (aparência,
// notificações deste aparelho, Configurações, Administração e "Sair", ver
// menu-conta.tsx) mais uma barra inferior com no máximo quatro áreas (Início,
// Agenda, Clientes e Configurações para o dono). Sem rolagem horizontal.
//
// A navegação, o estabelecimento e o "Sair" existem UMA vez no DOM e só mudam
// de lugar com CSS: links duplicados (um por tamanho de tela) confundiriam
// leitor de tela e localizadores. As exceções são "Trocar", que tem uma forma
// por tamanho, e a Administração, que no celular sai da barra e aparece no
// menu da conta — em ambos a outra forma fica em `display: none` (fora da
// árvore de acessibilidade).
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
// mesmo menu — no menu da conta, no celular — mesmo sem vínculo com
// estabelecimento, num grupo separado da operação e das Configurações.
// Nas páginas da administração o cabeçalho diz "Administração da plataforma";
// o estabelecimento ativo continua o mesmo, porque a ficha de outra empresa
// nunca vira contexto da sessão.
//
// Nada aqui importa a demonstração (`AdminShell` usa a sessão simulada): é
// por isso que este shell é próprio, e não uma variação daquele.
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Repeat, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { itensDaNavegacao, itemAtivo } from "@/lib/conta/navegacao";
import { COLUNAS_NO_CELULAR, LinkNavegacao } from "@/components/conta/link-navegacao";
import { NOME_PRODUTO } from "@/lib/config";
import {
  contagemVisivel,
  useSolicitacoesPendentes,
} from "@/lib/agendamento-publico/use-solicitacoes";
import { AvisosNovasSolicitacoes } from "@/components/conta/avisos-novas-solicitacoes";
import { MenuConta, SinoNotificacoes } from "@/components/conta/menu-conta";
import { useSair } from "@/components/conta/use-sair";
import { acessoConfirmado, useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { emAdministracao } from "@/lib/administracao/rotas";
import { perfilDoPapel, redirecionamentoDoPerfil } from "@/lib/conta/papel";
import { ROTA_AGENDA, ROTA_CONFIGURACOES, ROTA_INICIO } from "@/lib/conta/rotas";

/** Classe no `<html>` enquanto o shell está montado: sobe as notificações no
 * celular para não cobrirem a barra inferior (ver globals.css). */
const CLASSE_SHELL_ATIVO = "shell-conta-ativo";

export function ShellConta({ children }: { children: ReactNode }) {
  const { estado } = useRealAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { saindo, sair } = useSair();

  useEffect(() => {
    document.documentElement.classList.add(CLASSE_SHELL_ATIVO);
    return () => document.documentElement.classList.remove(CLASSE_SHELL_ATIVO);
  }, []);

  // Lista do SolicitacoesProvider (layout de /conta), que já relê a cada
  // navegação e periodicamente com a página visível.
  const { estado: estadoSolicitacoes } = useSolicitacoesPendentes();
  const pendentes = contagemVisivel(estadoSolicitacoes);

  // "Administração" só entra com o acesso confirmado pelo backend.
  const { estado: estadoAcesso } = useAcessoPlataforma();

  // Papel no estabelecimento ATIVO: o funcionário vê só a agenda dele e as
  // configurações pessoais; uma página que não é do perfil (aberta pelo
  // endereço) leva à do perfil ANTES de montar, para não disparar leituras que
  // o servidor recusaria. Quem não tem vínculo nenhum (um administrador da
  // plataforma) segue a mesma regra do papel sem área. Antes da escolha de
  // estabelecimento (vários vínculos, nenhum ativo) nada é encaminhado: as
  // páginas levam à escolha.
  const contextoAtivo =
    estado.status === "autenticado" && estado.tenantIdAtivo
      ? encontrarContextoPorTenantId(estado.sessao, estado.tenantIdAtivo)
      : null;
  const semVinculo = estado.status === "autenticado" && !estado.sessao.hasEstablishmentAccess;
  const perfil = perfilDoPapel(contextoAtivo?.role);
  const destinoDoPerfil = contextoAtivo
    ? redirecionamentoDoPerfil(perfil, pathname)
    : semVinculo
      ? redirecionamentoDoPerfil("sem-area", pathname)
      : null;
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
  const naBarra = itens.filter((item) => item.noCelular === "barra");
  const colunasNoCelular = naBarra.length;
  const comAdministracao = acessoConfirmado(estadoAcesso);
  // Administrando a plataforma ou operando o estabelecimento: o cabeçalho diz.
  const modoAdministracao = emAdministracao(pathname);

  return (
    <div className="min-h-screen bg-paper">
      <aside className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-chrome px-4 py-3 text-white md:fixed md:inset-y-0 md:left-0 md:w-64 md:flex-col md:items-stretch md:justify-start md:gap-0 md:p-0">
        {/* Marca, estabelecimento ativo e o sino "Notificações" */}
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2 md:flex-none md:px-5 md:py-6">
          <div className="min-w-0">
          <Link
            href={contexto && ehDono ? ROTA_INICIO : "/conta"}
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
            aria-label="Áreas da conta"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-chrome pb-[env(safe-area-inset-bottom)] md:static md:flex-1 md:border-0 md:px-3 md:pb-0"
          >
            <ul className={clsx("grid md:flex md:flex-col md:gap-1", COLUNAS_NO_CELULAR[colunasNoCelular])}>
              {itens.map((item) => (
                <li
                  key={item.href}
                  // Itens fora da barra saem do celular com `display: none`
                  // (fora da árvore de acessibilidade): no celular, a cópia
                  // fica no menu da conta.
                  className={clsx("min-w-0", item.noCelular === "menu" && "hidden md:block")}
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
                    contador={item.href === ROTA_AGENDA && ehDono ? pendentes : undefined}
                  />
                </li>
              ))}
            </ul>
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
            comAdministracao={comAdministracao}
            configuracoes={ROTA_CONFIGURACOES}
            saindo={saindo}
            aoSair={() => void sair()}
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
