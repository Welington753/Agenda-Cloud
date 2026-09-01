"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTenant } from "@/lib/tenant/tenant-context";
import { Skeleton } from "@/components/ui/skeleton";
import type { Permission } from "@/lib/types";

/** Guarda de permissão fina para páginas do portal do estabelecimento. Nunca
 * depende só de esconder o item no menu — bloqueia também o acesso direto pela
 * rota, mandando para uma página 403 amigável com o motivo de
 * `calcularAcessoEfetivo`. Use dentro de páginas já envolvidas por
 * `<RequireRole>` + `<TenantProvider>` (os layouts de `/painel` e `/profissional`). */
export function RequirePermission({ permissao, children }: { permissao: Permission; children: ReactNode }) {
  const { carregando, podeAcessar } = useTenant();
  const router = useRouter();
  const resultado = podeAcessar(permissao);

  useEffect(() => {
    if (carregando || resultado.permitido) return;
    const motivo = resultado.motivo ?? "Você não tem permissão para acessar esta página.";
    router.replace(`/403?motivo=${encodeURIComponent(motivo)}&voltar=${encodeURIComponent("/painel")}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, resultado.permitido]);

  if (carregando || !resultado.permitido) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return <>{children}</>;
}
