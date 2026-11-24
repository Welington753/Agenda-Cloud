"use client";

// Login (Lote 6C.1) — o formulário fala com o backend real (POST /auth/login,
// cookie HttpOnly). A demonstração não entra por aqui: ela fica na página
// inicial ("Ver demonstração"), e esta página não importa nada dela (guardas
// em src/lib/servicos/sem-dados-demo*.test.ts).
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { ROTA_PADRAO_POS_LOGIN, sanitizarDestinoInterno } from "@/lib/auth/safe-redirect";
import { useToast } from "@/components/ui/toast";
import { FormularioLogin } from "@/components/auth/formulario-login";
import { MarcaTimVix } from "@/components/marca/marca";
import { Cartao } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageConteudo />
    </Suspense>
  );
}

// `useSearchParams` (para `?next=`) exige um limite de Suspense em builds de
// produção (ver node_modules/next/dist/docs, "Missing Suspense boundary with
// useSearchParams") — por isso o conteúdo real fica separado do export
// default acima.
function LoginPageConteudo() {
  const { notificar } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  function destinoPosLogin(): string {
    const next = sanitizarDestinoInterno(searchParams.get("next"));
    return next ?? ROTA_PADRAO_POS_LOGIN;
  }

  // Coluna única, a mesma em qualquer largura e nos quatro temas (só tokens).
  // Altura: o contêiner tem altura mínima da tela, em coluna, e o bloco usa
  // `my-auto`. Sobrando altura, o bloco fica no meio; faltando (tela baixa,
  // teclado aberto), as margens automáticas viram zero e a página rola a
  // partir do topo. Nada fica inalcançável: não há altura fixa nem
  // `overflow-hidden`, e `justify-center` não é usado porque, com conteúdo
  // maior que a tela, empurraria o topo para fora da área de rolagem.
  return (
    <div className="flex min-h-dvh flex-col px-4 py-6 sm:px-6 sm:py-10">
      <main className="mx-auto my-auto w-full max-w-md">
        <div className="mb-5 flex flex-col items-center text-center sm:mb-6">
          <MarcaTimVix className="text-base text-ink" tamanho={24} />
          <h1 className="mt-4 text-xl font-bold text-ink sm:mt-5 sm:text-2xl">Acesse sua conta</h1>
          <p className="mt-1 text-sm text-ink-soft">Acesso de gestores e equipe.</p>
        </div>

        <Cartao className="space-y-4 p-5 sm:p-7">
          <FormularioLogin
            aoEntrar={() => router.push(destinoPosLogin())}
            placeholder="Seu e-mail ou login"
            dica="Equipe: use o login que o responsável criou para você. Ele pode parecer um e-mail sem ser um."
            acaoSenha={
              <button
                type="button"
                onClick={() =>
                  notificar("Peça à administração o envio de um link de redefinição para o seu e-mail.", "info")
                }
                className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline"
              >
                Esqueci minha senha
              </button>
            }
          />

          {/* Não há cadastro aberto: o acesso real vem do convite da
              administração. */}
          <p className="border-t border-border pt-4 text-center text-sm text-ink-soft">
            <span className="block">Ainda não tem acesso?</span>
            <Link href="/cadastro" className="mt-0.5 inline-flex min-h-11 items-center font-medium text-accent hover:underline">
              Saiba como obter
            </Link>
          </p>
        </Cartao>

        <div className="mt-4 space-y-2 text-center text-sm text-ink-soft">
          {/* `<details>` nativo: toque, teclado e leitor de tela. */}
          <details className="group mx-auto max-w-sm">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-control)] font-medium hover:text-ink [&::-webkit-details-marker]:hidden">
              <ShieldCheck size={16} aria-hidden="true" className="shrink-0" />
              Quem pode acessar?
              <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-1 text-left text-xs">
              Acesso reservado à equipe de cada estabelecimento (donos, gerentes, recepcionistas e profissionais).
              Consumidores finais não precisam de login: agendam pela página pública do estabelecimento.
            </p>
          </details>
          <p className="text-xs">
            <Link href="/" className="underline hover:text-ink">
              ← Voltar para a apresentação
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
