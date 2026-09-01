"use client";

// Contexto do tenant atual para as áreas autenticadas (painel do dono e agenda do
// profissional). O tenant SEMPRE vem da sessão simulada (`useTenantId`, que lê o
// usuário logado) — nunca de um parâmetro de URL ou de um formulário. Isso é o que
// garante que o painel nunca fique preso a um estabelecimento fixo e nunca misture
// dados de outro tenant, mesmo sendo só uma simulação.
//
// Também concentra o "contexto de acesso" do usuário atual (membership + status)
// para que `calcularAcessoEfetivo` possa ser chamado em um único lugar (`podeAcessar`)
// em vez de cada página remontar os mesmos dados.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth, useTenantId } from "@/lib/auth/auth-context";
import { useClientData } from "@/lib/hooks/use-client-data";
import { estabelecimentoRepository, membershipRepository, usuarioEstabelecimentoRepository } from "@/lib/repositories";
import { calcularAcessoEfetivo } from "@/lib/access/access-control";
import { obterTerminologia, type Terminologia } from "@/lib/verticals/terminologia";
import type { Estabelecimento, Membership, Permission, StatusUsuario } from "@/lib/types";

interface TenantContextValue {
  tenantId: string;
  estabelecimento: Estabelecimento | null;
  membership: Membership | null;
  usuarioStatus: StatusUsuario;
  terminologia: Terminologia;
  carregando: boolean;
  recarregar: () => void;
  /** Único ponto de checagem de permissão para o portal do estabelecimento —
   * componentes nunca devem reimplementar esta lógica (ver access-control.ts). */
  podeAcessar: (permissao: Permission) => { permitido: boolean; motivo?: string };
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const tenantId = useTenantId();
  const { usuario } = useAuth();

  const { dados, carregando, recarregar } = useClientData(() => {
    const estabelecimento = estabelecimentoRepository.obterPorTenantId(tenantId) ?? null;
    const membership = usuario ? membershipRepository.obterVinculo(usuario.id, tenantId) ?? null : null;
    const usuarioEstabelecimento = usuario ? usuarioEstabelecimentoRepository.obterPorId(usuario.id) : undefined;
    return { estabelecimento, membership, usuarioStatus: usuarioEstabelecimento?.status ?? "suspenso" };
  }, [tenantId, usuario?.id]);

  const estabelecimento = dados?.estabelecimento ?? null;
  const membership = dados?.membership ?? null;
  const usuarioStatus: StatusUsuario = dados?.usuarioStatus ?? "suspenso";
  const terminologia = useMemo(() => obterTerminologia(estabelecimento?.categoria), [estabelecimento?.categoria]);

  function podeAcessar(permissao: Permission) {
    if (!estabelecimento || !membership) {
      return { permitido: false, motivo: "Não foi possível confirmar seu vínculo com este estabelecimento." };
    }
    return calcularAcessoEfetivo({
      permissao,
      papel: membership.papel,
      plano: estabelecimento.plano,
      featuresDesativadas: estabelecimento.featuresDesativadas,
      permissoesLiberadas: membership.permissoesLiberadas,
      permissoesNegadas: membership.permissoesNegadas,
      usuarioStatus,
      tenantStatus: estabelecimento.status,
    });
  }

  const value: TenantContextValue = {
    tenantId,
    estabelecimento,
    membership,
    usuarioStatus,
    terminologia,
    carregando,
    recarregar,
    podeAcessar,
  };
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const contexto = useContext(TenantContext);
  if (!contexto) throw new Error("useTenant precisa ser usado dentro de <TenantProvider>");
  return contexto;
}
