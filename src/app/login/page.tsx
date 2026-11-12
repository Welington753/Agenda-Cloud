"use client";

// Login (Lote 6C.1) — o formulário fala com o backend real (POST /auth/login,
// cookie HttpOnly). A demonstração não entra por aqui: ela fica na página
// inicial ("Ver demonstração"), e esta página não importa nada dela (guardas
// em src/lib/servicos/sem-dados-demo*.test.ts).
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { ROTA_PADRAO_POS_LOGIN, sanitizarDestinoInterno } from "@/lib/auth/safe-redirect";
import { useToast } from "@/components/ui/toast";
import { FormularioLogin } from "@/components/auth/formulario-login";
import { MarcaTimVix } from "@/components/marca/marca";

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

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-chrome p-10 text-chrome-ink lg:flex">
        <div>
          <MarcaTimVix />
        </div>
        <div className="max-w-sm space-y-4">
          <div className="flex size-12 items-center justify-center rounded-[var(--radius-card)] bg-chrome-selected">
            <ShieldCheck size={24} />
          </div>
          <h2 className="text-2xl font-bold">Acesso reservado à equipe</h2>
          <p className="text-sm text-chrome-ink-soft">
            Esta é a porta de entrada da equipe de cada estabelecimento
            (donos, gerentes, recepcionistas e profissionais). Consumidores finais nunca precisam fazer login — eles
            agendam direto pela página pública do estabelecimento.
          </p>
        </div>
        <p className="text-xs text-chrome-ink-soft">Protótipo em transição para autenticação real.</p>
      </div>

      <div className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm space-y-6">
          <div className="lg:hidden">
            <MarcaTimVix className="text-sm text-ink" tamanho={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink">Entrar</h1>
            <p className="mt-1 text-sm text-ink-soft">Acesso de gestores e equipe.</p>
          </div>

          <FormularioLogin
            aoEntrar={() => router.push(destinoPosLogin())}
            placeholder="voce@seuestabelecimento.com.br ou seu login"
            dica="Equipe: use o login que o responsável criou para você. Ele pode parecer um e-mail sem ser um."
            extra={
              <div className="flex items-center justify-end text-sm">
                <button
                  type="button"
                  onClick={() =>
                    notificar("Peça à administração o envio de um link de redefinição para o seu e-mail.", "info")
                  }
                  className="font-medium text-accent hover:underline"
                >
                  Esqueci minha senha
                </button>
              </div>
            }
          />

          {/* Não há cadastro aberto: o acesso real vem do convite da
              administração. */}
          <div className="space-y-3 border-t border-border pt-6 text-center">
            <p className="text-sm text-ink-soft">
              Ainda não tem acesso?{" "}
              <Link href="/cadastro" className="font-medium text-accent hover:underline">
                Saiba como obter
              </Link>
            </p>
            <p className="text-xs text-ink-soft">
              <Link href="/" className="underline hover:text-ink">
                ← Voltar para a apresentação
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
