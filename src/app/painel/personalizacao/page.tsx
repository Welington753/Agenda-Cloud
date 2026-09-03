"use client";

import { useState } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { featureHabilitada, podeReceberAgendamentoPublico } from "@/lib/access/access-control";
import { estabelecimentoRepository, profissionalRepository, servicoRepository } from "@/lib/repositories";
import { useClientData } from "@/lib/hooks/use-client-data";
import { validarUrlFoto } from "@/lib/estabelecimentos/validacao";
import { aplicarRascunhoNaIdentidade } from "@/lib/estabelecimentos/rascunho";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRascunhoPersonalizacao } from "./use-rascunho-personalizacao";
import { SecaoPadrao } from "./_secoes/secao-padrao";
import { SecaoAvancada } from "./_secoes/secao-avancada";
import { PainelPreVisualizacao } from "./_secoes/painel-pre-visualizacao";

export default function PainelPersonalizacaoPage() {
  return (
    <RequirePermission permissao="personalizacao.gerenciar">
      <ConteudoPersonalizacao />
    </RequirePermission>
  );
}

function ConteudoPersonalizacao() {
  const { tenantId, estabelecimento, terminologia, carregando, recarregar, podeAcessar } = useTenant();
  const { notificar } = useToast();
  const [salvando, setSalvando] = useState(false);

  const { rascunho, snapshot, fotosTexto, logoErro, sujo, atualizar, aoMudarFotos, moverSecao, aoSelecionarArquivoLogo, removerLogo, cancelar } =
    useRascunhoPersonalizacao(estabelecimento);

  const { dados: dadosPreview } = useClientData(() => {
    if (!estabelecimento) return null;
    return {
      profissionais: profissionalRepository.listarPorTenant(tenantId).filter((p) => p.ativo && p.agendamentoOnlineAtivo),
      servicos: servicoRepository.listarPorTenant(tenantId).filter((s) => s.ativoNoAgendamentoPublico),
    };
  }, [tenantId, estabelecimento?.tenantId]);

  if (carregando || !estabelecimento || !rascunho || !snapshot) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const avancadaHabilitada = featureHabilitada(estabelecimento.plano, estabelecimento.featuresDesativadas, "personalizacaoAvancada");
  const slug = estabelecimento.slug;

  const salvar = (abrirDepois: boolean) => {
    if (!podeAcessar("personalizacao.gerenciar").permitido) return;
    for (const foto of rascunho.fotos) {
      const validacaoFoto = validarUrlFoto(foto);
      if (!validacaoFoto.valido) {
        notificar(validacaoFoto.motivo ?? "URL de foto inválida.", "erro");
        return;
      }
    }
    setSalvando(true);
    try {
      estabelecimentoRepository.atualizar(tenantId, {
        identidadeVisual: {
          ...estabelecimento.identidadeVisual,
          modelo: rascunho.modelo,
          logoIniciais: rascunho.logoIniciais.trim().toUpperCase().slice(0, 3) || "ES",
          logoUrl: rascunho.logoUrl,
          corPrincipal: rascunho.corPrincipal,
          corSecundaria: rascunho.corSecundaria,
          corDestaque: rascunho.corDestaque,
          fotos: rascunho.fotos,
          personalizacaoAvancada: avancadaHabilitada
            ? {
                ordemSecoes: rascunho.ordemSecoes,
                rodapePersonalizado: rascunho.rodapePersonalizado.trim() || undefined,
                ocultarMarcaPlataforma: rascunho.ocultarMarca,
              }
            : estabelecimento.identidadeVisual.personalizacaoAvancada,
        },
      });
      notificar("Personalização salva.", "sucesso");
      recarregar();
      if (abrirDepois) window.open(`/${slug}`, "_blank", "noopener,noreferrer");
    } catch (erro) {
      notificar(erro instanceof Error ? erro.message : "Não foi possível salvar a personalização.", "erro");
    } finally {
      setSalvando(false);
    }
  };

  function abrirPaginaPublicaSalva() {
    window.open(`/${slug}`, "_blank", "noopener,noreferrer");
  }

  const estabelecimentoPreview = aplicarRascunhoNaIdentidade(estabelecimento, rascunho);
  const agendamentoPublicoHabilitadoPreview =
    featureHabilitada(estabelecimento.plano, estabelecimento.featuresDesativadas, "agendamentoPublico") &&
    podeReceberAgendamentoPublico(estabelecimento.status);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-ink">Personalização</h1>
            <p className="text-sm text-ink-soft">Aparência da página pública do seu estabelecimento.</p>
          </div>
          {sujo && (
            <span className="flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-[color:var(--color-warning)]">
              <AlertCircle size={13} /> Alterações não salvas
            </span>
          )}
        </div>

        <SecaoPadrao
          rascunho={rascunho}
          fotosTexto={fotosTexto}
          logoErro={logoErro}
          atualizar={atualizar}
          aoMudarFotos={aoMudarFotos}
          aoSelecionarArquivoLogo={aoSelecionarArquivoLogo}
          removerLogo={removerLogo}
        />

        <SecaoAvancada habilitada={avancadaHabilitada} rascunho={rascunho} atualizar={atualizar} moverSecao={moverSecao} />

        <div className="flex flex-wrap gap-2">
          <Botao onClick={() => salvar(false)} disabled={!sujo || salvando}>
            {salvando ? "Salvando..." : "Salvar personalização"}
          </Botao>
          <Botao variante="secundaria" onClick={() => salvar(true)} disabled={salvando}>
            Salvar e abrir página pública
          </Botao>
          <Botao variante="secundaria" onClick={cancelar} disabled={!sujo || salvando}>
            Cancelar alterações
          </Botao>
          <Botao variante="fantasma" onClick={abrirPaginaPublicaSalva}>
            <ExternalLink size={16} className="mr-1.5" /> Abrir página pública salva
          </Botao>
        </div>
      </div>

      <PainelPreVisualizacao
        estabelecimentoPreview={estabelecimentoPreview}
        terminologia={terminologia}
        agendamentoPublicoHabilitadoPreview={agendamentoPublicoHabilitadoPreview}
        dadosPreview={dadosPreview}
      />
    </div>
  );
}
