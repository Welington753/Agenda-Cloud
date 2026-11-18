"use client";

// Contexto comum das telas do Estoque: sessão, estabelecimento ativo, quem é
// a pessoa e se ela opera (ESTOQUE_GERENCIAR) ou só consulta. Só apresentação:
// a API confere vínculo, adicional e permissão em toda requisição.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { temArea } from "@/lib/conta/papel";
import { ROTA_SELECIONAR_ESTABELECIMENTO } from "@/lib/conta/rotas";
import type { TenantContextReal } from "@/lib/api/auth-api";

export interface ContextoEstoque {
  /** `null` enquanto a sessão não decidiu, ou sem vínculo. */
  pronto: boolean;
  userId: string | null;
  tenantId: string | null;
  contexto: TenantContextReal | null;
  podeVer: boolean;
  podeOperar: boolean;
}

export function useContextoEstoque(): ContextoEstoque {
  const { estado } = useRealAuth();
  const router = useRouter();
  const sessao = estado.status === "autenticado" ? estado.sessao : null;
  const tenantId = estado.status === "autenticado" ? estado.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantId;

  useEffect(() => {
    if (precisaSelecionar) router.replace(ROTA_SELECIONAR_ESTABELECIMENTO);
  }, [precisaSelecionar, router]);

  const contexto = sessao && tenantId ? encontrarContextoPorTenantId(sessao, tenantId) : null;
  return {
    pronto: !!sessao && !precisaSelecionar,
    userId: sessao?.user.id ?? null,
    tenantId: contexto ? tenantId : null,
    contexto,
    podeVer: temArea(contexto, "ESTOQUE_VER"),
    podeOperar: temArea(contexto, "ESTOQUE_GERENCIAR"),
  };
}
