"use client";

// Liberação do segundo fator recebida por e-mail (`/portal/liberacao-2fa#t=…`).
// O token vem no FRAGMENTO (o navegador não o envia a servidor nenhum) e vai
// só no corpo do POST. A liberação não dá acesso: a pessoa entra com a senha
// e, nesta sessão, pode cadastrar um novo aplicativo autenticador por 30
// minutos. Depois de usada, a pessoa vai para a Segurança da conta.
//
// Sem sessão: o token fica só nesta aba (sessionStorage, apagado ao usar) e a
// pessoa passa pela entrada do portal, que volta para cá.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { usarLiberacao } from "@/lib/api/segundo-fator-api";
import { mensagemDaFalha } from "@/lib/administracao/segundo-fator";
import { entradaDoPortal, ROTA_LIBERACAO_SEGUNDO_FATOR, ROTA_SEGURANCA } from "@/lib/administracao/rotas";
import { MarcadorAparencia } from "@/components/aparencia/aparencia";
import { MarcaAgendaCloud } from "@/components/marca/marca";

const CHAVE = "agenda:liberacao-2fa";

function lerToken(): string | null {
  const doFragmento = /^#t=([0-9a-f]{64})$/.exec(window.location.hash)?.[1] ?? null;
  try {
    if (doFragmento) {
      window.sessionStorage.setItem(CHAVE, doFragmento);
      window.history.replaceState(null, "", window.location.pathname);
      return doFragmento;
    }
    return window.sessionStorage.getItem(CHAVE);
  } catch {
    return doFragmento;
  }
}

function esquecerToken() {
  try {
    window.sessionStorage.removeItem(CHAVE);
  } catch {
    // Sem armazenamento: nada guardado.
  }
}

export default function LiberacaoDoSegundoFator() {
  const { estado } = useRealAuth();
  const router = useRouter();
  const [mensagem, setMensagem] = useState("Conferindo a liberação…");
  const usado = useRef(false);

  useEffect(() => {
    if (estado.status === "carregando" || usado.current) return;
    const token = lerToken();
    if (!token) {
      setMensagem("Este endereço não traz uma liberação. Abra o link do e-mail de novo.");
      return;
    }
    if (estado.status !== "autenticado") {
      router.replace(entradaDoPortal(ROTA_LIBERACAO_SEGUNDO_FATOR));
      return;
    }
    usado.current = true;
    void usarLiberacao(token).then((r) => {
      esquecerToken();
      // Segurança da conta: atrás do portão, que mostra o cadastro (master
      // novo) ou a verificação com a opção de cadastrar o novo aplicativo.
      if (r.ok) router.replace(ROTA_SEGURANCA);
      else setMensagem(mensagemDaFalha(r.falha));
    });
  }, [estado.status, router]);

  return (
    <div className="min-h-screen bg-paper">
      <MarcadorAparencia />
      <header className="bg-chrome text-chrome-ink">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <MarcaAgendaCloud />
          <p className="flex min-w-0 items-center gap-1 text-sm font-semibold">
            <ShieldCheck size={16} aria-hidden="true" className="shrink-0" />
            <span className="truncate">Portal da plataforma</span>
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-sm space-y-4 px-4 py-10">
        <h1 className="text-2xl font-bold text-ink">Verificação em duas etapas</h1>
        <p role="status" className="text-sm text-ink-soft" data-testid="liberacao-mensagem">
          {mensagem}
        </p>
      </main>
    </div>
  );
}
