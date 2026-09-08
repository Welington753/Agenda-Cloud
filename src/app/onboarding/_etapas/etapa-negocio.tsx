interface EtapaNegocioProps {
  valor: string;
  aoMudar: (valor: string) => void;
}

export function EtapaNegocio({ valor, aoMudar }: EtapaNegocioProps) {
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-bold text-ink">Qual o nome do seu negócio?</h2>
      <p className="text-sm text-ink-soft">É o nome que vai aparecer na sua página pública de agendamento.</p>
      <label htmlFor="nome-negocio" className="sr-only">
        Nome do negócio
      </label>
      <input
        id="nome-negocio"
        type="text"
        autoFocus
        required
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder="Ex.: Espaço Bem Viver"
        className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3.5 py-2.5 text-base text-ink focus:border-accent"
      />
    </div>
  );
}
