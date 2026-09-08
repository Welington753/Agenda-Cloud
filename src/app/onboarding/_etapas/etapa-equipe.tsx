import { OPCOES_QUANTIDADE_PROFISSIONAIS, type QuantidadeProfissionais } from "@/lib/onboarding/onboarding";
import { GrupoOpcoes } from "./grupo-opcoes";

interface EtapaEquipeProps {
  valor: QuantidadeProfissionais | null;
  aoEscolher: (valor: QuantidadeProfissionais) => void;
}

export function EtapaEquipe({ valor, aoEscolher }: EtapaEquipeProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-ink">Quantos profissionais atendem no seu negócio?</h2>
        <p className="text-sm text-ink-soft">Usamos isso só para sugerir o plano mais adequado na demonstração.</p>
      </div>
      <GrupoOpcoes
        legenda="Quantidade de profissionais"
        opcoes={OPCOES_QUANTIDADE_PROFISSIONAIS}
        valor={valor}
        aoEscolher={aoEscolher}
      />
    </div>
  );
}
