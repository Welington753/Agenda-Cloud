"use client";

// Calendário do funcionário: só os atendimentos desta conta
// (GET /tenants/:id/my-agenda/range; o profissional vem do vínculo, nunca da
// URL). Tocar num atendimento abre o dia dele em Minha agenda, com os botões
// que o dono liberou.
import { useMemo, useState } from "react";
import { CalendarioAgenda, type ItemDoCalendario } from "@/components/conta/calendario-agenda";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehMinhaAgendaDoPeriodo } from "@/lib/equipe/contratos";
import { hojeNoFuso } from "@/lib/profissionais/agenda-visual";
import { periodoDaVisao, type VisaoDoCalendario } from "@/lib/profissionais/calendario";

interface CalendarioDoFuncionarioProps {
  tenantId: string;
  dataInicial: string;
  timezone: string | null;
  mensagemDeLeitura: Record<"sessao" | "permissao" | "ausente" | "rede" | "servidor", string>;
  aoAbrir: (item: ItemDoCalendario) => void;
}

export function CalendarioDoFuncionario({
  tenantId,
  dataInicial,
  timezone,
  mensagemDeLeitura,
  aoAbrir,
}: CalendarioDoFuncionarioProps) {
  const [visao, setVisao] = useState<VisaoDoCalendario>("mes");
  const [data, setData] = useState(dataInicial);
  const periodo = periodoDaVisao(visao, data);
  const { estado, recarregar } = useLeituraPlataforma(
    `/tenants/${encodeURIComponent(tenantId)}/my-agenda/range?from=${periodo.from}&to=${periodo.to}`,
    ehMinhaAgendaDoPeriodo,
  );
  const agenda = estado.status === "pronto" ? estado.dados : null;
  const itens = useMemo<ItemDoCalendario[] | null>(
    () =>
      agenda
        ? agenda.appointments.map((a) => ({
            id: a.id,
            localDate: a.localDate,
            localStart: a.localStart,
            status: a.status,
            titulo: a.consumer.name,
            detalhe: a.service.name,
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
      erro={estado.status === "erro" ? mensagemDeLeitura[estado.motivo] : null}
      completa={agenda?.complete ?? true}
      aoMudarVisao={setVisao}
      aoMudarData={setData}
      aoHoje={() => setData(hoje ?? dataInicial)}
      aoRepetir={recarregar}
      aoAbrir={aoAbrir}
    />
  );
}
