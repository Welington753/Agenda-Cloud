"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { featureHabilitada } from "@/lib/access/access-control";
import { estabelecimentoRepository } from "@/lib/repositories";
import { useToast } from "@/components/ui/toast";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ModeloPaginaPublica } from "@/lib/types";

const ROTULO_SECAO: Record<string, string> = {
  servicos: "Serviços",
  equipe: "Equipe",
  apresentacao: "Apresentação",
  fotos: "Fotos",
};

export default function PainelPersonalizacaoPage() {
  return (
    <RequirePermission permissao="personalizacao.gerenciar">
      <ConteudoPersonalizacao />
    </RequirePermission>
  );
}

function ConteudoPersonalizacao() {
  const { tenantId, estabelecimento, carregando, recarregar } = useTenant();
  const { notificar } = useToast();

  const [modelo, setModelo] = useState<ModeloPaginaPublica>("classico");
  const [corPrincipal, setCorPrincipal] = useState("#1C1A17");
  const [corSecundaria, setCorSecundaria] = useState("#FAF7F2");
  const [corDestaque, setCorDestaque] = useState("#B5651D");
  const [fotos, setFotos] = useState("");
  const [ordemSecoes, setOrdemSecoes] = useState<("servicos" | "equipe" | "apresentacao" | "fotos")[]>([
    "apresentacao",
    "servicos",
    "equipe",
    "fotos",
  ]);
  const [rodapePersonalizado, setRodapePersonalizado] = useState("");
  const [ocultarMarca, setOcultarMarca] = useState(false);

  useEffect(() => {
    if (!estabelecimento) return;
    setModelo(estabelecimento.identidadeVisual.modelo);
    setCorPrincipal(estabelecimento.identidadeVisual.corPrincipal);
    setCorSecundaria(estabelecimento.identidadeVisual.corSecundaria);
    setCorDestaque(estabelecimento.identidadeVisual.corDestaque);
    setFotos(estabelecimento.identidadeVisual.fotos.join("\n"));
    const avancada = estabelecimento.identidadeVisual.personalizacaoAvancada;
    if (avancada) {
      setOrdemSecoes(avancada.ordemSecoes);
      setRodapePersonalizado(avancada.rodapePersonalizado ?? "");
      setOcultarMarca(avancada.ocultarMarcaPlataforma);
    }
  }, [estabelecimento]);

  if (carregando || !estabelecimento) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const avancadaHabilitada = featureHabilitada(estabelecimento.plano, estabelecimento.featuresDesativadas, "personalizacaoAvancada");
  const estabelecimentoAtual = estabelecimento;

  function moverSecao(indice: number, direcao: -1 | 1) {
    setOrdemSecoes((atual) => {
      const nova = [...atual];
      const alvo = indice + direcao;
      if (alvo < 0 || alvo >= nova.length) return atual;
      [nova[indice], nova[alvo]] = [nova[alvo], nova[indice]];
      return nova;
    });
  }

  function salvar() {
    estabelecimentoRepository.atualizar(tenantId, {
      identidadeVisual: {
        ...estabelecimentoAtual.identidadeVisual,
        modelo,
        corPrincipal,
        corSecundaria,
        corDestaque,
        fotos: fotos
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
        personalizacaoAvancada: avancadaHabilitada
          ? { ordemSecoes, rodapePersonalizado: rodapePersonalizado.trim() || undefined, ocultarMarcaPlataforma: ocultarMarca }
          : estabelecimentoAtual.identidadeVisual.personalizacaoAvancada,
      },
    });
    notificar("Personalização salva.", "sucesso");
    recarregar();
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">Personalização</h1>
        <p className="text-sm text-ink-soft">Aparência da página pública do seu estabelecimento.</p>
      </div>

      <Cartao>
        <CartaoCorpo className="space-y-4">
          <CartaoTitulo>Padrão (disponível em todos os planos)</CartaoTitulo>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Modelo da página pública</label>
            <div className="flex gap-2">
              {(["classico", "moderno"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModelo(m)}
                  className={`flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-semibold capitalize ${
                    modelo === m ? "border-accent bg-accent text-white" : "border-border text-ink-soft"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Cor principal</label>
              <input type="color" value={corPrincipal} onChange={(e) => setCorPrincipal(e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Cor secundária</label>
              <input type="color" value={corSecundaria} onChange={(e) => setCorSecundaria(e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Cor de destaque</label>
              <input type="color" value={corDestaque} onChange={(e) => setCorDestaque(e.target.value)} className="h-10 w-full rounded-[var(--radius-control)] border border-border" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Fotos (uma URL por linha)</label>
            <textarea
              value={fotos}
              onChange={(e) => setFotos(e.target.value)}
              rows={3}
              placeholder="https://..."
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
            <p className="mt-1 text-xs text-ink-soft">Sem upload nesta demonstração — cole o link de uma imagem já hospedada.</p>
          </div>
        </CartaoCorpo>
      </Cartao>

      <Cartao className={avancadaHabilitada ? "" : "opacity-60"}>
        <CartaoCorpo className="space-y-4">
          <div className="flex items-center justify-between">
            <CartaoTitulo>Avançada</CartaoTitulo>
            {!avancadaHabilitada && <Badge cor="aviso"><Lock size={11} className="mr-1 inline" />Plano Pro</Badge>}
          </div>
          {!avancadaHabilitada ? (
            <p className="text-sm text-ink-soft">
              Disponível no plano Pro: ordem das seções, rodapé personalizado e opção de ocultar a marca da plataforma.
            </p>
          ) : (
            <>
              <div>
                <label className="mb-2 block text-xs font-semibold text-ink-soft">Ordem das seções da página pública</label>
                <ul className="space-y-1.5">
                  {ordemSecoes.map((secao, indice) => (
                    <li key={secao} className="flex items-center justify-between rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm">
                      {ROTULO_SECAO[secao]}
                      <div className="flex gap-1">
                        <button type="button" onClick={() => moverSecao(indice, -1)} disabled={indice === 0} className="rounded p-1 text-ink-soft hover:bg-paper-muted disabled:opacity-30">
                          <ArrowUp size={14} />
                        </button>
                        <button type="button" onClick={() => moverSecao(indice, 1)} disabled={indice === ordemSecoes.length - 1} className="rounded p-1 text-ink-soft hover:bg-paper-muted disabled:opacity-30">
                          <ArrowDown size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">Rodapé personalizado</label>
                <input type="text" value={rodapePersonalizado} onChange={(e) => setRodapePersonalizado(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink" />
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={ocultarMarca} onChange={(e) => setOcultarMarca(e.target.checked)} />
                Ocultar marca da plataforma na página pública
              </label>
            </>
          )}
        </CartaoCorpo>
      </Cartao>

      <Botao onClick={salvar}>Salvar personalização</Botao>
    </div>
  );
}
