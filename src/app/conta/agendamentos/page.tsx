"use client";

// Agendamentos reais do estabelecimento (Lote 6D.5). Vive sob `/conta`, área
// REAL: nada de repositório, seed ou dado da demonstração entra aqui
// (auditado por lib/servicos/sem-dados-demo.test.ts).
//
// ESCOPO: criar, consultar, CANCELAR e REMARCAR (Lote 6D.6). Remarcar move só
// o horário da mesma reserva; não há mudança manual de status nem exclusão —
// o backend também não tem rota para isso. A lista do dia e as ações por
// reserva vivem em agenda-do-dia.tsx / acoes-reserva.tsx.
//
// Fuso: a tela EXIBE as horas locais que o backend devolve
// (`localStart`/`localServiceEnd`) e nunca converte nada com o relógio do
// navegador.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Store } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { encontrarContextoPorTenantId } from "@/lib/auth/real-session-state";
import { useProfissionaisReais } from "@/lib/profissionais/use-profissionais-reais";
import { useAgendamentosReais } from "@/lib/profissionais/use-agendamentos-reais";
import {
  comoDataDeCalendario,
  mensagemFalhaAgendamento,
  mensagemFalhaCancelamento,
  mensagemFalhaRemarcacao,
  resumoDoAgendamento,
  ROTULO_STATUS,
  rotuloDaData,
} from "@/lib/profissionais/agendamentos";
import type { AgendamentoReal, SelecaoDeCliente } from "@/lib/api/appointments-api";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { AgendaDoDia } from "./agenda-do-dia";
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
  /** Erro das ações sobre uma reserva JÁ existente, separado do erro da nova
   * reserva: misturar os dois mostraria a falha do cancelamento dentro do
   * formulário de criação. */
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const { estado, gravando, recarregar, criar, cancelar, remarcar } = useAgendamentosReais(
    tenantIdAtivo,
    date,
  );
  const { estado: estadoProfissionais } = useProfissionaisReais(tenantIdAtivo);

  useEffect(() => {
    if (precisaSelecionar) router.replace("/conta/selecionar-estabelecimento");
  }, [precisaSelecionar, router]);

  // Trocar de estabelecimento invalida o que está na tela: a última reserva e
  // o erro são de outro contexto.
  useEffect(() => {
    setUltimaReserva(null);
    setErroReserva(null);
    setErroAcao(null);
  }, [tenantIdAtivo]);

  // Trocar de dia também invalida o erro de uma ação: ele falava de uma reserva
  // que não está mais na tela.
  useEffect(() => {
    setErroAcao(null);
  }, [date]);

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

  /**
   * Cancelamento e remarcação compartilham o tratamento do resultado:
   *
   * - sucesso: avisa; a agenda já foi recarregada pelo hook;
   * - 409 (horário ocupado, ou reserva alterada por outra tela) e 400 (já
   *   começou, já cancelada): recarrega, para a pessoa ver o estado REAL que
   *   causou a recusa em vez de continuar olhando o desatualizado. Nunca
   *   reenvia: a nova tentativa é uma nova confirmação, com os dados novos;
   * - falha de comunicação: NÃO recarrega e NÃO reenvia. A mensagem diz que a
   *   operação PODE ter acontecido e manda consultar a reserva — afirmar que não
   *   aconteceu seria mentira, e reenviar às cegas poderia cancelar ou mover
   *   algo que já foi gravado.
   */
  async function aoCancelar(appointmentId: string, expectedStartAt: string): Promise<boolean> {
    setErroAcao(null);
    const resultado = await cancelar(appointmentId, { expectedStartAt });

    if (resultado.ok) {
      notificar("Reserva cancelada. O horário voltou a ficar livre.", "sucesso");
      return true;
    }

    setErroAcao(mensagemFalhaCancelamento(resultado.falha));
    if (resultado.falha.tipo === "horario_ocupado" || resultado.falha.tipo === "nao_agendavel") {
      recarregar();
    }
    return false;
  }

  async function aoRemarcar(
    appointmentId: string,
    dados: { startAt: string; expectedStartAt: string },
  ): Promise<boolean> {
    setErroAcao(null);
    const resultado = await remarcar(appointmentId, dados);

    if (resultado.ok) {
      notificar(`Reserva remarcada para ${resultado.dados.localStart}.`, "sucesso");
      return true;
    }

    setErroAcao(mensagemFalhaRemarcacao(resultado.falha));
    if (resultado.falha.tipo === "horario_ocupado" || resultado.falha.tipo === "nao_agendavel") {
      recarregar();
    }
    return false;
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

      <AgendaDoDia
        tenantId={tenantIdAtivo}
        estado={estado}
        agenda={agenda}
        gravando={gravando}
        erroAcao={erroAcao}
        recarregar={recarregar}
        aoCancelar={aoCancelar}
        aoRemarcar={aoRemarcar}
      />
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
