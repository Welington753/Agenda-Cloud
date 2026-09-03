"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModeloClassico } from "@/components/publico/modelo-classico";
import { ModeloModerno } from "@/components/publico/modelo-moderno";
import type { ModeloPaginaPublicaProps } from "@/components/publico/tipos";

interface PainelPreVisualizacaoProps {
  estabelecimentoPreview: ModeloPaginaPublicaProps["estabelecimento"];
  terminologia: ModeloPaginaPublicaProps["terminologia"];
  agendamentoPublicoHabilitadoPreview: boolean;
  dadosPreview: { profissionais: ModeloPaginaPublicaProps["profissionais"]; servicos: ModeloPaginaPublicaProps["servicos"] } | null;
}

export function PainelPreVisualizacao({
  estabelecimentoPreview,
  terminologia,
  agendamentoPublicoHabilitadoPreview,
  dadosPreview,
}: PainelPreVisualizacaoProps) {
  const [viewport, setViewport] = useState<"celular" | "computador">("computador");
  const ModeloPreview = estabelecimentoPreview.identidadeVisual.modelo === "moderno" ? ModeloModerno : ModeloClassico;

  return (
    <div className="lg:sticky lg:top-4">
      <Cartao>
        <CartaoCorpo className="space-y-3">
          <div className="flex items-center justify-between">
            <CartaoTitulo>Pré-visualização</CartaoTitulo>
            <div className="flex gap-1 rounded-full border border-border p-0.5">
              <button
                type="button"
                aria-pressed={viewport === "celular"}
                aria-label="Pré-visualizar como celular"
                onClick={() => setViewport("celular")}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${viewport === "celular" ? "bg-accent text-white" : "text-ink-soft"}`}
              >
                <Smartphone size={13} /> Celular
              </button>
              <button
                type="button"
                aria-pressed={viewport === "computador"}
                aria-label="Pré-visualizar como computador"
                onClick={() => setViewport("computador")}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${viewport === "computador" ? "bg-accent text-white" : "text-ink-soft"}`}
              >
                <Monitor size={13} /> Computador
              </button>
            </div>
          </div>
          <p className="text-xs text-ink-soft">
            Representa a página pública com as alterações atuais. Links e botões estão desativados aqui — nada é
            salvo até você clicar em &ldquo;Salvar personalização&rdquo;.
          </p>
          {/* A prévia reaproveita os mesmos componentes da página pública real — nunca
              um segundo sistema paralelo. onClickCapture intercepta clique/Enter para
              impedir navegação de verdade saindo desta tela, sem alterar os componentes. */}
          <div
            onClickCapture={(e) => e.preventDefault()}
            className={`mx-auto overflow-hidden rounded-[var(--radius-card)] border border-border ${
              viewport === "celular" ? "max-w-[360px]" : "w-full"
            }`}
          >
            <div className="max-h-[70vh] overflow-y-auto">
              {dadosPreview ? (
                <ModeloPreview
                  slug={estabelecimentoPreview.slug}
                  estabelecimento={estabelecimentoPreview}
                  profissionais={dadosPreview.profissionais}
                  servicos={dadosPreview.servicos}
                  terminologia={terminologia}
                  agendamentoPublicoHabilitado={agendamentoPublicoHabilitadoPreview}
                />
              ) : (
                <Skeleton className="h-64 w-full" />
              )}
            </div>
          </div>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}
