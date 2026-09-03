import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RascunhoPersonalizacao } from "@/lib/estabelecimentos/rascunho";

const ROTULO_SECAO: Record<string, string> = {
  servicos: "Serviços",
  equipe: "Equipe",
  apresentacao: "Apresentação",
  fotos: "Fotos",
};

interface SecaoAvancadaProps {
  habilitada: boolean;
  rascunho: Pick<RascunhoPersonalizacao, "ordemSecoes" | "rodapePersonalizado" | "ocultarMarca">;
  atualizar: <K extends keyof RascunhoPersonalizacao>(campo: K, valor: RascunhoPersonalizacao[K]) => void;
  moverSecao: (indice: number, direcao: -1 | 1) => void;
}

export function SecaoAvancada({ habilitada, rascunho, atualizar, moverSecao }: SecaoAvancadaProps) {
  return (
    <Cartao className={habilitada ? "" : "opacity-60"}>
      <CartaoCorpo className="space-y-4">
        <div className="flex items-center justify-between">
          <CartaoTitulo>Avançada</CartaoTitulo>
          {!habilitada && <Badge cor="aviso"><Lock size={11} className="mr-1 inline" />Plano Pro</Badge>}
        </div>
        {!habilitada ? (
          <p className="text-sm text-ink-soft">
            Disponível no plano Pro: ordem das seções, rodapé personalizado e opção de ocultar a marca da plataforma.
          </p>
        ) : (
          <>
            <div>
              <label className="mb-2 block text-xs font-semibold text-ink-soft">Ordem das seções da página pública</label>
              <ul className="space-y-1.5">
                {rascunho.ordemSecoes.map((secao, indice) => (
                  <li key={secao} className="flex items-center justify-between rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm">
                    {ROTULO_SECAO[secao]}
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moverSecao(indice, -1)}
                        disabled={indice === 0}
                        aria-label={`Mover ${ROTULO_SECAO[secao]} para cima`}
                        className="rounded p-1 text-ink-soft hover:bg-paper-muted disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moverSecao(indice, 1)}
                        disabled={indice === rascunho.ordemSecoes.length - 1}
                        aria-label={`Mover ${ROTULO_SECAO[secao]} para baixo`}
                        className="rounded p-1 text-ink-soft hover:bg-paper-muted disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-soft">Rodapé personalizado</label>
              <input type="text" value={rascunho.rodapePersonalizado} onChange={(e) => atualizar("rodapePersonalizado", e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink" />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={rascunho.ocultarMarca} onChange={(e) => atualizar("ocultarMarca", e.target.checked)} />
              Ocultar marca da plataforma na página pública
            </label>
          </>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
