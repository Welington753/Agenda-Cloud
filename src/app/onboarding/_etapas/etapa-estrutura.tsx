import { OPCOES_ESTRUTURA, type EstruturaNegocio } from "@/lib/onboarding/onboarding";
import { GrupoOpcoes } from "./grupo-opcoes";

interface EtapaEstruturaProps {
  valor: EstruturaNegocio | null;
  aoEscolher: (valor: EstruturaNegocio) => void;
}

export function EtapaEstrutura({ valor, aoEscolher }: EtapaEstruturaProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-ink">Seu negócio tem uma unidade ou é uma rede?</h2>
        <p className="text-sm text-ink-soft">Você pode adicionar mais unidades depois, direto no painel.</p>
      </div>
      <GrupoOpcoes legenda="Estrutura do negócio" opcoes={OPCOES_ESTRUTURA} valor={valor} aoEscolher={aoEscolher} />
    </div>
  );
}
