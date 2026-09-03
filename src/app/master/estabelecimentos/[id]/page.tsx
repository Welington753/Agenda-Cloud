"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { RequirePlatformPermission } from "@/components/layout/require-platform-permission";
import { useClientData } from "@/lib/hooks/use-client-data";
import {
  auditoriaRepository,
  conviteRepository,
  estabelecimentoRepository,
  membershipRepository,
  usuarioEstabelecimentoRepository,
} from "@/lib/repositories";
import { Badge, BadgeStatusEstabelecimento } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { obterDefinicaoPlano } from "@/lib/planos";
import { CATEGORIAS_NEGOCIO } from "@/lib/verticals/terminologia";
import type { CodigoPlano, Feature } from "@/lib/types";
import {
  aceitarConvite,
  reativarEstabelecimento,
  reenviarConvite,
  salvarPlanoEFeatures,
  suspenderEstabelecimento,
} from "./acoes-estabelecimento";
import { SecaoPlano } from "./_secoes/secao-plano";
import { SecaoStatus } from "./_secoes/secao-status";
import { SecaoEquipe } from "./_secoes/secao-equipe";
import { SecaoAuditoria } from "./_secoes/secao-auditoria";

export default function DetalheEstabelecimentoPage() {
  return (
    <RequirePlatformPermission permissao="estabelecimentos.gerenciar">
      <ConteudoDetalhe />
    </RequirePlatformPermission>
  );
}

function ConteudoDetalhe() {
  const params = useParams<{ id: string }>();
  const tenantId = params.id;
  const { usuario } = useAuth();
  const { notificar } = useToast();

  const { dados, carregando, recarregar } = useClientData(() => {
    const estabelecimento = estabelecimentoRepository.obterPorTenantId(tenantId);
    if (!estabelecimento) return null;
    const memberships = membershipRepository.listarPorTenant(tenantId);
    const usuarios = usuarioEstabelecimentoRepository.listarTodos();
    const equipe = memberships.map((m) => ({ membership: m, usuario: usuarios.find((u) => u.id === m.usuarioId) }));
    return {
      estabelecimento,
      equipe,
      convites: conviteRepository.listarPorTenant(tenantId),
      auditoria: auditoriaRepository.listarPorTenant(tenantId),
    };
  }, [tenantId]);

  const [plano, setPlano] = useState<CodigoPlano>("essencial");
  const [featuresDesativadas, setFeaturesDesativadas] = useState<Feature[]>([]);
  const [maxProfissionais, setMaxProfissionais] = useState(1);
  const [maxUnidades, setMaxUnidades] = useState(1);
  const [motivoSuspensao, setMotivoSuspensao] = useState("");

  useEffect(() => {
    if (!dados) return;
    setPlano(dados.estabelecimento.plano);
    setFeaturesDesativadas(dados.estabelecimento.featuresDesativadas);
    setMaxProfissionais(dados.estabelecimento.limites.maxProfissionais);
    setMaxUnidades(dados.estabelecimento.limites.maxUnidades);
  }, [dados]);

  if (carregando || !dados || !usuario) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { estabelecimento, equipe, convites, auditoria } = dados;
  const definicaoPlanoAtual = obterDefinicaoPlano(plano);
  const usuarioAtual = usuario;

  function alternarFeature(feature: Feature) {
    setFeaturesDesativadas((atual) => (atual.includes(feature) ? atual.filter((f) => f !== feature) : [...atual, feature]));
  }

  function salvarPlano() {
    salvarPlanoEFeatures(tenantId, estabelecimento, plano, featuresDesativadas, { maxProfissionais, maxUnidades }, usuarioAtual);
    notificar("Plano e funcionalidades atualizados.", "sucesso");
    recarregar();
  }

  function suspender() {
    if (!motivoSuspensao.trim()) {
      notificar("Informe o motivo da suspensão.", "erro");
      return;
    }
    suspenderEstabelecimento(tenantId, estabelecimento, motivoSuspensao.trim(), usuarioAtual);
    notificar("Estabelecimento suspenso.", "sucesso");
    setMotivoSuspensao("");
    recarregar();
  }

  function reativar() {
    reativarEstabelecimento(tenantId, estabelecimento, usuarioAtual);
    notificar("Estabelecimento reativado.", "sucesso");
    recarregar();
  }

  function aoAceitarConvite(conviteId: string) {
    const prosseguiu = aceitarConvite(convites, equipe, conviteId);
    if (!prosseguiu) return;
    notificar("Convite aceito (simulado). Conta ativada.", "sucesso");
    recarregar();
  }

  function aoReenviarConvite(conviteId: string) {
    const sucesso = reenviarConvite(conviteId);
    if (!sucesso) {
      notificar("Só é possível reenviar convites pendentes ou expirados.", "erro");
      return;
    }
    notificar("Convite reenviado — o link anterior foi invalidado.", "sucesso");
    recarregar();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex size-12 items-center justify-center rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: estabelecimento.identidadeVisual.corDestaque }}
          >
            {estabelecimento.identidadeVisual.logoIniciais}
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink">{estabelecimento.identidadeVisual.nome}</h1>
            <Link
              href={`/${estabelecimento.slug}`}
              target="_blank"
              className="flex items-center gap-1 text-xs text-accent hover:underline"
            >
              /{estabelecimento.slug} <ExternalLink size={12} />
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <BadgeStatusEstabelecimento status={estabelecimento.status} />
          <Badge cor="destaque">{obterDefinicaoPlano(estabelecimento.plano).nome}</Badge>
          <Badge cor="info">{CATEGORIAS_NEGOCIO.find((c) => c.valor === estabelecimento.categoria)?.rotulo}</Badge>
        </div>
      </div>

      {estabelecimento.status === "suspenso" && estabelecimento.motivoSuspensao && (
        <div className="flex items-start gap-2 rounded-[var(--radius-control)] bg-danger-soft p-3 text-sm text-[color:var(--color-danger)]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>Suspenso: {estabelecimento.motivoSuspensao}</p>
        </div>
      )}

      <SecaoPlano
        plano={plano}
        featuresDesativadas={featuresDesativadas}
        maxProfissionais={maxProfissionais}
        maxUnidades={maxUnidades}
        definicaoPlanoAtual={definicaoPlanoAtual}
        aoEscolherPlano={(codigo) => {
          setPlano(codigo);
          setFeaturesDesativadas((atual) => atual.filter((f) => obterDefinicaoPlano(codigo).features.includes(f)));
        }}
        alternarFeature={alternarFeature}
        setMaxProfissionais={setMaxProfissionais}
        setMaxUnidades={setMaxUnidades}
        salvarPlano={salvarPlano}
      />

      <SecaoStatus
        status={estabelecimento.status}
        motivoSuspensao={motivoSuspensao}
        setMotivoSuspensao={setMotivoSuspensao}
        suspender={suspender}
        reativar={reativar}
      />

      <SecaoEquipe equipe={equipe} convites={convites} aoAceitarConvite={aoAceitarConvite} aoReenviarConvite={aoReenviarConvite} />

      <SecaoAuditoria auditoria={auditoria} />
    </div>
  );
}
