"use client";

// Calendário da agenda geral (dono): lê o período inteiro do servidor
// (GET .../appointments/range) para a visão escolhida e entrega cada
// atendimento à lista do dia, onde ficam as ações. O filtro de profissional
// é o mesmo da lista.
import { useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { CalendarioAgenda, type ItemDoCalendario } from "@/components/conta/calendario-agenda";
import { Botao } from "@/components/ui/button";
import {
  hojeNoFuso,
  mensagemFalhaAgenda,
  TODOS_OS_PROFISSIONAIS,
  type OpcaoDeProfissional,
} from "@/lib/profissionais/agenda-visual";
import { periodoDaVisao, type VisaoDoCalendario } from "@/lib/profissionais/calendario";
import { useAgendaDoPeriodo } from "@/lib/profissionais/use-agenda-do-periodo";

interface CalendarioDoDonoProps {
  tenantId: string;
  /** Dia da lista: o calendário começa nele. */
  dataInicial: string;
  timezone: string | null;
  filtroProfissionalId: string;
  profissionais: readonly OpcaoDeProfissional[];
  aoFiltrar: (professionalId: string) => void;
  aoNovoAgendamento?: () => void;
  aoAbrir: (item: ItemDoCalendario) => void;
}

export function CalendarioDoDono(props: CalendarioDoDonoProps) {
  const { tenantId, dataInicial, timezone, filtroProfissionalId, profissionais } = props;
  const [visao, setVisao] = useState<VisaoDoCalendario>("mes");
  const [data, setData] = useState(dataInicial);
  const { estado, recarregar } = useAgendaDoPeriodo(
    tenantId,
    periodoDaVisao(visao, data),
    filtroProfissionalId === TODOS_OS_PROFISSIONAIS ? null : filtroProfissionalId,
  );
  const agenda = estado.status === "carregada" ? estado.agenda : estado.status === "carregando" ? estado.anterior : null;
  const itens = useMemo<ItemDoCalendario[] | null>(
    () =>
      agenda
        ? agenda.appointments.map((a) => ({
            id: a.id,
            localDate: a.localDate,
            localStart: a.localStart,
            status: a.status,
            titulo: a.consumer.name,
            detalhe: `${a.service.name} · ${a.professional.name}`,
          }))
        : null,
    [agenda],
  );
  const hoje = timezone ? hojeNoFuso(timezone, new Date()) : null;

  return (
    <CalendarioAgenda
      visao={visao}
      data={data}
      hoje={hoje}
      itens={itens}
      carregando={estado.status === "carregando"}
      erro={estado.status === "falha" ? mensagemFalhaAgenda(estado.falha) : null}
      completa={agenda?.completa ?? true}
      aoMudarVisao={setVisao}
      aoMudarData={setData}
      aoHoje={() => setData(hoje ?? dataInicial)}
      aoRepetir={recarregar}
      aoAbrir={props.aoAbrir}
      extras={
        <>
          <div className="min-w-0 sm:w-64">
            <label htmlFor="filtro-profissional-calendario" className="mb-1 block text-xs font-medium text-ink-soft">
              Profissional
            </label>
            <select
              id="filtro-profissional-calendario"
              value={filtroProfissionalId}
              onChange={(e) => props.aoFiltrar(e.target.value)}
              className="min-h-11 w-full truncate rounded-[var(--radius-control)] border border-border-strong bg-card px-3 py-2 text-sm text-ink"
            >
              <option value={TODOS_OS_PROFISSIONAIS}>Todos os profissionais</option>
              {profissionais.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
          {props.aoNovoAgendamento && (
            <Botao type="button" onClick={props.aoNovoAgendamento} className="sm:ml-auto">
              <CalendarPlus size={16} aria-hidden="true" />
              Novo agendamento
            </Botao>
          )}
        </>
      }
    />
  );
}
