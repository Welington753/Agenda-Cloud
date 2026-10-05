"use client";

// Cabeçalho e navegação comuns da área REAL (`/conta/**`).
//
// Só LÊ a sessão que `RequireRealSession` já validou (via `useRealAuth`):
// não faz nenhuma requisição própria além do logout, que já existia na página
// Minha conta e mudou para cá sem mudar de comportamento.
//
// O estabelecimento exibido é o contexto ATIVO da sessão, escolhido entre os
// vínculos que o backend devolveu — nunca um id vindo da URL. A navegação só
// aparece quando há um estabelecimento ativo: antes da escolha (quem tem mais
// de um vínculo) as páginas da agenda nem teriam o que mostrar.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Repeat } from "lucide-react";
import clsx from "clsx";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { ITENS_NAVEGACAO_CONTA, itemAtivo } from "@/lib/conta/navegacao";
import { NOME_PRODUTO } from "@/lib/config";
import { Botao } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function CabecalhoConta() {
  const { estado, logout } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  // Barreira contra clique duplo no "Sair" enquanto o logout está em voo.
  const [saindo, setSaindo] = useState(false);

  if (estado.status !== "autenticado") return null;

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
    <header className="border-b border-border bg-ink text-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <Link href="/conta" className="font-bold tracking-tight">
            {NOME_PRODUTO}
          </Link>
          {contexto && (
            <p className="truncate text-xs text-white/70" data-testid="estabelecimento-ativo">
              {contexto.tenantName}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {podeTrocar && (
            <Link
              href="/conta/selecionar-estabelecimento"
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm text-white/80 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            >
              <Repeat size={16} className="mr-1.5" aria-hidden="true" />
              Trocar
              <span className="sr-only"> de estabelecimento</span>
            </Link>
          )}
          <Botao
            type="button"
            variante="fantasma"
            className="min-h-11 text-white/80 hover:text-white"
            disabled={saindo}
            aria-busy={saindo}
            onClick={() => void aoSair()}
          >
            <LogOut size={16} className="mr-1.5" aria-hidden="true" />
            Sair
          </Botao>
        </div>
      </div>

      {contexto && (
        <nav aria-label="Áreas da conta" className="border-t border-white/10">
          {/* Sem menu escondido no celular: quatro itens cabem numa linha, e a
              linha rola na horizontal se a tela for estreita demais. */}
          <ul className="mx-auto flex max-w-5xl overflow-x-auto px-2">
            {ITENS_NAVEGACAO_CONTA.map((item) => {
              const ativo = itemAtivo(pathname, item.href);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={ativo ? "page" : undefined}
                    className={clsx(
                      "flex min-h-11 items-center justify-center whitespace-nowrap px-2 text-sm font-medium sm:px-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white",
                      // Fundo + sombra interna, não borda: a regra global
                      // `* { border-color }` de globals.css (fora de camada)
                      // venceria qualquer cor de borda utilitária aqui.
                      ativo
                        ? "bg-white/10 font-semibold text-white shadow-[inset_0_-3px_0_var(--color-accent)]"
                        : "text-white/70 hover:text-white",
                    )}
                  >
                    {item.rotulo}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
