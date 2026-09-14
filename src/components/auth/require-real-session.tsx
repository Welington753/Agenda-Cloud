"use client";

// Guarda de rota para o portal de conta REAL (`/conta/**`) — equivalente a
// `RequireRole` (demo), mas com um terceiro estado que a demo não tem:
// `falha_comunicacao`. Backend indisponível NUNCA deve virar redirect para
// login (isso pareceria "sessão inválida") nem liberar acesso (isso seria
// mostrar conteúdo sem confirmar autorização) — mostra uma tela própria,
// nunca a demonstração.
import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Botao } from "@/components/ui/button";

export function RequireRealSession({ children }: { children: ReactNode }) {
  const { estado, recarregar } = useRealAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (estado.status !== "nao_autenticado") return;
    const destino = pathname ? `/login?next=${encodeURIComponent(pathname)}` : "/login";
    router.replace(destino);
  }, [estado.status, pathname, router]);

  if (estado.status === "carregando" || estado.status === "nao_autenticado") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    );
  }

  if (estado.status === "falha_comunicacao") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper p-6 text-center">
        <h1 className="text-lg font-bold text-ink">Não foi possível conectar ao servidor</h1>
        <p className="max-w-sm text-sm text-ink-soft">
          Verifique sua conexão e tente novamente. Nenhum dado foi carregado e sua sessão não foi alterada.
        </p>
        <Botao type="button" onClick={recarregar}>
          Tentar novamente
        </Botao>
      </div>
    );
  }

  return <>{children}</>;
}
