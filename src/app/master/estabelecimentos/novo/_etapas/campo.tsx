// Primitivas de UI reaproveitadas por todas as etapas do assistente de
// criação de estabelecimento.

export const campoClasse = "w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink";

export function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-ink-soft">{rotulo}</label>
      {children}
    </div>
  );
}

export function LinhaResumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-ink-soft">{rotulo}</span>
      <span className="text-right font-medium text-ink">{valor}</span>
    </div>
  );
}
