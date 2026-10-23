"use client";

// Peças da administração da plataforma dentro da área real (`/conta`): o
// atalho em Minha conta, o portão das páginas e a faixa que deixa claro que
// a pessoa está administrando a PLATAFORMA, não operando o próprio
// estabelecimento.
//
// O menu, o cabeçalho, a aparência e o menu da conta são os de toda a área
// (components/conta/shell-conta.tsx). O acesso vem do backend (ver
// lib/administracao/use-acesso-plataforma.tsx) e o servidor recusa cada
// leitura sem permissão, com ou sem este portão.
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { acessoConfirmado, useAcessoPlataforma } from "@/lib/administracao/use-acesso-plataforma";
import { ROTA_ADMINISTRACAO } from "@/lib/administracao/rotas";
import { EstadoLeitura } from "./estado-leitura";

export function LinkAdministracao() {
  const { estado } = useAcessoPlataforma();
  if (!acessoConfirmado(estado)) return null;
  return (
    <Link
      href={ROTA_ADMINISTRACAO}
      className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent hover:underline"
    >
      <ShieldCheck size={18} aria-hidden="true" /> Administração da plataforma
    </Link>
  );
}

/** Faixa no topo de toda página da administração. Sem papel de alerta ou
 * status: é um rótulo fixo, não um aviso. */
function FaixaAdministracao() {
  const { estado } = useRealAuth();
  const contexto =
    estado.status === "autenticado" && estado.tenantIdAtivo
      ? encontrarContextoPorTenantId(estado.sessao, estado.tenantIdAtivo)
      : null;
  return (
    <section
      aria-label="Modo de uso"
      data-testid="faixa-administracao"
      className="flex flex-col gap-2 rounded-xl border border-border bg-accent-soft p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <ShieldCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="font-semibold text-ink">Você está administrando a plataforma</p>
          <p className="mt-0.5 break-words text-ink-soft">
            {contexto ? (
              <>
                Seu estabelecimento ativo continua sendo <strong>{contexto.tenantName}</strong>.
                Consultar outra empresa aqui não troca esse estabelecimento nem cria vínculo.
              </>
            ) : (
              <>Sua conta não tem estabelecimento vinculado, e isso não impede a administração.</>
            )}
          </p>
        </div>
      </div>
      {contexto && (
        <Link
          href="/conta/agendamentos"
          className="inline-flex min-h-11 shrink-0 items-center font-medium text-[color:var(--color-accent-hover)] hover:underline"
        >
          Voltar à agenda
        </Link>
      )}
    </section>
  );
}

/** Portão das páginas `/conta/administracao/**`: só mostra o conteúdo com o
 * acesso confirmado pelo backend. Os estados ficam na área central, com o
 * mesmo menu, e nunca viram uma tela vazia ou um "zero". */
export function PortaoAdministracao({ children }: { children: ReactNode }) {
  const { estado, recarregar } = useAcessoPlataforma();
  let conteudo: ReactNode;
  if (estado.status !== "pronto") conteudo = <EstadoLeitura estado={estado} recarregar={recarregar} />;
  else if (!estado.dados.canViewEstablishments)
    conteudo = <EstadoLeitura estado={{ status: "erro", motivo: "permissao" }} recarregar={recarregar} />;
  else
    conteudo = (
      <>
        <FaixaAdministracao />
        {children}
      </>
    );
  return <div className="mx-auto w-full max-w-6xl space-y-6">{conteudo}</div>;
}
