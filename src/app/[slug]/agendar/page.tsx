"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Store } from "lucide-react";
import {
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
import { featureHabilitada, podeReceberAgendamentoPublico } from "@/lib/access/access-control";
import { resolverLogo } from "@/components/publico/secoes";
import { calcularDiasCandidatos, calcularHorariosDisponiveis, resolverProfissionalParaHorario } from "./disponibilidade-agendamento";
import { executarConfirmacaoAgendamento } from "./confirmar-agendamento";
import { useFluxoAgendamento } from "./use-fluxo-agendamento";

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

  const {
    etapa,
    setEtapa,
    servico,
    setServico,
    escolhaProfissional,
    setEscolhaProfissional,
    dataSelecionada,
    setDataSelecionada,
    horarioSelecionado,
    setHorarioSelecionado,
    profissionalResolvidoId,
    setProfissionalResolvidoId,
    nome,
    setNome,
    whatsapp,
    setWhatsapp,
    erros,
    enviando,
    setEnviando,
    irParaEtapaAnterior,
    validarDados,
  } = useFluxoAgendamento();

  const profissionaisCapacitados = useMemo(() => {
    if (!dados || !servico) return [];
    return dados.profissionais.filter((p) => p.servicosIds.includes(servico.id));
  }, [dados, servico]);

  const diasCandidatos = useMemo(() => {
    if (!dados || !escolhaProfissional) return [];
    const { estabelecimento } = dados;
    const profissionaisRelevantes =
      escolhaProfissional === QUALQUER_PROFISSIONAL
        ? profissionaisCapacitados
        : profissionaisCapacitados.filter((p) => p.id === escolhaProfissional);
    return calcularDiasCandidatos(estabelecimento, profissionaisRelevantes, MAX_DIAS_EXIBIDOS);
  }, [dados, escolhaProfissional, profissionaisCapacitados]);

  const horariosDisponiveis = useMemo(() => {
    if (!dados || !dataSelecionada || !escolhaProfissional) return [];
    return calcularHorariosDisponiveis(profissionaisCapacitados, escolhaProfissional, servico, dados.estabelecimento, dataSelecionada);
  }, [dados, dataSelecionada, escolhaProfissional, profissionaisCapacitados, servico]);

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
  const logo = resolverLogo(estabelecimento.identidadeVisual);
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

  if (!podeReceberAgendamentoPublico(estabelecimento.status)) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
        <EstadoVazio
          icone={Store}
          titulo="Agendamento indisponível"
          descricao={`${estabelecimento.identidadeVisual.nome} não está aceitando novos agendamentos no momento.`}
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

  function confirmarAgendamento() {
    if (!servico || !horarioSelecionado || !profissionalResolvidoId) return;
    setEnviando(true);
    const profissional = profissionaisCapacitados.find((p) => p.id === profissionalResolvidoId);
    if (!profissional) {
      notificar("Não foi possível confirmar: profissional indisponível.", "erro");
      setEnviando(false);
      return;
    }

    const resultado = executarConfirmacaoAgendamento({ estabelecimento, servico, horarioSelecionado, profissional, nome, whatsapp });
    if (!resultado.sucesso) {
      notificar("Esse horário acabou de ser preenchido. Escolha outro, por favor.", "erro");
      setEnviando(false);
      setHorarioSelecionado(null);
      setEtapa(2);
      return;
    }

    notificar("Agendamento confirmado com sucesso!", "sucesso");
    router.push(`/${slug}/agendamento/${resultado.agendamentoId}`);
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
        {logo.tipo === "imagem" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo.url} alt={logo.alt} className="size-9 shrink-0 rounded-full border border-border object-cover" />
        ) : (
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: estabelecimento.identidadeVisual.corDestaque }}
          >
            {logo.texto}
          </div>
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
              const profissionalId = resolverProfissionalParaHorario(profissionaisCapacitados, escolhaProfissional, h, servico, estabelecimento);
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
                  if (validarDados(estabelecimento.regras.exigirTelefoneCliente)) setEtapa(4);
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
