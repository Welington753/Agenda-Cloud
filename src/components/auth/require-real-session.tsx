"use client";

// Guarda de rota para o portal de conta REAL (`/conta/**`) — equivalente a
// `RequireRole` (demo), mas com um terceiro estado que a demo não tem:
// `falha_comunicacao`. Backend indisponível NUNCA deve virar redirect para
// login (isso pareceria "sessão inválida") nem liberar acesso (isso seria
// mostrar conteúdo sem confirmar autorização) — mostra uma tela própria,
// nunca a demonstração.
//
// Enquanto a API acorda (hospedagem gratuita, ver
// lib/api/leitura-com-recuperacao.ts), a tela diz que está conectando em vez
// de um esqueleto mudo. Com a sessão já aberta, uma reconexão aparece só
// como faixa acima do conteúdo: o conteúdo (e o que foi digitado nele)
// continua montado.
import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Botao } from "@/components/ui/button";
import { ConectandoAoServidor, FaixaConexao } from "@/components/conexao/aviso-conexao";

export function RequireRealSession({ children }: { children: ReactNode }) {
  const { estado, conexao, recarregar } = useRealAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (estado.status !== "nao_autenticado") return;
    // Caminho E busca: a notificação abre /conta/agendamentos/solicitacoes?… e, depois do
    // login, a pessoa volta exatamente para ela (sanitizado no login).
    const atual = pathname ? `${pathname}${window.location.search}` : null;
    const destino = atual ? `/login?next=${encodeURIComponent(atual)}` : "/login";
    router.replace(destino);
  }, [estado.status, pathname, router]);

  if (estado.status === "carregando" || estado.status === "nao_autenticado") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-6">
        <div className="w-full max-w-sm space-y-3">
          {estado.status === "carregando" && (conexao === "acordando" || conexao === "sem_internet") ? (
            <ConectandoAoServidor conexao={conexao} />
          ) : (
            <>
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </>
          )}
        </div>
      </div>
    );
  }

  if (estado.status === "falha_comunicacao") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper p-6 text-center">
        <h1 className="text-lg font-bold text-ink">Não foi possível conectar ao servidor</h1>
        <p className="max-w-sm text-sm text-ink-soft" data-testid="motivo-falha-sessao">
          {estado.motivo === "sem_resposta"
            ? "O servidor não respondeu a tempo. Depois de um tempo sem uso ele pode demorar para iniciar; se continuar assim, ele pode estar fora do ar."
            : "O servidor respondeu com um erro. Tente novamente em alguns instantes."}{" "}
          Nenhum dado foi carregado e sua sessão não foi alterada.
        </p>
        <Botao type="button" onClick={recarregar}>
          Tentar novamente
        </Botao>
      </div>
    );
  }

  return (
    <>
      {conexao !== "ok" && (
        <div className="sticky top-0 z-50 bg-paper p-2">
          <FaixaConexao conexao={conexao} aoTentarDeNovo={recarregar} />
        </div>
      )}
      {children}
    </>
  );
}
