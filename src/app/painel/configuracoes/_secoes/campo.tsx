// Primitiva de UI reaproveitada por todas as seções da tela de configurações.

export function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-ink-soft">{rotulo}</label>
      {children}
    </div>
  );
}
