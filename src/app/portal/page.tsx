"use client";

// Entrada PRÓPRIA do portal da plataforma (`/portal`), separada do login da
// operação (`/login`) e sem nenhum passo de estabelecimento: não pede para
// criar, escolher nem possuir um, e não olha plano nem validade.
//
// - Sem sessão: o formulário de login; depois dele, o `next` que aponta para
//   dentro do portal ou a lista de estabelecimentos.
// - Com sessão: segue direto para o mesmo destino.
//
// Esta página não decide quem entra. O portão do portal
// (components/administracao/acesso-administracao.tsx) só mostra conteúdo com
// `GET /platform/access` confirmando o proprietário, e o servidor recusa cada
// leitura e escrita de quem não é `MASTER_OWNER` ativo.
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { sanitizarDestinoInterno } from "@/lib/auth/safe-redirect";
import { destinoNoPortal } from "@/lib/administracao/rotas";
import { FormularioLogin } from "@/components/auth/formulario-login";
import { MarcadorAparencia } from "@/components/aparencia/aparencia";
import { MarcaTimVix } from "@/components/marca/marca";
import { ConectandoAoServidor } from "@/components/conexao/aviso-conexao";

export default function EntradaDoPortal() {
  return (
    <>
      <MarcadorAparencia />
      <Suspense fallback={null}>
        <EntradaDoPortalConteudo />
      </Suspense>
    </>
  );
}

function EntradaDoPortalConteudo() {
  const { estado, conexao } = useRealAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const destino = destinoNoPortal(sanitizarDestinoInterno(searchParams.get("next")));
  const autenticado = estado.status === "autenticado";

  useEffect(() => {
    if (autenticado) router.replace(destino);
  }, [autenticado, destino, router]);

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-chrome text-chrome-ink">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <MarcaTimVix />
          <p className="flex min-w-0 items-center gap-1 text-sm font-semibold">
            <ShieldCheck size={16} aria-hidden="true" className="shrink-0" />
            <span className="truncate">Portal da plataforma</span>
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-sm space-y-6 px-4 py-10">
        {estado.status === "carregando" || autenticado ? (
          estado.status === "carregando" && (conexao === "acordando" || conexao === "sem_internet") ? (
            <ConectandoAoServidor conexao={conexao} />
          ) : (
            <p role="status" className="py-12 text-center text-ink-soft">
              Abrindo o portal…
            </p>
          )
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold text-ink">Entrar no portal</h1>
              <p className="mt-1 text-sm text-ink-soft">Acesso exclusivo dos proprietários da plataforma.</p>
            </div>
            <FormularioLogin aoEntrar={() => router.replace(destino)} placeholder="voce@exemplo.com.br" />
          </>
        )}
      </main>
    </div>
  );
}
