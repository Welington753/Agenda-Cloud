"use client";

// Lista da agenda de um dia (Lote 6D.5) com as ações de cancelar e remarcar
// por reserva (Lote 6D.6). Extraída de page.tsx quando a página passou do
// limite de linhas do projeto — é bloco de UI, sem regra de negócio própria:
// as decisões continuam em lib/profissionais/agendamentos.ts (puras) e no
// servidor.
//
// Visualização (agenda como conteúdo principal): ordem cronológica, filtro por
// profissional feito AQUI sobre a agenda já carregada (a rota do dia não tem
// filtro e não ganhou um), atendimento em andamento destacado e a reserva
// recém-criada marcada e trazida para a vista.
//
// Duas apresentações das MESMAS reservas (mesma consulta, mesmo filtro, mesmo
// cartão e mesmas ações): "Lista" e "Por profissional"
// (agenda-por-profissional.tsx). Trocar de uma para outra não recarrega nada.
//
// Fuso: exibe as horas locais que o backend devolve
// (`localStart`/`localServiceEnd`), nunca converte nada com o relógio do
// navegador.
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, UserSearch } from "lucide-react";
import type { AgendaDoDiaReal } from "@/lib/api/appointments-api";
import type { AcaoDeStatusReal } from "@/lib/api/appointment-status-api";
import {
  agruparPorProfissional,
  estaNoHorario,
  filtrarPorProfissional,
  mensagemFalhaAgenda,
  ordenarPorHorario,
  TODOS_OS_PROFISSIONAIS,
  type VisualizacaoAgenda,
} from "@/lib/profissionais/agenda-visual";
import type { AgendamentoReal } from "@/lib/api/appointments-api";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import { acoesDaReserva, temAlgumaAcao, type AcoesDaReserva } from "@/lib/profissionais/andamento";
import type { EstadoAgenda } from "@/lib/profissionais/use-agendamentos-reais";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AcoesReserva } from "./acoes-reserva";
import { AgendaPorProfissional } from "./agenda-por-profissional";
import { CartaoAtendimento } from "@/components/conta/cartao-atendimento";
import { ContatoDaReserva } from "@/components/conta/contato-whatsapp";
import type { AcaoConfirmada, ConfirmacaoPendente } from "./confirmar-acao";

interface AgendaDoDiaProps {
  tenantId: string;
  /** Nome do estabelecimento ativo, para a mensagem de "Combinar outro horário". */
  estabelecimento: string;
  estado: EstadoAgenda;
  agenda: AgendaDoDiaReal | null;
  /** `true` enquanto qualquer gravação da agenda está em voo. */
  gravando: boolean;
  /** Erro das ações sobre uma reserva existente — separado do erro do
   * formulário de nova reserva. */
  erroAcao: string | null;
  /** Profissional do filtro, ou `TODOS_OS_PROFISSIONAIS`. */
  filtroProfissionalId: string;
  visualizacao: VisualizacaoAgenda;
  /** Catálogo atual (vazio se não carregou): nomes, inativos e quem não tem
   * reserva no dia, na visualização por profissional. */
  profissionais: readonly ProfissionalReal[];
  /** Id da reserva criada por esta tela, para marcar e rolar até ela. */
  recemCriadaId: string | null;
  /** Id da reserva aberta pelo Calendário, para marcar e rolar até ela. */
  destacadaId?: string | null;
  aoLimparFiltro: () => void;
  recarregar: () => void;
  aoCancelar: (appointmentId: string, expectedStartAt: string) => Promise<boolean>;
  aoAlterarStatus: (
    appointmentId: string,
    acao: AcaoDeStatusReal,
    expectedStartAt: string,
  ) => Promise<boolean>;
  aoRemarcar: (
    appointmentId: string,
    dados: { startAt: string; expectedStartAt: string },
  ) => Promise<boolean>;
}

export function AgendaDoDia({
  tenantId,
  estabelecimento,
  estado,
  agenda,
  gravando,
  erroAcao,
  filtroProfissionalId,
  visualizacao,
  profissionais,
  recemCriadaId,
  destacadaId = null,
  aoLimparFiltro,
  recarregar,
  aoCancelar,
  aoAlterarStatus,
  aoRemarcar,
}: AgendaDoDiaProps) {
  // A confirmação (cancelar, concluir, registrar falta) vive AQUI, não na
  // linha da reserva: o reload da agenda (inclusive o que segue um 409) passa
  // por "carregando" e desmonta a lista. Guardada aqui, ela sobrevive e pode
  // avisar que a reserva mudou.
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoPendente | null>(null);

  // Relógio do NAVEGADOR, relido a cada 30 s: a agenda fica aberta o dia todo e
  // "Iniciar", "Concluir" e "Registrar falta" aparecem conforme o horário
  // chega. Só decide o que é OFERECIDO — quem decide o que vale é o servidor.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Agenda nova chegou: se a reserva da confirmação mudou, a confirmação passa
  // a mostrar os dados novos COM o que mostrava antes — nunca troca o horário
  // em silêncio e nunca reenvia nada. Se ela saiu do dia ou a ação não vale
  // mais para ela, a confirmação fecha (o erro da ação continua explicando).
  useEffect(() => {
    if (!agenda) return;
    setAgora(new Date());
    setConfirmacao((atual) => {
      if (!atual) return atual;
      const atualizada = agenda.appointments.find((a) => a.id === atual.exibida.id);
      if (!atualizada || !acaoAindaVale(atual.acao, acoesDaReserva(atualizada, new Date()))) {
        return null;
      }
      const { exibida } = atual;
      if (exibida.startAt === atualizada.startAt && exibida.status === atualizada.status) {
        return atual;
      }
      return { acao: atual.acao, exibida: atualizada, anterior: exibida };
    });
  }, [agenda]);

  // Trocar o filtro fecha uma confirmação aberta: a reserva dela pode sumir da
  // lista, e uma confirmação invisível que reaparece depois confundiria.
  useEffect(() => {
    setConfirmacao(null);
  }, [filtroProfissionalId]);

  const visiveis = useMemo(
    () =>
      agenda
        ? filtrarPorProfissional(ordenarPorHorario(agenda.appointments), filtroProfissionalId)
        : [],
    [agenda, filtroProfissionalId],
  );

  // Profissionais ativos sem reserva só aparecem como grupo vazio quando a
  // lista do dia veio COMPLETA e sem filtro — com a lista cortada, "sem
  // reserva" seria palpite.
  const grupos = useMemo(
    () =>
      agenda && visualizacao === "profissional"
        ? agruparPorProfissional(
            visiveis,
            profissionais,
            agenda.completa && filtroProfissionalId === TODOS_OS_PROFISSIONAIS,
          )
        : [],
    [agenda, visualizacao, visiveis, profissionais, filtroProfissionalId],
  );

  // A reserva recém-criada (ou aberta pelo Calendário) entra na vista quando
  // a agenda que a contém chega.
  const listaRef = useRef<HTMLDivElement>(null);
  const alvoId = recemCriadaId ?? destacadaId;
  useEffect(() => {
    if (!alvoId || !listaRef.current) return;
    const alvo = listaRef.current.querySelector<HTMLElement>(`[data-reserva-id="${CSS.escape(alvoId)}"]`);
    alvo?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [alvoId, visiveis, visualizacao]);

  function renderizarReserva(agendamento: AgendamentoReal) {
    const acoes = acoesDaReserva(agendamento, agora);
    const daLinha = confirmacao?.exibida.id === agendamento.id ? confirmacao : null;
    return (
      <CartaoAtendimento
        agendamento={agendamento}
        noHorario={estaNoHorario(agendamento, agora)}
        recemCriada={agendamento.id === recemCriadaId}
        destacada={agendamento.id === destacadaId}
      >
        <div className="space-y-3">
          {/* Contato pelo WhatsApp: links para o wa.me, sem efeito nenhum na
            reserva. Ficam separados das ações, que falam com o servidor. */}
          <ContatoDaReserva agendamento={agendamento} estabelecimento={estabelecimento} />
          {/* As ações só aparecem no que o servidor aceitaria alterar.
            Esconder o botão NÃO é controle de acesso — é para não oferecer uma
            ação cuja recusa já é conhecida. A decisão é revalidada no servidor,
            dentro da transação. O relógio aqui é o do navegador (pode estar
            errado), então isto nunca substitui a checagem de lá. */}
          {(temAlgumaAcao(acoes) || daLinha) && (
            <AcoesReserva
              tenantId={tenantId}
              agendamento={agendamento}
              acoes={acoes}
              gravando={gravando}
              confirmacao={daLinha}
              aoAbrirConfirmacao={(acao: AcaoConfirmada) =>
                setConfirmacao({
                  acao,
                  exibida: agendamento,
                  anterior: null,
                })
              }
              aoFecharConfirmacao={() => setConfirmacao(null)}
              aoCancelar={aoCancelar}
              aoAlterarStatus={aoAlterarStatus}
              aoRemarcar={aoRemarcar}
            />
          )}
        </div>
      </CartaoAtendimento>
    );
  }

  return (
    <section aria-label="Atendimentos do dia" className="space-y-3">
      {estado.status === "carregando" && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {estado.status === "falha" && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <p role="alert" data-testid="erro-agenda" className="text-sm text-ink">
              {mensagemFalhaAgenda(estado.falha)}
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
        <div data-testid="agenda-vazia">
          <EstadoVazio
            icone={CalendarDays}
            titulo="Nenhum agendamento neste dia."
            descricao="Use “Novo agendamento” para marcar um horário."
          />
        </div>
      )}

      {agenda && agenda.appointments.length > 0 && visiveis.length === 0 && (
        <div data-testid="agenda-vazia-filtro">
          <EstadoVazio
            icone={UserSearch}
            titulo="Nenhum agendamento deste profissional neste dia."
            acao={
              <Botao type="button" variante="secundaria" tamanho="sm" onClick={aoLimparFiltro}>
                Ver todos os profissionais
              </Botao>
            }
          />
        </div>
      )}

      {erroAcao && (
        <p
          role="alert"
          data-testid="erro-acao-reserva"
          className="text-sm text-[color:var(--color-danger)]"
        >
          {erroAcao}
        </p>
      )}

      {visiveis.length > 0 && (
        <div ref={listaRef}>
          {visualizacao === "lista" ? (
            <ul
              data-testid="agenda-do-dia"
              className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-card"
            >
              {visiveis.map((agendamento) => (
                <li key={agendamento.id} data-reserva-id={agendamento.id} className="scroll-mt-24">
                  {renderizarReserva(agendamento)}
                </li>
              ))}
            </ul>
          ) : (
            <AgendaPorProfissional
              grupos={grupos}
              completa={agenda?.completa ?? false}
              renderizarReserva={renderizarReserva}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** A ação da confirmação ainda é oferecida para a reserva atualizada? */
function acaoAindaVale(acao: AcaoConfirmada, acoes: AcoesDaReserva): boolean {
  if (acao === "cancel") return acoes.cancelar;
  if (acao === "complete") return acoes.concluir;
  return acoes.registrarFalta;
}
