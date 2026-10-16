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
// Fuso: exibe as horas locais que o backend devolve
// (`localStart`/`localServiceEnd`), nunca converte nada com o relógio do
// navegador.
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, UserSearch } from "lucide-react";
import type { AgendaDoDiaReal } from "@/lib/api/appointments-api";
import type { AcaoDeStatusReal } from "@/lib/api/appointment-status-api";
import {
  estaNoHorario,
  filtrarPorProfissional,
  mensagemFalhaAgenda,
  ordenarPorHorario,
} from "@/lib/profissionais/agenda-visual";
import { acoesDaReserva, temAlgumaAcao, type AcoesDaReserva } from "@/lib/profissionais/andamento";
import type { EstadoAgenda } from "@/lib/profissionais/use-agendamentos-reais";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AcoesReserva } from "./acoes-reserva";
import { CartaoAtendimento } from "@/components/conta/cartao-atendimento";
import type { AcaoConfirmada, ConfirmacaoPendente } from "./confirmar-acao";

interface AgendaDoDiaProps {
  tenantId: string;
  estado: EstadoAgenda;
  agenda: AgendaDoDiaReal | null;
  /** `true` enquanto qualquer gravação da agenda está em voo. */
  gravando: boolean;
  /** Erro das ações sobre uma reserva existente — separado do erro do
   * formulário de nova reserva. */
  erroAcao: string | null;
  /** Profissional do filtro, ou `TODOS_OS_PROFISSIONAIS`. */
  filtroProfissionalId: string;
  /** Id da reserva criada por esta tela, para marcar e rolar até ela. */
  recemCriadaId: string | null;
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
  estado,
  agenda,
  gravando,
  erroAcao,
  filtroProfissionalId,
  recemCriadaId,
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

  // A reserva recém-criada entra na vista quando a agenda que a contém chega.
  const listaRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!recemCriadaId || !listaRef.current) return;
    const alvo = listaRef.current.querySelector<HTMLElement>(
      `[data-reserva-id="${CSS.escape(recemCriadaId)}"]`,
    );
    alvo?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [recemCriadaId, visiveis]);

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
        <ul ref={listaRef} data-testid="agenda-do-dia" className="space-y-3">
          {visiveis.map((agendamento) => {
            const acoes = acoesDaReserva(agendamento, agora);
            const daLinha = confirmacao?.exibida.id === agendamento.id ? confirmacao : null;
            return (
              <li key={agendamento.id} data-reserva-id={agendamento.id} className="scroll-mt-24">
                <CartaoAtendimento
                  agendamento={agendamento}
                  noHorario={estaNoHorario(agendamento, agora)}
                  recemCriada={agendamento.id === recemCriadaId}
                >
                  {/* As ações só aparecem no que o servidor aceitaria alterar.
                    Esconder o botão NÃO é controle de acesso — é para não
                    oferecer uma ação cuja recusa já é conhecida. A decisão é
                    revalidada no servidor, dentro da transação. O relógio aqui é
                    o do navegador (pode estar errado), então isto nunca
                    substitui a checagem de lá. */}
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
                </CartaoAtendimento>
              </li>
            );
          })}
        </ul>
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
