"use client";

// Portão das páginas do portal da plataforma: só mostra o conteúdo com o
// acesso confirmado (ver lib/administracao/use-acesso-plataforma.tsx). A
// operação (`/conta`) não tem atalho nenhum para cá.
//
// O servidor recusa cada leitura e escrita sem permissão, com ou sem este
// portão: mudar o endereço não autoriza nada.
import type { ReactNode } from "react";
import { useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { EstadoLeitura } from "./estado-leitura";
import { ReautenticacaoProvider } from "./reautenticacao";

/** Portão das páginas `/portal/**`. Carregando, falha de rede ou recusa
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
