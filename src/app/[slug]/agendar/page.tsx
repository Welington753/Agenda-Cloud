"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { addDays, getDay, startOfDay } from "date-fns";
import { ArrowLeft, Store } from "lucide-react";
import { horariosLivresDoProfissionalNoDia } from "@/lib/availability/consulta";
import {
  agendamentoRepository,
  consumidorRepository,
  estabelecimentoRepository,
  profissionalRepository,
  servicoRepository,
} from "@/lib/repositories";
import { useClientData } from "@/lib/hooks/use-client-data";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { BarraDeEtapas } from "@/components/ui/step-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoVazio } from "@/components/ui/empty-state";
import { EtapaServico } from "@/components/agendamento/etapa-servico";
import { EtapaProfissional, QUALQUER_PROFISSIONAL } from "@/components/agendamento/etapa-profissional";
import { EtapaDataHorario } from "@/components/agendamento/etapa-data-horario";
import { EtapaDadosCliente } from "@/components/agendamento/etapa-dados-cliente";
import { EtapaConfirmacao } from "@/components/agendamento/etapa-confirmacao";
import { obterTerminologia } from "@/lib/verticals/terminologia";
import { featureHabilitada } from "@/lib/access/access-control";
import type { DiaSemana, Estabelecimento, Profissional, Servico } from "@/lib/types";

const MAX_DIAS_EXIBIDOS = 21;

export default function AgendarPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();
  const { notificar } = useToast();

  const { dados, carregando } = useClientData(() => {
    const estabelecimento = estabelecimentoRepository.obterPorSlug(slug);
    if (!estabelecimento) return null;
    const profissionais = profissionalRepository
      .listarPorTenant(estabelecimento.tenantId)
      .filter((p) => p.ativo && p.agendamentoOnlineAtivo);
    const servicos = servicoRepository
      .listarPorTenant(estabelecimento.tenantId)
      .filter((s) => s.ativoNoAgendamentoPublico);
    return { estabelecimento, profissionais, servicos };
  }, [slug]);

  const [etapa, setEtapa] = useState(0);
  const [servico, setServico] = useState<Servico | null>(null);
  const [escolhaProfissional, setEscolhaProfissional] = useState<string | typeof QUALQUER_PROFISSIONAL | null>(null);
  const [dataSelecionada, setDataSelecionada] = useState<Date | null>(null);
  const [horarioSelecionado, setHorarioSelecionado] = useState<Date | null>(null);
  const [profissionalResolvidoId, setProfissionalResolvidoId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [erros, setErros] = useState<{ nome?: string; whatsapp?: string }>({});
  const [enviando, setEnviando] = useState(false);

  const profissionaisCapacitados = useMemo(() => {
    if (!dados || !servico) return [];
    return dados.profissionais.filter((p) => p.servicosIds.includes(servico.id));
  }, [dados, servico]);

  function calcularHorariosDoProfissional(profissional: Profissional, estabelecimento: Estabelecimento, dia: Date) {
    if (!servico) return [];
    return horariosLivresDoProfissionalNoDia(profissional, servico, dia, estabelecimento);
  }

  const diasCandidatos = useMemo(() => {
    if (!dados || !escolhaProfissional) return [];
    const { estabelecimento } = dados;
    const profissionaisRelevantes =
      escolhaProfissional === QUALQUER_PROFISSIONAL
        ? profissionaisCapacitados
        : profissionaisCapacitados.filter((p) => p.id === escolhaProfissional);

    const dias: Date[] = [];
    let cursor = 0;
    while (dias.length < MAX_DIAS_EXIBIDOS && cursor < estabelecimento.regras.limiteDiasFuturos + 5) {
      const candidato = addDays(startOfDay(new Date()), cursor);
      const diaSemana = getDay(candidato) as DiaSemana;
      const algumProfissionalAtende = profissionaisRelevantes.some((p) =>
        p.horarios.some((h) => h.diaSemana === diaSemana && h.ativo)
      );
      if (algumProfissionalAtende) dias.push(candidato);
      cursor += 1;
    }
    return dias;
  }, [dados, escolhaProfissional, profissionaisCapacitados]);

  const horariosDisponiveis = useMemo(() => {
    if (!dados || !dataSelecionada || !escolhaProfissional) return [];
    const { estabelecimento } = dados;

    if (escolhaProfissional !== QUALQUER_PROFISSIONAL) {
      const profissional = profissionaisCapacitados.find((p) => p.id === escolhaProfissional);
      if (!profissional) return [];
      return calcularHorariosDoProfissional(profissional, estabelecimento, dataSelecionada);
    }

    const mapaHorarios = new Map<number, string>();
    for (const profissional of profissionaisCapacitados) {
      for (const horario of calcularHorariosDoProfissional(profissional, estabelecimento, dataSelecionada)) {
        if (!mapaHorarios.has(horario.getTime())) mapaHorarios.set(horario.getTime(), profissional.id);
      }
    }
    return Array.from(mapaHorarios.keys())
      .sort((a, b) => a - b)
      .map((t) => new Date(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, dataSelecionada, escolhaProfissional, profissionaisCapacitados]);

  if (carregando) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!dados) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
        <EstadoVazio
          icone={Store}
          titulo="Estabelecimento não encontrado"
          descricao={`Não existe nenhum estabelecimento com o endereço "/${slug}" nesta demonstração.`}
          acao={
            <Link href="/">
              <Botao variante="secundaria" tamanho="sm">
                Voltar para a apresentação
              </Botao>
            </Link>
          }
        />
      </div>
    );
  }

  const { estabelecimento, servicos } = dados;
  const terminologia = obterTerminologia(estabelecimento.categoria);
  const ETAPAS = ["Serviço", terminologia.profissional.singular, "Data e horário", "Seus dados", "Confirmação"];

  if (!featureHabilitada(estabelecimento.plano, estabelecimento.featuresDesativadas, "agendamentoPublico")) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
        <EstadoVazio
          icone={Store}
          titulo="Agendamento online desativado"
          descricao={`${estabelecimento.identidadeVisual.nome} não está aceitando agendamentos online nesta demonstração.`}
          acao={
            <Link href={`/${slug}`}>
              <Botao variante="secundaria" tamanho="sm">
                Voltar
              </Botao>
            </Link>
          }
        />
      </div>
    );
  }

  function irParaEtapaAnterior() {
    setEtapa((e) => Math.max(0, e - 1));
  }

  function resolverProfissionalParaHorario(hora: Date): string | undefined {
    if (escolhaProfissional !== QUALQUER_PROFISSIONAL) return escolhaProfissional ?? undefined;
    return profissionaisCapacitados.find((p) =>
      calcularHorariosDoProfissional(p, estabelecimento, hora).some((h) => h.getTime() === hora.getTime())
    )?.id;
  }

  function validarDados(): boolean {
    const novosErros: { nome?: string; whatsapp?: string } = {};
    if (!nome.trim()) novosErros.nome = "Informe seu nome.";
    const digitos = whatsapp.replace(/\D/g, "");
    if (estabelecimento.regras.exigirTelefoneCliente && digitos.length < 10) {
      novosErros.whatsapp = "Informe um WhatsApp válido com DDD.";
    }
    setErros(novosErros);
    return Object.keys(novosErros).length === 0;
  }

  async function confirmarAgendamento() {
    if (!servico || !horarioSelecionado || !profissionalResolvidoId) return;
    setEnviando(true);
    const profissional = profissionaisCapacitados.find((p) => p.id === profissionalResolvidoId);
    if (!profissional) {
      notificar("Não foi possível confirmar: profissional indisponível.", "erro");
      setEnviando(false);
      return;
    }

    const aindaDisponivel = horariosLivresDoProfissionalNoDia(profissional, servico, horarioSelecionado, estabelecimento).some(
      (h) => h.getTime() === horarioSelecionado.getTime()
    );

    if (!aindaDisponivel) {
      notificar("Esse horário acabou de ser preenchido. Escolha outro, por favor.", "erro");
      setEnviando(false);
      setHorarioSelecionado(null);
      setEtapa(2);
      return;
    }

    const consumidor = consumidorRepository.obterOuCriarPorWhatsapp(estabelecimento.tenantId, nome.trim(), whatsapp);
    const fim = new Date(horarioSelecionado.getTime() + servico.duracaoMinutos * 60_000);
    const novoAgendamento = agendamentoRepository.criar({
      tenantId: estabelecimento.tenantId,
      consumidorId: consumidor.id,
      consumidorNome: nome.trim(),
      consumidorWhatsapp: whatsapp,
      profissionalId: profissional.id,
      servicoId: servico.id,
      dataHoraInicio: horarioSelecionado.toISOString(),
      dataHoraFim: fim.toISOString(),
      status: estabelecimento.regras.confirmacaoAutomatica && !servico.exigeConfirmacaoManual ? "confirmado" : "pendente",
      precoCentavos: servico.precoCentavos,
    });

    notificar("Agendamento confirmado com sucesso!", "sucesso");
    router.push(`/${slug}/agendamento/${novoAgendamento.id}`);
  }

  const profissionalSelecionadoParaResumo = profissionaisCapacitados.find((p) => p.id === profissionalResolvidoId);

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 py-6 sm:py-10">
      <div className="mb-6 flex items-center gap-3">
        {etapa > 0 ? (
          <button
            type="button"
            onClick={irParaEtapaAnterior}
            aria-label="Voltar para a etapa anterior"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-ink hover:bg-paper-muted"
          >
            <ArrowLeft size={18} />
          </button>
        ) : (
          <Link
            href={`/${slug}`}
            aria-label={`Voltar para a página ${terminologia.estabelecimento.artigo === "a" ? "da" : "do"} ${terminologia.estabelecimento.singular.toLowerCase()}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-ink hover:bg-paper-muted"
          >
            <ArrowLeft size={18} />
          </Link>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{estabelecimento.identidadeVisual.nome}</p>
          <p className="text-xs text-ink-soft">Agendamento online</p>
        </div>
      </div>

      <BarraDeEtapas etapas={ETAPAS} etapaAtual={etapa} />

      <div className="mt-6 pb-28">
        {etapa === 0 && (
          <EtapaServico
            servicos={servicos}
            exibirPrecoPublico={estabelecimento.regras.exibirPrecoPublico}
            terminologia={terminologia}
            onEscolher={(s) => {
              setServico(s);
              setEscolhaProfissional(null);
              setDataSelecionada(null);
              setHorarioSelecionado(null);
              setEtapa(1);
            }}
          />
        )}

        {etapa === 1 && (
          <EtapaProfissional
            profissionais={profissionaisCapacitados}
            permitirQualquer={estabelecimento.regras.permitirQualquerProfissional}
            terminologia={terminologia}
            onEscolher={(id) => {
              setEscolhaProfissional(id);
              setDataSelecionada(null);
              setHorarioSelecionado(null);
              setEtapa(2);
            }}
          />
        )}

        {etapa === 2 && (
          <EtapaDataHorario
            diasCandidatos={diasCandidatos}
            dataSelecionada={dataSelecionada}
            onSelecionarData={(d) => {
              setDataSelecionada(d);
              setHorarioSelecionado(null);
            }}
            horariosDisponiveis={horariosDisponiveis}
            carregandoHorarios={false}
            horarioSelecionado={horarioSelecionado}
            onSelecionarHorario={(h) => {
              const profissionalId = resolverProfissionalParaHorario(h);
              if (!profissionalId) {
                notificar("Esse horário deixou de estar disponível.", "erro");
                return;
              }
              setProfissionalResolvidoId(profissionalId);
              setHorarioSelecionado(h);
              setEtapa(3);
            }}
          />
        )}

        {etapa === 3 && (
          <EtapaDadosCliente
            nome={nome}
            whatsapp={whatsapp}
            telefoneObrigatorio={estabelecimento.regras.exigirTelefoneCliente}
            onMudarNome={setNome}
            onMudarWhatsapp={setWhatsapp}
            erros={erros}
          />
        )}

        {etapa === 4 && servico && horarioSelecionado && profissionalSelecionadoParaResumo && (
          <EtapaConfirmacao
            servico={servico}
            profissional={profissionalSelecionadoParaResumo}
            horario={horarioSelecionado}
            nome={nome}
            whatsapp={whatsapp}
            exibirPrecoPublico={estabelecimento.regras.exibirPrecoPublico}
            terminologia={terminologia}
          />
        )}
      </div>

      {(etapa === 3 || etapa === 4) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card p-4 shadow-[var(--shadow-lift)]">
          <div className="mx-auto max-w-xl">
            {etapa === 3 && (
              <Botao
                tamanho="lg"
                className="w-full"
                onClick={() => {
                  if (validarDados()) setEtapa(4);
                }}
              >
                Continuar
              </Botao>
            )}
            {etapa === 4 && (
              <Botao tamanho="lg" className="w-full" onClick={confirmarAgendamento} disabled={enviando}>
                {enviando ? "Confirmando..." : `Confirmar ${terminologia.agendamento.singular.toLowerCase()}`}
              </Botao>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
