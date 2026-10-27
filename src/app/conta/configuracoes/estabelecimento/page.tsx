"use client";

// Configurações → Estabelecimento (dono): o estabelecimento ativo, o plano,
// o agendamento online (ligar, copiar e abrir o link público) e o roteiro de
// primeiros passos que antes ficava em "Minha conta".
//
// O roteiro é INFORMATIVO: não consulta nada nem marca etapa como concluída —
// mostrar "feito" sem conferir o servidor seria afirmar algo que a tela não
// sabe.
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { formatarData } from "@/lib/format";
import { ROTA_AGENDA, ROTA_EQUIPE, ROTA_INICIO, ROTA_PROFISSIONAIS, ROTA_SERVICOS } from "@/lib/conta/rotas";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { AgendamentoOnline } from "./agendamento-online";

const PRIMEIROS_PASSOS = [
  {
    titulo: "Cadastre um serviço",
    descricao: "Nome, duração e preço do que você atende.",
    href: ROTA_SERVICOS,
    rotuloLink: "Ir para Serviços",
  },
  {
    titulo: "Cadastre um profissional e vincule os serviços dele",
    descricao: "Pode ser você mesmo. Marque os serviços que essa pessoa atende.",
    href: ROTA_PROFISSIONAIS,
    rotuloLink: "Ir para Profissionais",
  },
  {
    titulo: "Configure os horários desse profissional",
    descricao: "Na lista de profissionais, use o botão “Horários” e informe os dias e turnos de trabalho.",
    href: ROTA_PROFISSIONAIS,
    rotuloLink: "Abrir a lista de profissionais",
  },
  {
    titulo: "Crie o primeiro agendamento",
    descricao: "Na agenda, escolha o dia, o profissional e o serviço, veja os horários livres e marque.",
    href: ROTA_AGENDA,
    rotuloLink: "Ir para a Agenda",
  },
  {
    titulo: "Se quiser, dê um login a cada profissional",
    descricao: "Em Equipe e acessos, dê um acesso a cada pessoa. Ela vê só a própria agenda e o que você liberar.",
    href: ROTA_EQUIPE,
    rotuloLink: "Ir para Equipe e acessos",
  },
] as const;

export default function EstabelecimentoPage() {
  const { estado } = useRealAuth();
  const router = useRouter();
  const sessao = estado.status === "autenticado" ? estado.sessao : null;
  const tenantId = estado.status === "autenticado" ? estado.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantId;

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  if (!sessao || !tenantId) return null;
  const contexto = encontrarContextoPorTenantId(sessao, tenantId);
  if (!contexto) return null;

  return (
    <PaginaConta titulo="Estabelecimento" descricao="Plano, agendamento online e primeiros passos.">
      <Cartao>
        <CartaoCorpo className="space-y-2">
          <div className="flex items-start gap-3">
            <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold break-words text-ink" data-testid="estabelecimento-nome">
                {contexto.tenantName}
              </p>
              <p className="text-xs text-ink-soft">Plano {contexto.planName}</p>
              <p className="text-xs text-ink-soft">
                Período de teste até {formatarData(contexto.trial.trialEndAt)}.
              </p>
            </div>
          </div>
          <p className="text-xs text-ink-soft">
            O uso do plano (profissionais e acessos da equipe) aparece no{" "}
            <Link href={ROTA_INICIO} className="font-medium text-[color:var(--color-accent-hover)] hover:underline">
              Início
            </Link>{" "}
            e em{" "}
            <Link href={ROTA_EQUIPE} className="font-medium text-[color:var(--color-accent-hover)] hover:underline">
              Equipe e acessos
            </Link>
            .
          </p>
        </CartaoCorpo>
      </Cartao>

      <AgendamentoOnline tenantId={tenantId} />

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
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-[color:var(--color-accent-hover)]"
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
    </PaginaConta>
  );
}
