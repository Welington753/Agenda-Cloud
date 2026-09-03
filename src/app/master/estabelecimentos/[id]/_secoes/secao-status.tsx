import { PlayCircle } from "lucide-react";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Botao } from "@/components/ui/button";
import type { StatusEstabelecimento } from "@/lib/types";

interface SecaoStatusProps {
  status: StatusEstabelecimento;
  motivoSuspensao: string;
  setMotivoSuspensao: (valor: string) => void;
  suspender: () => void;
  reativar: () => void;
}

export function SecaoStatus({ status, motivoSuspensao, setMotivoSuspensao, suspender, reativar }: SecaoStatusProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-3">
        <CartaoTitulo>Status do estabelecimento</CartaoTitulo>
        {status === "suspenso" || status === "cancelado" ? (
          <Botao tamanho="sm" variante="secundaria" onClick={reativar}>
            <PlayCircle size={16} className="mr-1.5" /> Reativar estabelecimento
          </Botao>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={motivoSuspensao}
              onChange={(e) => setMotivoSuspensao(e.target.value)}
              placeholder="Motivo da suspensão"
              className="flex-1 rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
            <Botao tamanho="sm" variante="perigo" onClick={suspender}>
              Suspender
            </Botao>
          </div>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
