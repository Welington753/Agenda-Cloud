"use client";

// Visão geral da área REAL: o resumo de HOJE do estabelecimento ativo — quatro
// indicadores, quem está sendo atendido agora e os próximos atendimentos.
//
// DE ONDE VÊM OS NÚMEROS: da mesma consulta da agenda (useAgendamentosReais →
// GET /tenants/:id/appointments?date=), no "hoje" do fuso do estabelecimento
// (useDiaDoEstabelecimento, a mesma regra da tela de agenda). Nada de rota
// nova, nada de dado da demonstração.
//
// QUANDO NÃO HÁ NÚMERO: carregando, falha de comunicação, sem permissão, lista
// sem prova de estar completa (`completa: false`) ou resposta de outro dia —
// cada um com o seu estado. Zero só aparece quando uma resposta válida, do dia
// certo e completa, prova que é zero.
//
// Sem faturamento, recebimentos, ocupação ou gráficos neste lote.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  CircleDashed,
  Clock,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  Store,
} from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { useAgendamentosReais } from "@/lib/profissionais/use-agendamentos-reais";
import { useDiaDoEstabelecimento } from "@/lib/profissionais/use-dia-do-estabelecimento";
import { hojeNoFuso, mensagemFalhaAgenda } from "@/lib/profissionais/agenda-visual";
import { rotuloDaData } from "@/lib/profissionais/agendamentos";
import {
  atendimentosEmAndamento,
  avaliarAgendaDeHoje,
  indicadoresDoDia,
  proximosAtendimentos,
} from "@/lib/conta/visao-geral";
import type { AgendamentoReal } from "@/lib/api/appointments-api";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoSolicitacoes } from "@/components/conta/aviso-solicitacoes";
import { CartaoAtendimento, StatusDoAtendimento } from "@/components/conta/cartao-atendimento";
import { Botao, LinkBotao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { EstatisticaCard } from "@/components/ui/estatistica-card";
import { Skeleton } from "@/components/ui/skeleton";

/** Quantos próximos atendimentos a Visão geral mostra; o resto fica na agenda. */
const LIMITE_DE_PROXIMOS = 8;

export default function VisaoGeralPage() {
  const { estado: estadoSessao } = useRealAuth();
  const router = useRouter();

  const sessao = estadoSessao.status === "autenticado" ? estadoSessao.sessao : null;
  const tenantIdAtivo = estadoSessao.status === "autenticado" ? estadoSessao.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  const { date, timezone, irParaHoje, sincronizar } = useDiaDoEstabelecimento(tenantIdAtivo);
  const { estado, recarregar } = useAgendamentosReais(tenantIdAtivo, date);
  const agenda = estado.status === "carregada" ? estado.agenda : null;

  // Relógio do navegador, relido a cada 30 s: decide o que ainda é "próximo".
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  useEffect(() => {
    if (!agenda) return;
    sincronizar(agenda);
    setAgora(new Date());
  }, [agenda, sincronizar]);

  // A tela fica aberta: virou o dia no fuso do estabelecimento, o resumo passa
  // para o dia novo em vez de continuar mostrando o de ontem como "hoje".
  useEffect(() => {
    if (!timezone) return;
    const hoje = hojeNoFuso(timezone, agora);
    if (hoje && hoje !== date) irParaHoje();
  }, [agora, timezone, date, irParaHoje]);

  if (!sessao || precisaSelecionar) return null;

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  if (!contexto) {
    return (
      <PaginaConta titulo="Visão geral">
        <Cartao>
          <CartaoCorpo className="flex items-start gap-3">
            <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
            <p className="text-sm text-ink-soft">
              Sua conta ainda não está vinculada a um estabelecimento.
            </p>
          </CartaoCorpo>
        </Cartao>
      </PaginaConta>
    );
  }

  const avaliacao = agenda ? avaliarAgendaDeHoje(agenda, agora) : null;
  const carregando =
    estado.status === "carregando" ||
    (estado.status === "carregada" && avaliacao?.tipo === "ajustando");

  return (
    <PaginaConta
      titulo="Visão geral"
      descricao={
        <>
          Resumo de hoje, <span className="first-letter:uppercase">{rotuloDaData(date)}</span>
          {timezone && <span> · fuso {timezone}</span>}
        </>
      }
      acoes={
        <>
          <LinkBotao href="/conta/agendamentos" variante="secundaria" data-testid="atalho-agenda">
            <CalendarDays size={16} aria-hidden="true" />
            Abrir agenda
          </LinkBotao>
          <LinkBotao href="/conta/agendamentos?novo=1" data-testid="atalho-novo-agendamento">
            <CalendarPlus size={16} aria-hidden="true" />
            Novo agendamento
          </LinkBotao>
        </>
      }
    >
      <AvisoSolicitacoes tenantId={contexto.tenantId} />

      {carregando && <Carregando />}

      {estado.status === "falha" &&
        (estado.falha.tipo === "sem_permissao" || estado.falha.tipo === "sem_acesso" ? (
          <Cartao data-testid="visao-geral-sem-permissao">
            <CartaoCorpo className="flex items-start gap-3">
              <ShieldAlert size={20} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden="true" />
              <p role="alert" className="text-sm text-ink">
                Você não tem permissão para ver a agenda deste estabelecimento, então o resumo do
                dia não pode ser mostrado.
              </p>
            </CartaoCorpo>
          </Cartao>
        ) : (
          <Cartao data-testid="visao-geral-erro">
            <CartaoCorpo className="space-y-3">
              <p role="alert" className="text-sm text-ink">
                {mensagemFalhaAgenda(estado.falha)}
              </p>
              <Botao type="button" onClick={recarregar}>
                Tentar novamente
              </Botao>
            </CartaoCorpo>
          </Cartao>
        ))}

      {avaliacao?.tipo === "incompleto" && (
        <Cartao data-testid="visao-geral-incompleta">
          <CartaoCorpo className="flex items-start gap-3">
            <AlertTriangle
              size={20}
              className="mt-0.5 shrink-0 text-[color:var(--color-warning)]"
              aria-hidden="true"
            />
            <div className="space-y-2">
              <p role="alert" className="text-sm text-ink">
                O dia de hoje tem mais reservas do que a consulta traz de uma vez, então os totais
                não são mostrados para não ficarem errados.
              </p>
              <Link
                href="/conta/agendamentos"
                className="text-sm font-semibold text-[color:var(--color-accent-hover)] underline"
              >
                Ver a agenda do dia
              </Link>
            </div>
          </CartaoCorpo>
        </Cartao>
      )}

      {avaliacao?.tipo === "pronto" && (
        <Resumo
          agendamentos={avaliacao.agenda.appointments}
          agora={agora}
          aoAtualizar={recarregar}
        />
      )}
    </PaginaConta>
  );
}

function Resumo({
  agendamentos,
  agora,
  aoAtualizar,
}: {
  agendamentos: AgendamentoReal[];
  agora: Date;
  aoAtualizar: () => void;
}) {
  const indicadores = indicadoresDoDia(agendamentos);
  const emAndamento = atendimentosEmAndamento(agendamentos);
  const proximos = proximosAtendimentos(agendamentos, agora);

  return (
    <div className="space-y-6">
      <section aria-label="Indicadores de hoje" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <EstatisticaCard
          icone={CalendarCheck}
          rotulo="Agendamentos"
          valor={String(indicadores.agendamentos)}
          testId="indicador-agendamentos"
        />
        <EstatisticaCard
          icone={CircleDashed}
          rotulo="Aguardando confirmação"
          valor={String(indicadores.aguardandoConfirmacao)}
          corIcone="warning"
          testId="indicador-aguardando"
        />
        <EstatisticaCard
          icone={PlayCircle}
          rotulo="Em atendimento"
          valor={String(indicadores.emAtendimento)}
          corIcone="info"
          testId="indicador-em-atendimento"
        />
        <EstatisticaCard
          icone={CheckCircle2}
          rotulo="Concluídos"
          valor={String(indicadores.concluidos)}
          corIcone="success"
          testId="indicador-concluidos"
        />
      </section>

      {emAndamento.length > 0 && (
        <section aria-labelledby="titulo-em-andamento" className="space-y-3">
          <h2 id="titulo-em-andamento" className="text-base font-semibold text-ink">
            Em atendimento agora
          </h2>
          <ul data-testid="em-andamento" className="space-y-3">
            {emAndamento.map((a) => (
              <li key={a.id}>
                <CartaoAtendimento agendamento={a} noHorario={false} recemCriada={false} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="titulo-proximos" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="titulo-proximos" className="text-base font-semibold text-ink">
            Próximos atendimentos de hoje
          </h2>
          <Botao type="button" variante="fantasma" tamanho="sm" onClick={aoAtualizar}>
            <RefreshCw size={14} aria-hidden="true" />
            Atualizar
          </Botao>
        </div>
        {proximos.length === 0 ? (
          <div data-testid="sem-proximos">
            <EstadoVazio
              icone={Clock}
              titulo="Nenhum atendimento por vir hoje."
              descricao="Os que já começaram ou terminaram ficam na agenda do dia."
            />
          </div>
        ) : (
          <Cartao>
            <ul data-testid="proximos-atendimentos" className="divide-y divide-border">
              {proximos.slice(0, LIMITE_DE_PROXIMOS).map((a) => (
                <LinhaProximo key={a.id} agendamento={a} />
              ))}
            </ul>
            {proximos.length > LIMITE_DE_PROXIMOS && (
              <p className="border-t border-border px-4 py-3 text-sm text-ink-soft sm:px-5">
                Mais {proximos.length - LIMITE_DE_PROXIMOS} na{" "}
                <Link
                  href="/conta/agendamentos"
                  className="font-semibold text-[color:var(--color-accent-hover)] underline"
                >
                  agenda do dia
                </Link>
                .
              </p>
            )}
          </Cartao>
        )}
      </section>
    </div>
  );
}

function LinhaProximo({ agendamento }: { agendamento: AgendamentoReal }) {
  return (
    <li
      // Celular: o status desce para baixo do nome, que nunca é cortado por ele.
      // Computador: o status fica à direita. Um elemento só, posicionado pela grade.
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5 sm:px-5"
      data-testid="proximo-atendimento"
    >
      <p className="row-span-2 w-14 shrink-0 tabular-nums sm:row-span-1 sm:w-16">
        <span className="block text-lg leading-tight font-bold text-ink">
          {agendamento.localStart}
        </span>
        <span className="sr-only">–</span>
        <span className="block text-xs text-ink-soft">{agendamento.localServiceEnd}</span>
      </p>
      <div className="min-w-0">
        <p className="font-semibold break-words text-ink" data-testid="proximo-cliente">
          {agendamento.consumer.name}
        </p>
        <p className="truncate text-sm text-ink-soft">
          {agendamento.service.name} · com {agendamento.professional.name}
        </p>
      </div>
      <div className="col-start-2 sm:col-start-3 sm:row-start-1">
        <StatusDoAtendimento status={agendamento.status} />
      </div>
    </li>
  );
}

function Carregando() {
  return (
    <div className="space-y-6" aria-busy="true" data-testid="visao-geral-carregando">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
