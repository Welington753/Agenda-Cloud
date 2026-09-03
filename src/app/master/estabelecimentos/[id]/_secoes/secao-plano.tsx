import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Botao } from "@/components/ui/button";
import { DEFINICOES_PLANO, FEATURES_AINDA_NAO_IMPLEMENTADAS, ROTULO_FEATURE, type DefinicaoPlano } from "@/lib/planos";
import type { CodigoPlano, Feature } from "@/lib/types";

interface SecaoPlanoProps {
  plano: CodigoPlano;
  featuresDesativadas: Feature[];
  maxProfissionais: number;
  maxUnidades: number;
  definicaoPlanoAtual: DefinicaoPlano;
  aoEscolherPlano: (codigo: CodigoPlano) => void;
  alternarFeature: (feature: Feature) => void;
  setMaxProfissionais: (valor: number) => void;
  setMaxUnidades: (valor: number) => void;
  salvarPlano: () => void;
}

export function SecaoPlano({
  plano,
  featuresDesativadas,
  maxProfissionais,
  maxUnidades,
  definicaoPlanoAtual,
  aoEscolherPlano,
  alternarFeature,
  setMaxProfissionais,
  setMaxUnidades,
  salvarPlano,
}: SecaoPlanoProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <CartaoTitulo>Plano e funcionalidades</CartaoTitulo>
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.values(DEFINICOES_PLANO).map((p) => (
            <button
              key={p.codigo}
              type="button"
              onClick={() => aoEscolherPlano(p.codigo)}
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
  );
}
