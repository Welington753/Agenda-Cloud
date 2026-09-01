import { ChevronRight } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { formatarDuracao, formatarPrecoPublico } from "@/lib/format";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { Servico } from "@/lib/types";

interface EtapaServicoProps {
  servicos: Servico[];
  exibirPrecoPublico: boolean;
  terminologia: Terminologia;
  onEscolher: (servico: Servico) => void;
}

export function EtapaServico({ servicos, exibirPrecoPublico, terminologia, onEscolher }: EtapaServicoProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-ink">Escolha {terminologia.servico.artigo} {terminologia.servico.singular.toLowerCase()}</h2>
      {servicos.map((servico) => (
        <button key={servico.id} type="button" onClick={() => onEscolher(servico)} className="block w-full text-left">
          <Cartao className="transition-colors hover:border-accent">
            <CartaoCorpo className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{servico.nome}</p>
                <p className="mt-0.5 text-sm text-ink-soft">{servico.descricaoCurta}</p>
                <p className="mt-1.5 text-xs font-medium text-ink-soft">{formatarDuracao(servico.duracaoMinutos)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-bold text-accent">{formatarPrecoPublico(servico, exibirPrecoPublico)}</p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-ink-soft" />
            </CartaoCorpo>
          </Cartao>
        </button>
      ))}
    </div>
  );
}
