"use client";

// Painel honesto da conta REAL — nunca carrega agenda/equipe/comissões
// demonstrativas (isso seria misturar dados demo com conta real, proibido
// pelo lote). Funcionalidades de negócio ainda não têm API própria neste
// lote: mostrar isso claramente em vez de simular sucesso é o requisito
// central da seção 6 do AGENTS.md deste lote.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Store, Users2, Wrench } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { ROTULO_PAPEL_ESTABELECIMENTO_REAL } from "@/lib/auth/role-labels";
import { formatarData } from "@/lib/format";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { NOME_PRODUTO } from "@/lib/config";

export default function ContaPage() {
  const { estado, logout } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();

  const sessao = estado.status === "autenticado" ? estado.sessao : null;
  const tenantIdAtivo = estado.status === "autenticado" ? estado.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  if (!sessao || precisaSelecionar) return null;

  async function aoSair() {
    const resultado = await logout();
    notificar(
      resultado.confirmadoPeloServidor
        ? "Sessão encerrada."
        : "Não foi possível confirmar o encerramento com o servidor. Você saiu apenas neste dispositivo.",
      resultado.confirmadoPeloServidor ? "sucesso" : "info",
    );
    router.push("/login");
  }

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-ink px-6 py-4 text-white">
        <p className="font-bold tracking-tight">{NOME_PRODUTO}</p>
        <Botao
          type="button"
          variante="fantasma"
          className="text-white/80 hover:text-white"
          onClick={() => void aoSair()}
        >
          <LogOut size={16} className="mr-1.5" />
          Sair
        </Botao>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-10">
        <div>
          <h1 className="text-xl font-bold text-ink">Olá, {sessao.user.name.split(" ")[0]}</h1>
          <p className="text-sm text-ink-soft">{sessao.user.email}</p>
        </div>

        {!sessao.hasEstablishmentAccess && (
          <Cartao>
            <CartaoCorpo className="flex items-start gap-3">
              <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
              <div>
                <p className="text-sm font-semibold text-ink">Sua conta ainda não está vinculada a um estabelecimento</p>
                <p className="mt-1 text-sm text-ink-soft">
                  O cadastro completo de estabelecimento para contas reais ainda não está disponível nesta fase.
                </p>
              </div>
            </CartaoCorpo>
          </Cartao>
        )}

        {contexto && (
          <Cartao>
            <CartaoCorpo className="space-y-4">
              <div className="flex items-start gap-3">
                <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
                <div>
                  <p className="text-sm font-semibold text-ink">{contexto.tenantName}</p>
                  <p className="text-xs text-ink-soft">
                    {ROTULO_PAPEL_ESTABELECIMENTO_REAL[contexto.role]} · Plano {contexto.planName}
                  </p>
                </div>
              </div>
              <p className="text-xs text-ink-soft">
                Período de teste até {formatarData(contexto.trial.trialEndAt)}.
              </p>
              <div className="flex flex-wrap gap-2">
                {/* Serviços é a primeira funcionalidade de negócio real desta
                    conta (Lote 6D.1) — nunca a tela demonstrativa de
                    /painel/servicos. */}
                <Botao
                  type="button"
                  variante="secundaria"
                  tamanho="sm"
                  onClick={() => router.push("/conta/servicos")}
                >
                  <Wrench size={14} className="mr-1.5" />
                  Gerenciar serviços
                </Botao>
                {sessao.contexts.length > 1 && (
                  <Botao
                    type="button"
                    variante="secundaria"
                    tamanho="sm"
                    onClick={() => router.push("/conta/selecionar-estabelecimento")}
                  >
                    <Users2 size={14} className="mr-1.5" />
                    Trocar de estabelecimento
                  </Botao>
                )}
              </div>
              <p className="border-t border-dashed border-border pt-3 text-xs text-ink-soft">
                Agenda, equipe e demais funcionalidades desta conta real ainda não estão conectadas nesta
                fase — chegam em um próximo lote.
              </p>
            </CartaoCorpo>
          </Cartao>
        )}
      </main>
    </div>
  );
}
