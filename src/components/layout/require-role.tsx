"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import type { PapelEstabelecimento, PapelPlataforma } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";

interface RequireRoleProps {
  papeisPermitidos: (PapelPlataforma | PapelEstabelecimento)[];
  children: ReactNode;
}

/** Protege rotas do painel/agenda/master conforme o papel simulado. Em um backend
 * real esta checagem precisa ser refeita no servidor a cada requisição. */
export function RequireRole({ papeisPermitidos, children }: RequireRoleProps) {
  const { usuario, carregando } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (carregando) return;
    if (!usuario || !papeisPermitidos.includes(usuario.papel)) {
      router.replace("/login");
    }
  }, [carregando, usuario, papeisPermitidos, router]);

  if (carregando || !usuario || !papeisPermitidos.includes(usuario.papel)) {
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

  return <>{children}</>;
}
