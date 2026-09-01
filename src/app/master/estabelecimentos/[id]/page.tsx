"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ExternalLink, PlayCircle, RotateCcw, UserCheck } from "lucide-react";
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
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Badge, BadgeStatusConvite, BadgeStatusEstabelecimento, BadgeStatusUsuario } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatarData } from "@/lib/format";
import { DEFINICOES_PLANO, FEATURES_AINDA_NAO_IMPLEMENTADAS, ROTULO_FEATURE, obterDefinicaoPlano } from "@/lib/planos";
import { CATEGORIAS_NEGOCIO } from "@/lib/verticals/terminologia";
import type { CodigoPlano, Feature } from "@/lib/types";

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
    const planoAnterior = estabelecimento.plano;
    const featuresAnteriores = estabelecimento.featuresDesativadas;
    estabelecimentoRepository.atualizar(tenantId, {
      plano,
      featuresDesativadas,
      limites: { maxProfissionais, maxUnidades },
    });
    if (planoAnterior !== plano) {
      auditoriaRepository.registrar({
        acao: "tenant.plano_alterado",
        usuarioResponsavelId: usuarioAtual.id,
        usuarioResponsavelNome: usuarioAtual.nome,
        tenantId,
        resumo: `Plano alterado de ${obterDefinicaoPlano(planoAnterior).nome} para ${definicaoPlanoAtual.nome}.`,
        dadosAnteriores: { plano: planoAnterior },
        dadosPosteriores: { plano },
      });
    }
    if (JSON.stringify(featuresAnteriores) !== JSON.stringify(featuresDesativadas)) {
      auditoriaRepository.registrar({
        acao: "tenant.feature_alterada",
        usuarioResponsavelId: usuarioAtual.id,
        usuarioResponsavelNome: usuarioAtual.nome,
        tenantId,
        resumo: "Funcionalidades desativadas por exceção foram atualizadas.",
        dadosAnteriores: { featuresDesativadas: featuresAnteriores },
        dadosPosteriores: { featuresDesativadas },
      });
    }
    notificar("Plano e funcionalidades atualizados.", "sucesso");
    recarregar();
  }

  function suspender() {
    if (!motivoSuspensao.trim()) {
      notificar("Informe o motivo da suspensão.", "erro");
      return;
    }
    estabelecimentoRepository.atualizar(tenantId, { status: "suspenso", motivoSuspensao: motivoSuspensao.trim() });
    auditoriaRepository.registrar({
      acao: "tenant.suspenso",
      usuarioResponsavelId: usuarioAtual.id,
      usuarioResponsavelNome: usuarioAtual.nome,
      tenantId,
      resumo: `Estabelecimento suspenso: ${motivoSuspensao.trim()}`,
      dadosAnteriores: { status: estabelecimento.status },
      dadosPosteriores: { status: "suspenso", motivoSuspensao: motivoSuspensao.trim() },
    });
    notificar("Estabelecimento suspenso.", "sucesso");
    setMotivoSuspensao("");
    recarregar();
  }

  function reativar() {
    estabelecimentoRepository.atualizar(tenantId, { status: "ativo", motivoSuspensao: undefined });
    auditoriaRepository.registrar({
      acao: "tenant.reativado",
      usuarioResponsavelId: usuarioAtual.id,
      usuarioResponsavelNome: usuarioAtual.nome,
      tenantId,
      resumo: "Estabelecimento reativado.",
      dadosAnteriores: { status: estabelecimento.status },
      dadosPosteriores: { status: "ativo" },
    });
    notificar("Estabelecimento reativado.", "sucesso");
    recarregar();
  }

  function aceitarConvite(conviteId: string) {
    const convite = convites.find((c) => c.id === conviteId);
    if (!convite || !convite.tenantId) return;
    const usuarioAlvo = equipe.find((e) => e.usuario?.email === convite.email)?.usuario;
    if (usuarioAlvo) {
      usuarioEstabelecimentoRepository.atualizar(usuarioAlvo.id, { status: "ativo" });
    }
    conviteRepository.atualizarStatus(convite.id, "aceito", {
      aceitoEm: new Date().toISOString(),
      usuarioIdGerado: usuarioAlvo?.id,
    });
    notificar("Convite aceito (simulado). Conta ativada.", "sucesso");
    recarregar();
  }

  function reenviarConvite(conviteId: string) {
    const novo = conviteRepository.reenviar(conviteId);
    if (!novo) {
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

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <CartaoTitulo>Plano e funcionalidades</CartaoTitulo>
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.values(DEFINICOES_PLANO).map((p) => (
              <button
                key={p.codigo}
                type="button"
                onClick={() => {
                  setPlano(p.codigo);
                  setFeaturesDesativadas((atual) => atual.filter((f) => p.features.includes(f)));
                }}
                className={`rounded-[var(--radius-card)] border p-3 text-left text-sm transition-colors ${
                  plano === p.codigo ? "border-accent bg-accent-soft/30" : "border-border hover:border-accent"
                }`}
              >
                <p className="font-semibold text-ink">{p.nome}</p>
                <p className="mt-1 text-xs text-ink-soft">{p.descricaoCurta}</p>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Máx. de profissionais</label>
              <input
                type="number"
                min={1}
                value={maxProfissionais}
                onChange={(e) => setMaxProfissionais(Number(e.target.value))}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Máx. de unidades</label>
              <input
                type="number"
                min={1}
                value={maxUnidades}
                onChange={(e) => setMaxUnidades(Number(e.target.value))}
                className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            {definicaoPlanoAtual.features.map((feature) => (
              <label key={feature} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={!featuresDesativadas.includes(feature)}
                  onChange={() => alternarFeature(feature)}
                />
                {ROTULO_FEATURE[feature]}
                {FEATURES_AINDA_NAO_IMPLEMENTADAS.includes(feature) && <Badge cor="aviso">Em breve</Badge>}
              </label>
            ))}
          </div>
          <Botao tamanho="sm" onClick={salvarPlano}>
            Salvar plano e funcionalidades
          </Botao>
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo className="space-y-3">
          <CartaoTitulo>Status do estabelecimento</CartaoTitulo>
          {estabelecimento.status === "suspenso" || estabelecimento.status === "cancelado" ? (
            <Botao tamanho="sm" variante="secundaria" onClick={reativar}>
              <PlayCircle size={16} className="mr-1.5" /> Reativar estabelecimento
            </Botao>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={motivoSuspensao}
                onChange={(e) => setMotivoSuspensao(e.target.value)}
                placeholder="Motivo da suspensão"
                className="flex-1 rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
              />
              <Botao tamanho="sm" variante="perigo" onClick={suspender}>
                Suspender
              </Botao>
            </div>
          )}
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo>
          <CartaoTitulo className="mb-3">Equipe e convites</CartaoTitulo>
          <ul className="mb-4 divide-y divide-border">
            {equipe.map(({ membership, usuario: u }) => (
              <li key={membership.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium text-ink">{u?.nome ?? "—"}</p>
                  <p className="text-xs text-ink-soft">{u?.email} · {membership.papel}</p>
                </div>
                {u && <BadgeStatusUsuario status={u.status} />}
              </li>
            ))}
          </ul>
          {convites.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhum convite registrado.</p>
          ) : (
            <ul className="divide-y divide-border">
              {convites.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="font-medium text-ink">{c.nome}</p>
                    <p className="text-xs text-ink-soft">
                      {c.email} · {c.papel} · expira em {formatarData(c.expiraEm)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <BadgeStatusConvite status={c.status} />
                    {c.status === "pendente" && (
                      <button type="button" onClick={() => aceitarConvite(c.id)} className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                        <UserCheck size={14} /> Aceitar (simular)
                      </button>
                    )}
                    {(c.status === "pendente" || c.status === "expirado") && (
                      <button type="button" onClick={() => reenviarConvite(c.id)} className="flex items-center gap-1 text-xs font-semibold text-ink-soft hover:underline">
                        <RotateCcw size={14} /> Reenviar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CartaoCorpo>
      </Cartao>

      <Cartao>
        <CartaoCorpo>
          <CartaoTitulo className="mb-3">Auditoria deste estabelecimento</CartaoTitulo>
          {auditoria.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhum registro ainda.</p>
          ) : (
            <ul className="space-y-2">
              {auditoria.map((r) => (
                <li key={r.id} className="text-sm">
                  <p className="text-ink">{r.resumo}</p>
                  <p className="text-xs text-ink-soft">
                    {formatarData(r.em)} · {r.usuarioResponsavelNome}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}
