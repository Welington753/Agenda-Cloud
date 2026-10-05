"use client";

// Minha conta — página inicial da área REAL. Nunca carrega agenda, equipe ou
// comissões demonstrativas (isso misturaria dados demo com a conta real).
//
// A ação principal é abrir a agenda; os demais atalhos ficam na navegação
// comum do layout (cabeçalho). O "Primeiros passos" é um roteiro INFORMATIVO:
// não consulta nada nem marca etapa como concluída — mostrar "feito" sem
// conferir o servidor seria afirmar algo que a tela não sabe.
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Store } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { ROTULO_PAPEL_ESTABELECIMENTO_REAL } from "@/lib/auth/role-labels";
import { formatarData } from "@/lib/format";
import { LinkBotao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

const PRIMEIROS_PASSOS = [
  {
    titulo: "Cadastre um serviço",
    descricao: "Nome, duração e preço do que você atende.",
    href: "/conta/servicos",
    rotuloLink: "Ir para Serviços",
  },
  {
    titulo: "Cadastre um profissional e vincule os serviços dele",
    descricao: "Pode ser você mesmo. Marque os serviços que essa pessoa atende.",
    href: "/conta/profissionais",
    rotuloLink: "Ir para Profissionais",
  },
  {
    titulo: "Configure os horários desse profissional",
    descricao: "Na lista de profissionais, use o botão “Horários” e informe os dias e turnos de trabalho.",
    href: "/conta/profissionais",
    rotuloLink: "Abrir a lista de profissionais",
  },
  {
    titulo: "Crie o primeiro agendamento",
    descricao: "Na agenda, escolha o dia, o profissional e o serviço, veja os horários livres e marque.",
    href: "/conta/agendamentos",
    rotuloLink: "Ir para a Agenda",
  },
] as const;

export default function ContaPage() {
  const { estado } = useRealAuth();
  const router = useRouter();

  const sessao = estado.status === "autenticado" ? estado.sessao : null;
  const tenantIdAtivo = estado.status === "autenticado" ? estado.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  if (!sessao || precisaSelecionar) return null;

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
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
        <>
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
              {/* Ação principal: a agenda real do Lote 6D.5 — nunca a agenda
                  demonstrativa de /painel/agenda. */}
              <LinkBotao href="/conta/agendamentos" tamanho="lg" className="w-full sm:w-auto" data-testid="abrir-agenda">
                <CalendarDays size={18} aria-hidden="true" />
                Abrir agenda
              </LinkBotao>
            </CartaoCorpo>
          </Cartao>

          <Cartao>
            <CartaoCorpo className="space-y-3">
              <div>
                <h2 className="text-base font-semibold text-ink">Primeiros passos</h2>
                <p className="text-xs text-ink-soft">
                  Um roteiro para deixar a agenda pronta. Ele não confere o que já foi feito — siga na ordem.
                </p>
              </div>
              <ol className="space-y-3" data-testid="primeiros-passos">
                {PRIMEIROS_PASSOS.map((passo, indice) => (
                  <li key={passo.titulo} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-accent text-xs font-bold text-accent"
                    >
                      {indice + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{passo.titulo}</p>
                      <p className="text-sm text-ink-soft">{passo.descricao}</p>
                      <Link
                        href={passo.href}
                        className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline"
                      >
                        {passo.rotuloLink}
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            </CartaoCorpo>
          </Cartao>

          <p className="text-xs text-ink-soft">
            Equipe, comissões e demais funcionalidades desta conta real ainda não estão conectadas nesta fase —
            chegam em um próximo lote.
          </p>
        </>
      )}
    </main>
  );
}
