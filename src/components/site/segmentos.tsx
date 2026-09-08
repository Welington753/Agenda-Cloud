import {
  Dumbbell,
  Flower2,
  GraduationCap,
  Hand,
  PawPrint,
  Scissors,
  Sparkles,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { SEGMENTOS } from "@/lib/site/conteudo-comercial";

const ICONE_POR_SEGMENTO: Record<string, LucideIcon> = {
  "salao-barbearia": Scissors,
  estetica: Sparkles,
  clinica: Stethoscope,
  terapeuta: Flower2,
  massagem: Hand,
  "pilates-yoga": Dumbbell,
  tatuagem: Sparkles,
  petshop: PawPrint,
  "professor-consultor": GraduationCap,
  outro: Sparkles,
};

export function Segmentos() {
  return (
    <section id="para-quem" className="border-y border-border bg-paper-muted/60 px-4 py-14 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-2xl font-bold text-ink sm:text-3xl">Para quem trabalha com horário marcado</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-ink-soft">
          O Agenda Cloud se adapta ao vocabulário do seu negócio — os termos da tela mudam conforme o segmento.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {SEGMENTOS.map((s) => {
            const Icone = ICONE_POR_SEGMENTO[s.id] ?? Sparkles;
            return (
              <Cartao key={s.id}>
                <CartaoCorpo className="text-center">
                  <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-accent-soft text-[color:var(--color-accent-hover)]">
                    <Icone size={18} />
                  </div>
                  <p className="font-semibold text-ink">{s.rotulo}</p>
                  <p className="mt-1 text-xs text-ink-soft">{s.exemplo}</p>
                </CartaoCorpo>
              </Cartao>
            );
          })}
        </div>
      </div>
    </section>
  );
}
