"use client";

// O que o vínculo ATIVO opera, para cada tela esconder o botão de uma ação que
// voltaria recusada (o gerente só tem as áreas que o dono concedeu). Só
// apresentação: o servidor refaz a prova em toda requisição, então uma
// permissão retirada já é recusada na próxima ação, mesmo que o botão ainda
// apareça até a sessão ser relida.
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { temArea, type AreaDoEstabelecimento } from "./papel";

export function useAreas(): (area: AreaDoEstabelecimento) => boolean {
  const { estado } = useRealAuth();
  const contexto =
    estado.status === "autenticado" && estado.tenantIdAtivo
      ? encontrarContextoPorTenantId(estado.sessao, estado.tenantIdAtivo)
      : null;
  return (area) => temArea(contexto, area);
}
