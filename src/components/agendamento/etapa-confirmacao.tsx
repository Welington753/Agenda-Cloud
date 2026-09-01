import { Calendar, Clock, Tag, User } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { formatarDataLonga, formatarHora, formatarPrecoPublico } from "@/lib/format";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { Profissional, Servico } from "@/lib/types";

interface EtapaConfirmacaoProps {
  servico: Servico;
  profissional: Profissional;
  horario: Date;
  nome: string;
  whatsapp: string;
  exibirPrecoPublico: boolean;
  terminologia: Terminologia;
}

export function EtapaConfirmacao({
  servico,
  profissional,
  horario,
  nome,
  whatsapp,
  exibirPrecoPublico,
  terminologia,
}: EtapaConfirmacaoProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-ink">Confira e confirme</h2>
      <Cartao>
        <CartaoCorpo className="space-y-3">
          <LinhaResumo icone={Tag} rotulo={servico.nome} valor={formatarPrecoPublico(servico, exibirPrecoPublico)} />
          <LinhaResumo icone={User} rotulo={terminologia.profissional.singular} valor={profissional.nome} />
          <LinhaResumo icone={Calendar} rotulo="Data" valor={formatarDataLonga(horario)} />
          <LinhaResumo icone={Clock} rotulo="Horário" valor={formatarHora(horario)} />
        </CartaoCorpo>
      </Cartao>
      <Cartao>
        <CartaoCorpo className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Seus dados</p>
          <p className="font-medium text-ink">{nome}</p>
          <p className="text-sm text-ink-soft">{whatsapp}</p>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}

function LinhaResumo({ icone: Icone, rotulo, valor }: { icone: typeof Tag; rotulo: string; valor: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[color:var(--color-accent-hover)]">
        <Icone size={15} />
      </div>
      <div className="flex flex-1 items-center justify-between gap-2">
        <span className="text-sm text-ink-soft">{rotulo}</span>
        <span className="text-sm font-semibold text-ink">{valor}</span>
      </div>
    </div>
  );
}
