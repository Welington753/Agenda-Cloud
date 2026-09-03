"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { RequirePlatformPermission } from "@/components/layout/require-platform-permission";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { BarraDeEtapas } from "@/components/ui/step-progress";
import { estabelecimentoRepository } from "@/lib/repositories";
import { obterDefinicaoPlano } from "@/lib/planos";
import { obterTerminologia } from "@/lib/verticals/terminologia";
import { normalizarSlug, validarFormatoSlug } from "@/lib/estabelecimentos/validacao";
import { criarEstabelecimentoComDono } from "@/lib/estabelecimentos/criar-estabelecimento";
import type { CategoriaNegocio, CodigoPlano, Feature, ModeloPaginaPublica } from "@/lib/types";
import { EtapaNegocio } from "./_etapas/etapa-negocio";
import { EtapaPlano } from "./_etapas/etapa-plano";
import { EtapaIdentidade } from "./_etapas/etapa-identidade";
import { EtapaProprietario } from "./_etapas/etapa-proprietario";
import { EtapaRevisao } from "./_etapas/etapa-revisao";

const ETAPAS = ["Negócio", "Plano", "Identidade", "Proprietário", "Revisão"];

export interface EstadoFormulario {
  nome: string;
  nomeFantasia: string;
  categoria: CategoriaNegocio;
  documentoFiscal: string;
  telefone: string;
  email: string;
  endereco: string;
  fusoHorario: string;
  plano: CodigoPlano;
  featuresDesativadas: Feature[];
  maxProfissionais: number;
  maxUnidades: number;
  slug: string;
  nomeExibido: string;
  logoIniciais: string;
  corPrincipal: string;
  corSecundaria: string;
  corDestaque: string;
  modelo: ModeloPaginaPublica;
  textoApresentacao: string;
  instagram: string;
  donoNome: string;
  donoEmail: string;
  donoTelefone: string;
}

const ESTADO_INICIAL: EstadoFormulario = {
  nome: "",
  nomeFantasia: "",
  categoria: "barbearia",
  documentoFiscal: "",
  telefone: "",
  email: "",
  endereco: "",
  fusoHorario: "America/Sao_Paulo",
  plano: "essencial",
  featuresDesativadas: [],
  maxProfissionais: obterDefinicaoPlano("essencial").limites.maxProfissionais,
  maxUnidades: obterDefinicaoPlano("essencial").limites.maxUnidades,
  slug: "",
  nomeExibido: "",
  logoIniciais: "",
  corPrincipal: "#1C1A17",
  corSecundaria: "#FAF7F2",
  corDestaque: "#B5651D",
  modelo: "classico",
  textoApresentacao: "",
  instagram: "",
  donoNome: "",
  donoEmail: "",
  donoTelefone: "",
};

export default function NovoEstabelecimentoPage() {
  return (
    <RequirePlatformPermission permissao="estabelecimentos.gerenciar">
      <ConteudoNovoEstabelecimento />
    </RequirePlatformPermission>
  );
}

function ConteudoNovoEstabelecimento() {
  const { usuario } = useAuth();
  const { notificar } = useToast();
  const router = useRouter();
  const [etapa, setEtapa] = useState(0);
  const [form, setForm] = useState<EstadoFormulario>(ESTADO_INICIAL);
  const [slugEditadoManualmente, setSlugEditadoManualmente] = useState(false);
  const [erroSlug, setErroSlug] = useState<string | null>(null);
  const [publicando, setPublicando] = useState(false);

  function atualizar<K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function aoMudarNome(nome: string) {
    atualizar("nome", nome);
    if (!slugEditadoManualmente) {
      const sugestao = normalizarSlug(nome);
      atualizar("slug", sugestao);
      setErroSlug(null);
    }
    if (!form.nomeExibido) atualizar("nomeExibido", nome);
  }

  function aoMudarSlug(slug: string) {
    setSlugEditadoManualmente(true);
    atualizar("slug", normalizarSlug(slug));
    setErroSlug(null);
  }

  function aoMudarPlano(plano: CodigoPlano) {
    const def = obterDefinicaoPlano(plano);
    setForm((f) => ({
      ...f,
      plano,
      maxProfissionais: def.limites.maxProfissionais,
      maxUnidades: def.limites.maxUnidades,
      featuresDesativadas: f.featuresDesativadas.filter((feat) => def.features.includes(feat)),
    }));
  }

  function alternarFeature(feature: Feature) {
    setForm((f) => ({
      ...f,
      featuresDesativadas: f.featuresDesativadas.includes(feature)
        ? f.featuresDesativadas.filter((x) => x !== feature)
        : [...f.featuresDesativadas, feature],
    }));
  }

  function validarEtapa(atual: number): boolean {
    if (atual === 0) {
      if (!form.nome.trim() || !form.endereco.trim() || !form.telefone.trim()) {
        notificar("Preencha nome, endereço e telefone do negócio.", "erro");
        return false;
      }
    }
    if (atual === 2) {
      const validacaoFormato = validarFormatoSlug(form.slug);
      if (!validacaoFormato.valido) {
        setErroSlug(validacaoFormato.motivo ?? "Endereço público inválido.");
        return false;
      }
      if (!estabelecimentoRepository.slugDisponivel(form.slug)) {
        setErroSlug(`O endereço "/${form.slug}" já está em uso por outro estabelecimento.`);
        return false;
      }
    }
    if (atual === 3) {
      if (!form.donoNome.trim() || !form.donoEmail.trim()) {
        notificar("Informe nome e e-mail do proprietário.", "erro");
        return false;
      }
    }
    return true;
  }

  function avancar() {
    if (!validarEtapa(etapa)) return;
    setEtapa((e) => Math.min(ETAPAS.length - 1, e + 1));
  }

  function voltar() {
    setEtapa((e) => Math.max(0, e - 1));
  }

  function publicar() {
    if (!usuario) return;
    if (!estabelecimentoRepository.slugDisponivel(form.slug)) {
      setErroSlug(`O endereço "/${form.slug}" já está em uso por outro estabelecimento.`);
      setEtapa(2);
      return;
    }
    const validacaoFinal = validarFormatoSlug(form.slug);
    if (!validacaoFinal.valido) {
      setErroSlug(validacaoFinal.motivo ?? "Endereço público inválido.");
      setEtapa(2);
      return;
    }
    setPublicando(true);

    const resultado = criarEstabelecimentoComDono(form, { id: usuario.id, nome: usuario.nome });
    if (!resultado.sucesso) {
      notificar(resultado.erro, "erro");
      setPublicando(false);
      setEtapa(2);
      return;
    }

    notificar("Estabelecimento criado! Convite do proprietário pendente.", "sucesso");
    router.push(`/master/estabelecimentos/${resultado.estabelecimento.tenantId}`);
  }

  const terminologia = obterTerminologia(form.categoria);
  const definicaoPlano = obterDefinicaoPlano(form.plano);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/master/estabelecimentos" className="text-xs font-semibold text-accent hover:underline">
          ← Estabelecimentos
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">Novo estabelecimento</h1>
      </div>

      <BarraDeEtapas etapas={ETAPAS} etapaAtual={etapa} />

      {etapa === 0 && <EtapaNegocio form={form} aoMudarNome={aoMudarNome} atualizar={atualizar} />}
      {etapa === 1 && (
        <EtapaPlano form={form} definicaoPlano={definicaoPlano} aoMudarPlano={aoMudarPlano} atualizar={atualizar} alternarFeature={alternarFeature} />
      )}
      {etapa === 2 && <EtapaIdentidade form={form} erroSlug={erroSlug} aoMudarSlug={aoMudarSlug} atualizar={atualizar} />}
      {etapa === 3 && (
        <EtapaProprietario form={form} artigoFeminino={terminologia.estabelecimento.artigo === "a"} atualizar={atualizar} />
      )}
      {etapa === 4 && <EtapaRevisao form={form} definicaoPlano={definicaoPlano} />}

      <div className="flex justify-between">
        {etapa > 0 ? (
          <Botao variante="secundaria" onClick={voltar}>
            <ChevronLeft size={16} className="mr-1" /> Voltar
          </Botao>
        ) : (
          <span />
        )}
        {etapa < ETAPAS.length - 1 ? (
          <Botao onClick={avancar}>
            Continuar <ChevronRight size={16} className="ml-1" />
          </Botao>
        ) : (
          <Botao onClick={publicar} disabled={publicando}>
            <Check size={16} className="mr-1.5" /> {publicando ? "Publicando..." : "Publicar estabelecimento"}
          </Botao>
        )}
      </div>
    </div>
  );
}
