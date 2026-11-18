"use client";

// Aba "Histórico" da ficha: versões da assinatura modular (append-only), com
// valores, datas, motivo e quem registrou.
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoLeitura } from "./estado-leitura";
import { ehVisaoAssinatura, type VisaoAssinatura } from "@/lib/administracao/assinatura";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { reais } from "@/lib/administracao/validade";

/** Aba "Histórico": versões da assinatura (append-only), com valores,
 * datas, motivo e quem registrou. */
export function HistoricoDaAssinatura({ tenantId }: { tenantId: string }) {
  const leitura = useLeituraPlataforma(
    `/platform/establishments/${encodeURIComponent(tenantId)}/subscription`,
    ehVisaoAssinatura,
  );
  if (leitura.estado.status !== "pronto") return <EstadoLeitura estado={leitura.estado} recarregar={leitura.recarregar} />;
  const visao = leitura.estado.dados;
  if (!visao.history.length) {
    return (
      <Cartao>
        <CartaoCorpo>
          <p className="text-sm text-ink-soft">
            Sem versões de assinatura modular. O estabelecimento segue no plano {visao.plan.name}.
          </p>
        </CartaoCorpo>
      </Cartao>
    );
  }
  return <Historico visao={visao} />;
}

function Historico({ visao }: { visao: VisaoAssinatura }) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-3">
        <h2 className="font-semibold">Histórico da assinatura</h2>
        <ol className="space-y-3" data-testid="historico-assinatura">
          {visao.history.map((v) => (
            <li key={v.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">
                Versão {v.version} · desde {new Date(v.effectiveAt).toLocaleString("pt-BR")}
              </p>
              <p>
                {visao.catalog.essential.name}{v.items.length ? ` + ${v.items.map((i) => i.name).join(", ")}` : ""} ·{" "}
                {reais(v.contractedTotalCents)}/mês
                {v.negotiated ? ` (catálogo ${reais(v.catalogTotalCents)}; motivo: ${v.reason ?? "—"})` : ""} · limite{" "}
                {v.teamUserLimit}
              </p>
              <p className="text-xs text-ink-soft">Registrado por {v.recordedBy}</p>
            </li>
          ))}
        </ol>
      </CartaoCorpo>
    </Cartao>
  );
}
