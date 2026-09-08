import { CATEGORIAS_NEGOCIO } from "@/lib/verticals/terminologia";
import type { CategoriaNegocio } from "@/lib/types";
import { GrupoOpcoes } from "./grupo-opcoes";

interface EtapaSegmentoProps {
  valor: CategoriaNegocio | null;
  aoEscolher: (valor: CategoriaNegocio) => void;
}

export function EtapaSegmento({ valor, aoEscolher }: EtapaSegmentoProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-ink">Qual o segmento do seu negócio?</h2>
        <p className="text-sm text-ink-soft">Isso ajusta os termos usados nas telas para o seu tipo de atendimento.</p>
      </div>
      <GrupoOpcoes legenda="Segmento do negócio" opcoes={CATEGORIAS_NEGOCIO} valor={valor} aoEscolher={aoEscolher} />
    </div>
  );
}
