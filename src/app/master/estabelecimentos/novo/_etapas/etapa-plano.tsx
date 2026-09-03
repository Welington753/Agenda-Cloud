import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DEFINICOES_PLANO, FEATURES_AINDA_NAO_IMPLEMENTADAS, ROTULO_FEATURE, type DefinicaoPlano } from "@/lib/planos";
import type { CodigoPlano, Feature } from "@/lib/types";
import type { EstadoFormulario } from "../page";
import { Campo, campoClasse } from "./campo";

interface EtapaPlanoProps {
  form: Pick<EstadoFormulario, "plano" | "maxProfissionais" | "maxUnidades" | "featuresDesativadas">;
  definicaoPlano: DefinicaoPlano;
  aoMudarPlano: (plano: CodigoPlano) => void;
  atualizar: <K extends keyof EstadoFormulario>(campo: K, valor: EstadoFormulario[K]) => void;
  alternarFeature: (feature: Feature) => void;
}

export function EtapaPlano({ form, definicaoPlano, aoMudarPlano, atualizar, alternarFeature }: EtapaPlanoProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <CartaoTitulo>Plano e funcionalidades</CartaoTitulo>
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.values(DEFINICOES_PLANO).map((p) => (
            <button
              key={p.codigo}
              type="button"
              onClick={() => aoMudarPlano(p.codigo)}
              className={`rounded-[var(--radius-card)] border p-3 text-left transition-colors ${
                form.plano === p.codigo ? "border-accent bg-accent-soft/30" : "border-border hover:border-accent"
              }`}
            >
              <p className="font-semibold text-ink">{p.nome}</p>
              <p className="mt-1 text-xs text-ink-soft">{p.descricaoCurta}</p>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Máx. de profissionais">
            <input
              type="number"
              min={1}
              value={form.maxProfissionais}
              onChange={(e) => atualizar("maxProfissionais", Number(e.target.value))}
              className={campoClasse}
            />
          </Campo>
          <Campo rotulo="Máx. de unidades">
            <input
              type="number"
              min={1}
              value={form.maxUnidades}
              onChange={(e) => atualizar("maxUnidades", Number(e.target.value))}
              className={campoClasse}
            />
          </Campo>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-ink-soft">
            Funcionalidades do plano {definicaoPlano.nome} (desmarque para desativar por exceção)
          </p>
          <div className="space-y-1.5">
            {definicaoPlano.features.map((feature) => {
              const indisponivel = FEATURES_AINDA_NAO_IMPLEMENTADAS.includes(feature);
              const ativada = !form.featuresDesativadas.includes(feature);
              return (
                <label key={feature} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={ativada} onChange={() => alternarFeature(feature)} />
                  {ROTULO_FEATURE[feature]}
                  {indisponivel && <Badge cor="aviso">Em breve</Badge>}
                </label>
              );
            })}
          </div>
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
