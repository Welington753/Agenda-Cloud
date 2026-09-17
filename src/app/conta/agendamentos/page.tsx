"use client";

// Agendamentos reais do estabelecimento (Lote 6D.5). Vive sob `/conta`, área
// REAL: nada de repositório, seed ou dado da demonstração entra aqui
// (auditado por lib/servicos/sem-dados-demo.test.ts).
//
// ESCOPO: criar e consultar. Não há cancelamento, remarcação nem mudança
// manual de status neste lote — o backend também não tem rota para isso.
//
// Fuso: a tela EXIBE as horas locais que o backend devolve
// (`localStart`/`localServiceEnd`) e nunca converte nada com o relógio do
// navegador.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarDays, RefreshCw, Store } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { useProfissionaisReais } from "@/lib/profissionais/use-profissionais-reais";
import { useAgendamentosReais } from "@/lib/profissionais/use-agendamentos-reais";
import {
  comoDataDeCalendario,
  mensagemFalhaAgendamento,
  resumoDoAgendamento,
  ROTULO_STATUS,
  rotuloDaData,
  rotuloDeDuracao,
  rotuloDePreco,
} from "@/lib/profissionais/agendamentos";
import type { AgendamentoReal, SelecaoDeCliente } from "@/lib/api/appointments-api";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { NovaReserva } from "./nova-reserva";

export default function AgendamentosPage() {
  const { estado: estadoSessao } = useRealAuth();
  const { notificar } = useToast();
  const router = useRouter();

  const sessao = estadoSessao.status === "autenticado" ? estadoSessao.sessao : null;
  const tenantIdAtivo = estadoSessao.status === "autenticado" ? estadoSessao.tenantIdAtivo : null;
  const precisaSelecionar = !!sessao && sessao.requiresTenantSelection && !tenantIdAtivo;

  // `useState` com inicializador: o "hoje" do navegador é lido UMA vez, como
  // ponto de partida editável. Quem interpreta a data no fuso do
  // estabelecimento é sempre o servidor.
  const [date, setDate] = useState(() => comoDataDeCalendario(new Date()));
  const [erroReserva, setErroReserva] = useState<string | null>(null);
  const [ultimaReserva, setUltimaReserva] = useState<AgendamentoReal | null>(null);

  const { estado, gravando, recarregar, criar } = useAgendamentosReais(tenantIdAtivo, date);
  const { estado: estadoProfissionais } = useProfissionaisReais(tenantIdAtivo);

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  // Trocar de estabelecimento invalida o que está na tela: a última reserva e
  // o erro são de outro contexto.
  useEffect(() => {
    setUltimaReserva(null);
    setErroReserva(null);
  }, [tenantIdAtivo]);

  if (!sessao || precisaSelecionar) return null;

  const contexto = tenantIdAtivo ? encontrarContextoPorTenantId(sessao, tenantIdAtivo) : null;

  if (!contexto || !tenantIdAtivo) {
    return (
      <Pagina titulo="Agendamentos">
        <Cartao>
          <CartaoCorpo className="flex items-start gap-3">
            <Store size={20} className="mt-0.5 shrink-0 text-ink-soft" />
            <p className="text-sm text-ink-soft">
              Sua conta ainda não está vinculada a um estabelecimento.
            </p>
          </CartaoCorpo>
        </Cartao>
      </Pagina>
    );
  }

  async function aoConfirmar(dados: {
    professionalId: string;
    serviceId: string;
    startAt: string;
    consumer: SelecaoDeCliente;
  }): Promise<AgendamentoReal | null> {
    setErroReserva(null);
    const resultado = await criar(dados);

    if (resultado.ok) {
      setUltimaReserva(resultado.dados);
      notificar("Agendamento confirmado.", "sucesso");
      return resultado.dados;
    }

    setErroReserva(mensagemFalhaAgendamento(resultado.falha));

    // 409: a agenda mudou entre a consulta e o envio — a lista do dia é
    // recarregada para a pessoa ver o que passou a ocupar o horário. Nunca
    // reenvia sozinho.
    if (resultado.falha.tipo === "horario_ocupado") {
      recarregar();
    }
    // Falha de comunicação NÃO recarrega automaticamente nem reenvia: a
    // mensagem orienta a conferir a agenda, e o botão abaixo faz isso quando
    // a pessoa decidir.
    return null;
  }

  const agenda = estado.status === "carregada" ? estado.agenda : null;

  return (
    <Pagina titulo="Agendamentos" subtitulo={contexto.tenantName}>
      <Cartao>
        <CartaoCorpo className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="data" className="mb-1 block text-xs font-medium text-ink-soft">
              Dia
            </label>
            <input
              id="data"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>
          <Botao type="button" variante="secundaria" onClick={recarregar}>
            <RefreshCw size={14} className="mr-1" />
            Atualizar agenda
          </Botao>
          {agenda && (
            <span className="text-xs text-ink-soft">
              {rotuloDaData(agenda.date)} · fuso {agenda.timezone}
            </span>
          )}
        </CartaoCorpo>
      </Cartao>

      {ultimaReserva && (
        <Cartao>
          <CartaoCorpo className="space-y-1" data-testid="confirmacao">
            <p className="text-sm font-semibold text-ink">Agendamento confirmado</p>
            <p className="text-sm text-ink">{resumoDoAgendamento(ultimaReserva)}</p>
            <p className="text-xs text-ink-soft">
              Identificação: <span data-testid="id-reserva">{ultimaReserva.id}</span> ·{" "}
              {ROTULO_STATUS[ultimaReserva.status]}
            </p>
          </CartaoCorpo>
        </Cartao>
      )}

      <NovaReserva
        tenantId={tenantIdAtivo}
        date={date}
        profissionais={
          estadoProfissionais.status === "carregada" ? estadoProfissionais.profissionais : []
        }
        gravando={gravando}
        erro={erroReserva}
        aoConfirmar={aoConfirmar}
      />

      <div className="space-y-3">
        <p className="text-sm font-semibold text-ink">Agenda do dia</p>

        {estado.status === "carregando" && (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}

        {estado.status === "falha" && (
          <Cartao>
            <CartaoCorpo className="space-y-3">
              <p role="alert" className="text-sm text-ink">
                {mensagemFalhaAgendamento(estado.falha)}
              </p>
              {estado.falha.tipo !== "sem_permissao" && estado.falha.tipo !== "sem_acesso" && (
                <Botao type="button" onClick={recarregar}>
                  Tentar novamente
                </Botao>
              )}
            </CartaoCorpo>
          </Cartao>
        )}

        {agenda && agenda.appointments.length === 0 && (
          <Cartao>
            <CartaoCorpo className="flex items-start gap-3">
              <CalendarDays size={18} className="mt-0.5 shrink-0 text-ink-soft" />
              <p data-testid="agenda-vazia" className="text-sm text-ink-soft">
                Nenhum agendamento neste dia.
              </p>
            </CartaoCorpo>
          </Cartao>
        )}

        {agenda && agenda.appointments.length > 0 && (
          <ul data-testid="agenda-do-dia" className="space-y-2">
            {agenda.appointments.map((agendamento) => (
              <li key={agendamento.id}>
                <Cartao>
                  <CartaoCorpo className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink" data-testid="horario-agendado">
                        {agendamento.localStart}–{agendamento.localServiceEnd}
                      </p>
                      <p className="text-sm text-ink">
                        {agendamento.service.name} · com {agendamento.professional.name}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {agendamento.consumer.name} · {agendamento.consumer.whatsapp}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                        {ROTULO_STATUS[agendamento.status]}
                      </span>
                      <p className="mt-1 text-xs text-ink-soft">
                        {rotuloDeDuracao(agendamento.durationMinutes)} ·{" "}
                        {rotuloDePreco(agendamento.priceCents)}
                      </p>
                    </div>
                  </CartaoCorpo>
                </Cartao>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Pagina>
  );
}

function Pagina({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
      <div>
        <Link href="/conta" className="text-xs font-medium text-accent hover:underline">
          <ArrowLeft size={12} className="mr-1 inline" />
          Voltar para a conta
        </Link>
        <h1 className="mt-2 text-xl font-bold text-ink">{titulo}</h1>
        {subtitulo && <p className="text-sm text-ink-soft">{subtitulo}</p>}
      </div>
      {children}
    </div>
  );
}
