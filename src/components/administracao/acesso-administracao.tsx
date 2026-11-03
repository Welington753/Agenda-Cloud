"use client";

// Peças do portal da plataforma usadas fora dele e o portão das páginas:
//
// - `LinkAdministracao`: atalho para o portal em Perfil e segurança e na
//   Visão geral da área da conta, só com o acesso confirmado pelo backend;
// - `PortaoAdministracao`: só mostra o conteúdo do portal com o acesso
//   confirmado (ver lib/administracao/use-acesso-plataforma.tsx).
//
// O servidor recusa cada leitura e escrita sem permissão, com ou sem este
// portão: esconder um link ou mudar o endereço não autoriza nada.
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { acessoConfirmado, useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { ROTA_ADMINISTRACAO } from "@/lib/administracao/rotas";
import { EstadoLeitura } from "./estado-leitura";
import { ReautenticacaoProvider } from "./reautenticacao";

export function LinkAdministracao() {
  const { estado } = useAcessoPlataforma();
  if (!acessoConfirmado(estado)) return null;
  return (
    <Link
      href={ROTA_ADMINISTRACAO}
      className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent hover:underline"
    >
      <ShieldCheck size={18} aria-hidden="true" /> Portal da plataforma
    </Link>
  );
}

/** Portão das páginas `/plataforma/**`. Carregando, falha de rede ou recusa
 * nunca viram uma tela vazia ou um "zero". */
export function PortaoAdministracao({ children }: { children: ReactNode }) {
  const { estado, recarregar } = useAcessoPlataforma();
  if (estado.status !== "pronto") return <EstadoLeitura estado={estado} recarregar={recarregar} />;
  if (!estado.dados.canViewEstablishments) {
    return <EstadoLeitura estado={{ status: "erro", motivo: "permissao" }} recarregar={recarregar} />;
  }
  return (
    <ReautenticacaoProvider>
      <div className="space-y-6" data-testid="conteudo-portal">
        {children}
      </div>
    </ReautenticacaoProvider>
  );
}
