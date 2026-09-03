"use client";

import { useEffect, useState } from "react";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { estabelecimentoRepository } from "@/lib/repositories";
import { restaurarTenant } from "@/lib/repositories/restaurar";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CategoriaNegocio, DiaSemana } from "@/lib/types";
import { SecaoCategoria } from "./_secoes/secao-categoria";
import { SecaoIdentidade } from "./_secoes/secao-identidade";
import { SecaoHorarios } from "./_secoes/secao-horarios";
import { SecaoPolitica } from "./_secoes/secao-politica";
import { SecaoRestaurar } from "./_secoes/secao-restaurar";

export default function PainelConfiguracoesPage() {
  return (
    <RequirePermission permissao="configuracoes.gerenciar">
      <ConteudoConfiguracoes />
    </RequirePermission>
  );
}

export interface EstadoConfiguracoes {
  categoria: CategoriaNegocio;
  nome: string;
  nomeCurto: string;
  endereco: string;
  telefone: string;
  instagram: string;
  textoApresentacao: string;
  orientacoesAntesVisita: string;
  diasFuncionamento: DiaSemana[];
  abertura: string;
  fechamento: string;
  antecedenciaMinimaMinutos: number;
  limiteDiasFuturos: number;
  prazoCancelamentoHoras: number;
  intervaloPadraoMinutos: number;
  confirmacaoAutomatica: boolean;
  permitirQualquerProfissional: boolean;
  permitirRemarcacaoCliente: boolean;
  exigirTelefoneCliente: boolean;
  exibirPrecoPublico: boolean;
}

function ConteudoConfiguracoes() {
  const { tenantId, terminologia, estabelecimento: dados, carregando, recarregar, podeAcessar } = useTenant();
  const { notificar } = useToast();

  const [copiado, setCopiado] = useState(false);
  const [form, setForm] = useState<EstadoConfiguracoes>({
    categoria: "outro",
    nome: "",
    nomeCurto: "",
    endereco: "",
    telefone: "",
    instagram: "",
    textoApresentacao: "",
    orientacoesAntesVisita: "",
    diasFuncionamento: [],
    abertura: "09:00",
    fechamento: "19:00",
    antecedenciaMinimaMinutos: 60,
    limiteDiasFuturos: 30,
    prazoCancelamentoHoras: 3,
    intervaloPadraoMinutos: 0,
    confirmacaoAutomatica: false,
    permitirQualquerProfissional: true,
    permitirRemarcacaoCliente: true,
    exigirTelefoneCliente: true,
    exibirPrecoPublico: true,
  });

  useEffect(() => {
    if (!dados) return;
    setForm({
      categoria: dados.categoria,
      nome: dados.identidadeVisual.nome,
      nomeCurto: dados.identidadeVisual.nomeCurto,
      endereco: dados.identidadeVisual.endereco,
      telefone: dados.identidadeVisual.telefone,
      instagram: dados.identidadeVisual.redesSociais?.instagram ?? "",
      textoApresentacao: dados.identidadeVisual.textoApresentacao,
      orientacoesAntesVisita: dados.regras.orientacoesAntesVisita ?? "",
      diasFuncionamento: dados.horarioGeral.diasFuncionamento,
      abertura: dados.horarioGeral.abertura,
      fechamento: dados.horarioGeral.fechamento,
      antecedenciaMinimaMinutos: dados.regras.antecedenciaMinimaMinutos,
      limiteDiasFuturos: dados.regras.limiteDiasFuturos,
      prazoCancelamentoHoras: dados.regras.prazoCancelamentoHoras,
      intervaloPadraoMinutos: dados.regras.intervaloPadraoMinutos,
      confirmacaoAutomatica: dados.regras.confirmacaoAutomatica,
      permitirQualquerProfissional: dados.regras.permitirQualquerProfissional,
      permitirRemarcacaoCliente: dados.regras.permitirRemarcacaoCliente,
      exigirTelefoneCliente: dados.regras.exigirTelefoneCliente,
      exibirPrecoPublico: dados.regras.exibirPrecoPublico,
    });
  }, [dados]);

  if (carregando || !dados) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const slugAtual = dados.slug;

  function alternarDia(dia: DiaSemana) {
    setForm((f) => ({
      ...f,
      diasFuncionamento: f.diasFuncionamento.includes(dia)
        ? f.diasFuncionamento.filter((d) => d !== dia)
        : [...f.diasFuncionamento, dia].sort((a, b) => a - b),
    }));
  }

  // Confere a permissão de novo aqui dentro — a página já está atrás de
  // <RequirePermission>, mas a função que muta nunca deve depender só disso
  // (mesma disciplina aplicada em /master/administradores e nas comissões).
  function salvar() {
    if (!podeAcessar("configuracoes.gerenciar").permitido) return;
    try {
      estabelecimentoRepository.atualizar(tenantId, {
        categoria: form.categoria,
        identidadeVisual: {
          ...dados!.identidadeVisual,
          nome: form.nome.trim(),
          nomeCurto: form.nomeCurto.trim() || form.nome.trim(),
          endereco: form.endereco.trim(),
          telefone: form.telefone.trim(),
          redesSociais: form.instagram.trim() ? { instagram: form.instagram.trim() } : undefined,
          textoApresentacao: form.textoApresentacao.trim(),
        },
        horarioGeral: {
          diasFuncionamento: form.diasFuncionamento,
          abertura: form.abertura,
          fechamento: form.fechamento,
        },
        regras: {
          ...dados!.regras,
          antecedenciaMinimaMinutos: form.antecedenciaMinimaMinutos,
          limiteDiasFuturos: form.limiteDiasFuturos,
          prazoCancelamentoHoras: form.prazoCancelamentoHoras,
          intervaloPadraoMinutos: form.intervaloPadraoMinutos,
          confirmacaoAutomatica: form.confirmacaoAutomatica,
          permitirQualquerProfissional: form.permitirQualquerProfissional,
          permitirRemarcacaoCliente: form.permitirRemarcacaoCliente,
          exigirTelefoneCliente: form.exigirTelefoneCliente,
          exibirPrecoPublico: form.exibirPrecoPublico,
          orientacoesAntesVisita: form.orientacoesAntesVisita.trim() || undefined,
        },
      });
      notificar("Configurações salvas.", "sucesso");
      recarregar();
    } catch (erro) {
      notificar(erro instanceof Error ? erro.message : "Não foi possível salvar as configurações.", "erro");
    }
  }

  function copiarLink() {
    const link = `${window.location.origin}/${slugAtual}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  function abrirPaginaPublica() {
    window.open(`/${slugAtual}`, "_blank", "noopener,noreferrer");
  }

  function aoRestaurar() {
    if (
      !window.confirm(
        `Isso vai apagar os dados simulados ${terminologia.estabelecimento.artigo === "a" ? "desta" : "deste"} ${terminologia.estabelecimento.singular.toLowerCase()} e recarregar a demonstração original. Outros estabelecimentos não são afetados. Continuar?`
      )
    ) {
      return;
    }
    restaurarTenant(tenantId);
    notificar("Dados restaurados para o estado inicial da demonstração.", "sucesso");
    recarregar();
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">Configurações</h1>
        <p className="text-sm text-ink-soft">
          Dados públicos e regras da agenda {terminologia.estabelecimento.artigo === "a" ? "da sua" : "do seu"}{" "}
          {terminologia.estabelecimento.singular.toLowerCase()}.
        </p>
      </div>

      <SecaoCategoria categoria={form.categoria} terminologia={terminologia} setForm={setForm} />

      <SecaoIdentidade
        form={form}
        terminologia={terminologia}
        slugAtual={slugAtual}
        copiado={copiado}
        setForm={setForm}
        copiarLink={copiarLink}
        abrirPaginaPublica={abrirPaginaPublica}
      />

      <SecaoHorarios form={form} alternarDia={alternarDia} setForm={setForm} />

      <SecaoPolitica form={form} terminologia={terminologia} setForm={setForm} />

      <Botao onClick={salvar}>Salvar configurações</Botao>

      <SecaoRestaurar terminologia={terminologia} aoRestaurar={aoRestaurar} />
    </div>
  );
}
