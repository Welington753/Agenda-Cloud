"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { useClientData } from "@/lib/hooks/use-client-data";
import { podeAdministrarPlataforma } from "@/lib/access/access-control";
import { usuarioPlataformaRepository } from "@/lib/repositories";
import { Skeleton } from "@/components/ui/skeleton";
import type { PapelPlataforma, PermissaoPlataforma } from "@/lib/types";

/** Guarda de permissão fina para páginas de `/master`. Espelha `RequirePermission`
 * (portal do estabelecimento), mas usa `podeAdministrarPlataforma` — domínio
 * separado, sem plano nem tenant envolvidos. */
export function RequirePlatformPermission({
  permissao,
  children,
}: {
  permissao: PermissaoPlataforma;
  children: ReactNode;
}) {
  const { usuario } = useAuth();
  const router = useRouter();
  const { dados, carregando } = useClientData(
    () => (usuario ? usuarioPlataformaRepository.obterPorId(usuario.id) ?? null : null),
    [usuario?.id]
  );

  const resultado = usuario
    ? podeAdministrarPlataforma(usuario.papel as PapelPlataforma, dados?.permissoesExtras ?? [], dados?.status ?? "suspenso", permissao)
    : { permitido: false, motivo: "Sessão inválida." };

  useEffect(() => {
    if (carregando || resultado.permitido) return;
    const motivo = resultado.motivo ?? "Você não tem permissão para acessar esta página.";
    router.replace(`/403?motivo=${encodeURIComponent(motivo)}&voltar=${encodeURIComponent("/master")}`);
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
