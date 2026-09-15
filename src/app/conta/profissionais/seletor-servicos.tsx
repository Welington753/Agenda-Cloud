"use client";

// Seletor de serviços realizados por um profissional (Lote 6D.2). Usado
// tanto no cadastro (conjunto vazio de vínculos existentes) quanto na
// edição — a única regra que muda por causa disso é QUAIS serviços inativos
// ficam desabilitados: um serviço inativo que nunca esteve vinculado a este
// profissional não pode virar vínculo novo (mesma regra do servidor, ver
// professionals.service.ts, `validateEligibleServiceIds`); um que já estava
// vinculado antes de ficar inativo continua marcável/desmarcável — desmarcar
// remove o vínculo (sempre permitido), marcar de novo só "recria" o mesmo
// vínculo que nunca foi de fato removido no servidor.
import type { ServicoReal } from "@/lib/api/services-api";

interface SeletorServicosProps {
  servicos: ServicoReal[];
  /** Serviços já vinculados a este profissional ANTES desta edição — vazio
   * no cadastro. Decide quais inativos continuam selecionáveis. */
  vinculadosOriginalmente: ReadonlySet<string>;
  selecionados: ReadonlySet<string>;
  aoAlternar: (serviceId: string) => void;
  desabilitado?: boolean;
}

export function SeletorServicos({
  servicos,
  vinculadosOriginalmente,
  selecionados,
  aoAlternar,
  desabilitado,
}: SeletorServicosProps) {
  if (servicos.length === 0) return null;

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium text-ink">Serviços realizados</legend>
      <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-[var(--radius-control)] border border-border p-2">
        {servicos.map((servico) => {
          const podeSelecionar = servico.active || vinculadosOriginalmente.has(servico.id);
          return (
            <label
              key={servico.id}
              className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm ${
                podeSelecionar ? "text-ink" : "text-ink-soft opacity-60"
              }`}
            >
              <input
                type="checkbox"
                checked={selecionados.has(servico.id)}
                disabled={desabilitado || !podeSelecionar}
                onChange={() => aoAlternar(servico.id)}
              />
              <span className="min-w-0 truncate">{servico.name}</span>
              {!servico.active && (
                <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                  Inativo
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
