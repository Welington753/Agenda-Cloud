import { ChevronRight, Users } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { Profissional } from "@/lib/types";

export const QUALQUER_PROFISSIONAL = "qualquer" as const;

interface EtapaProfissionalProps {
  profissionais: Profissional[];
  permitirQualquer: boolean;
  terminologia: Terminologia;
  onEscolher: (profissionalId: string | typeof QUALQUER_PROFISSIONAL) => void;
}

export function EtapaProfissional({ profissionais, permitirQualquer, terminologia, onEscolher }: EtapaProfissionalProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-ink">Escolha {terminologia.profissional.artigo === "a" ? "a" : "o"} {terminologia.profissional.singular.toLowerCase()}</h2>

      {permitirQualquer && (
        <button type="button" onClick={() => onEscolher(QUALQUER_PROFISSIONAL)} className="block w-full text-left">
          <Cartao className="border-dashed transition-colors hover:border-accent">
            <CartaoCorpo className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[color:var(--color-accent-hover)]">
                <Users size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">Qualquer {terminologia.profissional.singular.toLowerCase()}</p>
                <p className="text-sm text-ink-soft">Mostramos quem estiver disponível no horário escolhido.</p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-ink-soft" />
            </CartaoCorpo>
          </Cartao>
        </button>
      )}

      {profissionais.map((prof) => (
        <button key={prof.id} type="button" onClick={() => onEscolher(prof.id)} className="block w-full text-left">
          <Cartao className="transition-colors hover:border-accent">
            <CartaoCorpo className="flex items-center gap-3">
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: prof.corAvatar }}
              >
                {prof.avatarIniciais}
              </div>
              <p className="flex-1 font-semibold text-ink">{prof.nome}</p>
              <ChevronRight size={18} className="shrink-0 text-ink-soft" />
            </CartaoCorpo>
          </Cartao>
        </button>
      ))}
    </div>
  );
}
