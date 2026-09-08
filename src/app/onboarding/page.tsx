"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { BarraDeEtapas } from "@/components/ui/step-progress";
import {
  ETAPAS_ONBOARDING,
  ETAPA_PAINEL,
  ETAPA_REVISAO,
  etapaAnterior,
  podeAvancar,
  proximaEtapa,
  type RespostasOnboarding,
} from "@/lib/onboarding/onboarding";
import { lerEstadoOnboarding, reiniciarOnboarding, salvarEstadoOnboarding } from "@/lib/onboarding/onboarding-persistencia";
import { criarEstabelecimentoDemonstracao } from "@/lib/onboarding/onboarding-criar";
import { EtapaBoasVindas } from "./_etapas/etapa-boas-vindas";
import { EtapaNegocio } from "./_etapas/etapa-negocio";
import { EtapaSegmento } from "./_etapas/etapa-segmento";
import { EtapaEstrutura } from "./_etapas/etapa-estrutura";
import { EtapaEquipe } from "./_etapas/etapa-equipe";
import { EtapaObjetivo } from "./_etapas/etapa-objetivo";
import { EtapaRevisao } from "./_etapas/etapa-revisao";
import { EtapaPainel } from "./_etapas/etapa-painel";

export default function OnboardingPage() {
  const { entrarComo } = useAuth();
  const { notificar } = useToast();

  const [hidratado, setHidratado] = useState(false);
  const [etapa, setEtapa] = useState(0);
  const [respostas, setRespostas] = useState<RespostasOnboarding | null>(null);
  const [slugCriado, setSlugCriado] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  // Lê o progresso salvo só depois de montar no cliente — evita descompasso
  // de hidratação entre servidor e o localStorage do navegador.
  useEffect(() => {
    const estado = lerEstadoOnboarding();
    setEtapa(estado.etapaAtual);
    setRespostas(estado.respostas);
    setSlugCriado(estado.slugCriado);
    setHidratado(true);
  }, []);

  useEffect(() => {
    if (!hidratado || !respostas) return;
    salvarEstadoOnboarding({ etapaAtual: etapa, respostas, tenantIdCriado: null, slugCriado });
  }, [hidratado, etapa, respostas, slugCriado]);

  if (!hidratado || !respostas) {
    return <div className="min-h-screen" aria-hidden />;
  }

  function atualizar<K extends keyof RespostasOnboarding>(campo: K, valor: RespostasOnboarding[K]) {
    setRespostas((r) => (r ? { ...r, [campo]: valor } : r));
  }

  function avancar() {
    setEtapa((e) => proximaEtapa(e, respostas as RespostasOnboarding));
  }

  function voltar() {
    setEtapa((e) => etapaAnterior(e));
  }

  function reiniciar() {
    const estado = reiniciarOnboarding();
    setEtapa(estado.etapaAtual);
    setRespostas(estado.respostas);
    setSlugCriado(null);
    notificar("Demonstração reiniciada.", "info");
  }

  function criarEEntrar() {
    setCriando(true);
    const resultado = criarEstabelecimentoDemonstracao(respostas as RespostasOnboarding);
    if (!resultado.sucesso) {
      notificar(resultado.erro, "erro");
      setCriando(false);
      return;
    }
    entrarComo(resultado.sessao);
    setSlugCriado(resultado.slug);
    setCriando(false);
    setEtapa(ETAPA_PAINEL);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8 sm:px-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/" className="text-xs font-semibold text-accent hover:underline">
          ← Voltar à apresentação
        </Link>
        <button
          type="button"
          onClick={reiniciar}
          className="flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink"
        >
          <RotateCcw size={14} /> Reiniciar demonstração
        </button>
      </div>

      <BarraDeEtapas etapas={[...ETAPAS_ONBOARDING]} etapaAtual={etapa} ariaLabel="Progresso da demonstração" />

      <div className="mt-8 flex-1">
        {etapa === 0 && <EtapaBoasVindas />}
        {etapa === 1 && <EtapaNegocio valor={respostas.nomeNegocio} aoMudar={(v) => atualizar("nomeNegocio", v)} />}
        {etapa === 2 && <EtapaSegmento valor={respostas.segmento} aoEscolher={(v) => atualizar("segmento", v)} />}
        {etapa === 3 && <EtapaEstrutura valor={respostas.estrutura} aoEscolher={(v) => atualizar("estrutura", v)} />}
        {etapa === 4 && (
          <EtapaEquipe valor={respostas.quantidadeProfissionais} aoEscolher={(v) => atualizar("quantidadeProfissionais", v)} />
        )}
        {etapa === 5 && <EtapaObjetivo valor={respostas.objetivo} aoEscolher={(v) => atualizar("objetivo", v)} />}
        {etapa === ETAPA_REVISAO && <EtapaRevisao respostas={respostas} />}
        {etapa === ETAPA_PAINEL && <EtapaPainel slug={slugCriado} />}
      </div>

      {etapa < ETAPA_REVISAO && (
        <div className="mt-8 flex justify-between">
          {etapa > 0 ? (
            <Botao variante="secundaria" onClick={voltar}>
              <ChevronLeft size={16} className="mr-1" /> Voltar
            </Botao>
          ) : (
            <span />
          )}
          <Botao onClick={avancar} disabled={!podeAvancar(etapa, respostas)}>
            Continuar <ChevronRight size={16} className="ml-1" />
          </Botao>
        </div>
      )}

      {etapa === ETAPA_REVISAO && (
        <div className="mt-8 flex justify-between">
          <Botao variante="secundaria" onClick={voltar}>
            <ChevronLeft size={16} className="mr-1" /> Voltar
          </Botao>
          <Botao onClick={criarEEntrar} disabled={criando}>
            {criando ? "Criando demonstração..." : "Criar demonstração"}
          </Botao>
        </div>
      )}
    </div>
  );
}
