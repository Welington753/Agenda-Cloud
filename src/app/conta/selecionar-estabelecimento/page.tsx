"use client";

// Seletor de estabelecimento para contas reais com mais de um vínculo. A
// "validação no backend" exigida pelo lote já aconteceu antes deste
// componente existir: `sessao.contexts` é exatamente a lista de Memberships
// utilizáveis que o backend calculou em /auth/login ou /auth/me (ver
// session-context.ts no backend) — este componente nunca aceita um
// `tenantId` fora dessa lista (ver `selecionarTenant` em
// real-session-state.ts), então não existe caminho para "escolher" um
// estabelecimento de outro usuário digitando um ID.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { ROTULO_PAPEL_ESTABELECIMENTO_REAL } from "@/lib/auth/role-labels";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { NOME_PRODUTO } from "@/lib/config";

export default function SelecionarEstabelecimentoPage() {
  const { estado, selecionarTenantAtivo } = useRealAuth();
  const router = useRouter();

  const sessao = estado.status === "autenticado" ? estado.sessao : null;

  useEffect(() => {
    if (!sessao) return;
    // Nada para escolher (0 ou 1 contexto) — esta tela não se aplica.
    if (sessao.contexts.length <= 1) router.replace("/conta");
  }, [sessao, router]);

  if (!sessao || sessao.contexts.length <= 1) return null;

  function escolher(tenantId: string) {
    if (selecionarTenantAtivo(tenantId)) router.push("/conta");
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-paper px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <p className="text-sm font-semibold text-accent">{NOME_PRODUTO}</p>
          <h1 className="mt-1 text-xl font-bold text-ink">Escolha um estabelecimento</h1>
          <p className="mt-1 text-sm text-ink-soft">Sua conta tem acesso a mais de um estabelecimento.</p>
        </div>

        <div className="space-y-2">
          {sessao.contexts.map((contexto) => (
            <button key={contexto.tenantId} type="button" onClick={() => escolher(contexto.tenantId)} className="w-full text-left">
              <Cartao className="transition-colors hover:border-accent">
                <CartaoCorpo className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper-muted text-ink-soft">
                    <Store size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{contexto.tenantName}</p>
                    <p className="text-xs text-ink-soft">
                      {ROTULO_PAPEL_ESTABELECIMENTO_REAL[contexto.role]} · Plano {contexto.planName}
                    </p>
                  </div>
                </CartaoCorpo>
              </Cartao>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
