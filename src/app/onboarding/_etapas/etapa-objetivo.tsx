import { OPCOES_OBJETIVO, type ObjetivoOnboarding } from "@/lib/onboarding/onboarding";
import { GrupoOpcoes } from "./grupo-opcoes";

interface EtapaObjetivoProps {
  valor: ObjetivoOnboarding | null;
  aoEscolher: (valor: ObjetivoOnboarding) => void;
}

export function EtapaObjetivo({ valor, aoEscolher }: EtapaObjetivoProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-ink">Qual seu principal objetivo agora?</h2>
        <p className="text-sm text-ink-soft">Vamos destacar isso quando você chegar no painel.</p>
      </div>
      <GrupoOpcoes legenda="Principal objetivo" opcoes={OPCOES_OBJETIVO} valor={valor} aoEscolher={aoEscolher} />
    </div>
  );
}
