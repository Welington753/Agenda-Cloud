"use client";

// Portão das páginas do portal da plataforma: só mostra o conteúdo com o
// acesso confirmado (ver lib/administracao/use-acesso-plataforma.tsx). A
// operação (`/conta`) não tem atalho nenhum para cá.
//
// Segundo fator: quando o servidor diz que esta sessão ainda precisa do
// código (ou do cadastro), o portão mostra só essa etapa, sem ler nenhum dado
// do portal. Depois do acerto, relê o acesso. O servidor recusa cada leitura
// e escrita sem permissão, com ou sem este portão: mudar o endereço não
// autoriza nada.
import Link from "next/link";
import type { ReactNode } from "react";
import { useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { convidarParaAtivar, etapaDoPortao } from "@/lib/administracao/segundo-fator";
import { ROTA_SEGURANCA } from "@/lib/administracao/rotas";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { EstadoLeitura } from "./estado-leitura";
import { ReautenticacaoProvider } from "./reautenticacao";
import { EtapaDoSegundoFator } from "./segundo-fator/etapa";

/** Portão das páginas `/portal/**`. Carregando, falha de rede ou recusa
 * nunca viram uma tela vazia ou um "zero". */
export function PortaoAdministracao({ children }: { children: ReactNode }) {
  const { estado, recarregar } = useAcessoPlataforma();
  const { estado: sessao } = useRealAuth();
  if (estado.status !== "pronto") return <EstadoLeitura estado={estado} recarregar={recarregar} />;
  const etapa = etapaDoPortao(estado.dados);
  if (etapa === "verificar" || etapa === "cadastrar") {
    return (
      <EtapaDoSegundoFator
        etapa={etapa}
        segundoFator={estado.dados.secondFactor!}
        email={sessao.status === "autenticado" ? sessao.sessao.user.email : null}
        aoConcluir={recarregar}
      />
    );
  }
  if (etapa === "sem-acesso") {
    return <EstadoLeitura estado={{ status: "erro", motivo: "permissao" }} recarregar={recarregar} />;
  }
  return (
    <ReautenticacaoProvider>
      <div className="space-y-6" data-testid="conteudo-portal">
        {convidarParaAtivar(estado.dados) && (
          <p className="rounded-xl border border-border bg-card p-4 text-sm" data-testid="convite-ativar-segundo-fator">
            Proteja o portal com a verificação em duas etapas.{" "}
            <Link href={ROTA_SEGURANCA} className="font-medium text-accent hover:underline">
              Ativar agora
            </Link>
          </p>
        )}
        {children}
      </div>
    </ReautenticacaoProvider>
  );
}
