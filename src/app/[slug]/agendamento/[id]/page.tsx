"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { addDays, differenceInHours, getDay, startOfDay } from "date-fns";
import { CalendarCog, CalendarX2, CheckCircle2, Store, Tag, User, XCircle } from "lucide-react";
import { horariosLivresDoProfissionalNoDia } from "@/lib/availability/consulta";
import { agendamentoRepository, estabelecimentoRepository, profissionalRepository, servicoRepository } from "@/lib/repositories";
import { useClientData } from "@/lib/hooks/use-client-data";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { BadgeStatusAgendamento } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/ui/modal";
import { EtapaDataHorario } from "@/components/agendamento/etapa-data-horario";
import { formatarDataLonga, formatarHora, formatarMoeda } from "@/lib/format";
import { obterTerminologia } from "@/lib/verticals/terminologia";
import type { DiaSemana, StatusAgendamento } from "@/lib/types";

const MAX_DIAS_EXIBIDOS = 21;

const TITULO_POR_STATUS: Record<StatusAgendamento, string> = {
  pendente: "Agendamento recebido",
  confirmado: "Agendamento confirmado",
  em_atendimento: "Atendimento em andamento",
  concluido: "Atendimento concluído",
  cancelado: "Agendamento cancelado",
  nao_compareceu: "Falta registrada",
};

export default function AgendamentoDetalhePage() {
  const params = useParams<{ slug: string; id: string }>();
  const { notificar } = useToast();
  const [modalCancelarAberto, setModalCancelarAberto] = useState(false);
  const [remarcando, setRemarcando] = useState(false);
  const [dataRemarcar, setDataRemarcar] = useState<Date | null>(null);
  const [horarioRemarcar, setHorarioRemarcar] = useState<Date | null>(null);

  const { dados, carregando, recarregar } = useClientData(() => {
    const agendamento = agendamentoRepository.obterPorId(params.id);
    if (!agendamento) return null;
    const estabelecimento = estabelecimentoRepository.obterPorTenantId(agendamento.tenantId);
    const servico = servicoRepository.obterPorId(agendamento.servicoId);
    const profissional = profissionalRepository.obterPorId(agendamento.profissionalId);
    if (!estabelecimento || estabelecimento.slug !== params.slug || !servico || !profissional) return null;
    return { agendamento, estabelecimento, servico, profissional };
  }, [params.id, params.slug]);

  const diasCandidatos = useMemo(() => {
    if (!dados) return [];
    const dias: Date[] = [];
    let cursor = 0;
    while (dias.length < MAX_DIAS_EXIBIDOS && cursor < dados.estabelecimento.regras.limiteDiasFuturos + 5) {
      const candidato = addDays(startOfDay(new Date()), cursor);
      const diaSemana = getDay(candidato) as DiaSemana;
      if (dados.profissional.horarios.some((h) => h.diaSemana === diaSemana && h.ativo)) dias.push(candidato);
      cursor += 1;
    }
    return dias;
  }, [dados]);

  const horariosDisponiveis = useMemo(() => {
    if (!dados || !dataRemarcar) return [];
    const { agendamento, estabelecimento, servico, profissional } = dados;
    return horariosLivresDoProfissionalNoDia(profissional, servico, dataRemarcar, estabelecimento, agendamento.id);
  }, [dados, dataRemarcar]);

  if (carregando) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!dados) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
        <EstadoVazio
          icone={Store}
          titulo="Agendamento não encontrado"
          descricao="O link pode estar incorreto ou o agendamento pode ter sido removido nesta demonstração."
          acao={
            <Link href={`/${params.slug}`}>
              <Botao variante="secundaria" tamanho="sm">
                Voltar
              </Botao>
            </Link>
          }
        />
      </div>
    );
  }

  const { agendamento, estabelecimento, servico, profissional } = dados;
  const terminologia = obterTerminologia(estabelecimento.categoria);
  const horasAteAtendimento = differenceInHours(new Date(agendamento.dataHoraInicio), new Date());
  const dentroDoPrazo =
    (agendamento.status === "pendente" || agendamento.status === "confirmado") &&
    horasAteAtendimento >= estabelecimento.regras.prazoCancelamentoHoras;
  const podeCancelar = dentroDoPrazo;
  const podeRemarcar = dentroDoPrazo && estabelecimento.regras.permitirRemarcacaoCliente;

  function confirmarCancelamento() {
    agendamentoRepository.atualizarStatus(agendamento.id, "cancelado", "cliente");
    notificar(`${terminologia.agendamento.singular} cancelado. O horário foi liberado.`, "sucesso");
    setModalCancelarAberto(false);
    recarregar();
  }

  function confirmarRemarcacao() {
    if (!horarioRemarcar || !servico) return;
    const novoFim = new Date(horarioRemarcar.getTime() + servico.duracaoMinutos * 60_000);
    agendamentoRepository.remarcar(agendamento.id, horarioRemarcar.toISOString(), novoFim.toISOString(), "cliente");
    notificar(`${terminologia.agendamento.singular} remarcado com sucesso.`, "sucesso");
    setRemarcando(false);
    setDataRemarcar(null);
    setHorarioRemarcar(null);
    recarregar();
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 py-8 sm:py-12">
      <div className="mb-6 text-center">
        <div
          className={`mx-auto flex size-14 items-center justify-center rounded-full ${
            agendamento.status === "cancelado" || agendamento.status === "nao_compareceu"
              ? "bg-danger-soft text-[color:var(--color-danger)]"
              : "bg-success-soft text-[color:var(--color-success)]"
          }`}
        >
          {agendamento.status === "cancelado" || agendamento.status === "nao_compareceu" ? (
            <XCircle size={28} />
          ) : (
            <CheckCircle2 size={28} />
          )}
        </div>
        <h1 className="mt-3 text-xl font-bold text-ink">{TITULO_POR_STATUS[agendamento.status]}</h1>
        <p className="text-sm text-ink-soft">{estabelecimento.identidadeVisual.nome}</p>
      </div>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Status</span>
            <BadgeStatusAgendamento status={agendamento.status} />
          </div>
          <LinhaDetalhe
            icone={Tag}
            rotulo={servico.nome}
            valor={agendamento.precoCentavos === undefined ? "Sob consulta" : formatarMoeda(agendamento.precoCentavos)}
          />
          <LinhaDetalhe icone={User} rotulo={terminologia.profissional.singular} valor={profissional.nome} />
          <LinhaDetalhe
            icone={CalendarCog}
            rotulo="Data e horário"
            valor={`${formatarDataLonga(agendamento.dataHoraInicio)} às ${formatarHora(agendamento.dataHoraInicio)}`}
          />
        </CartaoCorpo>
      </Cartao>

      {(podeCancelar || podeRemarcar) && !remarcando && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {podeRemarcar && (
            <Botao variante="secundaria" className="flex-1" onClick={() => setRemarcando(true)}>
              Remarcar
            </Botao>
          )}
          {podeCancelar && (
            <Botao variante="perigo" className="flex-1" onClick={() => setModalCancelarAberto(true)}>
              Cancelar {terminologia.agendamento.singular.toLowerCase()}
            </Botao>
          )}
        </div>
      )}

      {!dentroDoPrazo && (agendamento.status === "pendente" || agendamento.status === "confirmado") && (
        <p className="mt-4 text-center text-xs text-ink-soft">
          O prazo para cancelar ou remarcar por conta própria ({estabelecimento.regras.prazoCancelamentoHoras}h de
          antecedência) já passou. Fale com{" "}
          {terminologia.estabelecimento.artigo === "a" ? "a" : "o"} {terminologia.estabelecimento.singular.toLowerCase()}{" "}
          pelo WhatsApp {estabelecimento.identidadeVisual.telefone}.
        </p>
      )}

      {remarcando && (
        <Cartao className="mt-4">
          <CartaoCorpo>
            <EtapaDataHorario
              diasCandidatos={diasCandidatos}
              dataSelecionada={dataRemarcar}
              onSelecionarData={(d) => {
                setDataRemarcar(d);
                setHorarioRemarcar(null);
              }}
              horariosDisponiveis={horariosDisponiveis}
              carregandoHorarios={false}
              horarioSelecionado={horarioRemarcar}
              onSelecionarHorario={setHorarioRemarcar}
            />
            <div className="mt-4 flex gap-2">
              <Botao
                variante="secundaria"
                className="flex-1"
                onClick={() => {
                  setRemarcando(false);
                  setDataRemarcar(null);
                  setHorarioRemarcar(null);
                }}
              >
                Cancelar remarcação
              </Botao>
              <Botao className="flex-1" disabled={!horarioRemarcar} onClick={confirmarRemarcacao}>
                Confirmar novo horário
              </Botao>
            </div>
          </CartaoCorpo>
        </Cartao>
      )}

      <div className="mt-6 text-center">
        <Link href={`/${params.slug}`} className="text-sm font-medium text-accent hover:underline">
          Voltar para a página {terminologia.estabelecimento.artigo === "a" ? "da" : "do"} {terminologia.estabelecimento.singular.toLowerCase()}
        </Link>
      </div>

      <Modal
        aberto={modalCancelarAberto}
        aoFechar={() => setModalCancelarAberto(false)}
        titulo={`Cancelar ${terminologia.agendamento.singular.toLowerCase()}?`}
        rodape={
          <>
            <Botao variante="secundaria" onClick={() => setModalCancelarAberto(false)}>
              Voltar
            </Botao>
            <Botao variante="perigo" onClick={confirmarCancelamento}>
              Sim, cancelar
            </Botao>
          </>
        }
      >
        <p>
          Tem certeza que deseja cancelar {terminologia.agendamento.artigo === "a" ? "a" : "o"}{" "}
          {terminologia.agendamento.singular.toLowerCase()} de{" "}
          <strong>{formatarDataLonga(agendamento.dataHoraInicio)} às {formatarHora(agendamento.dataHoraInicio)}</strong>?
          O horário será liberado.
        </p>
      </Modal>
    </div>
  );
}

function LinhaDetalhe({ icone: Icone, rotulo, valor }: { icone: typeof CalendarX2; rotulo: string; valor: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[color:var(--color-accent-hover)]">
        <Icone size={15} />
      </div>
      <div className="flex flex-1 items-center justify-between gap-2">
        <span className="text-sm text-ink-soft">{rotulo}</span>
        <span className="text-sm font-semibold text-ink">{valor}</span>
      </div>
    </div>
  );
}
