import { formatarWhatsapp } from "@/lib/format";

interface EtapaDadosClienteProps {
  nome: string;
  whatsapp: string;
  telefoneObrigatorio: boolean;
  onMudarNome: (v: string) => void;
  onMudarWhatsapp: (v: string) => void;
  erros: { nome?: string; whatsapp?: string };
}

export function EtapaDadosCliente({
  nome,
  whatsapp,
  telefoneObrigatorio,
  onMudarNome,
  onMudarWhatsapp,
  erros,
}: EtapaDadosClienteProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-ink">Seus dados</h2>

      <div>
        <label htmlFor="nome-cliente" className="mb-1 block text-sm font-medium text-ink">
          Nome completo
        </label>
        <input
          id="nome-cliente"
          type="text"
          value={nome}
          onChange={(e) => onMudarNome(e.target.value)}
          placeholder="Como podemos te chamar?"
          className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent"
          aria-invalid={Boolean(erros.nome)}
          aria-describedby={erros.nome ? "erro-nome" : undefined}
        />
        {erros.nome && (
          <p id="erro-nome" className="mt-1 text-xs text-[color:var(--color-danger)]">
            {erros.nome}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="whatsapp-cliente" className="mb-1 block text-sm font-medium text-ink">
          WhatsApp{!telefoneObrigatorio && <span className="font-normal text-ink-soft"> (opcional)</span>}
        </label>
        <input
          id="whatsapp-cliente"
          type="tel"
          inputMode="numeric"
          value={whatsapp}
          onChange={(e) => onMudarWhatsapp(formatarWhatsapp(e.target.value))}
          placeholder="(11) 99999-9999"
          className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent"
          aria-invalid={Boolean(erros.whatsapp)}
          aria-describedby={erros.whatsapp ? "erro-whatsapp" : undefined}
        />
        {erros.whatsapp && (
          <p id="erro-whatsapp" className="mt-1 text-xs text-[color:var(--color-danger)]">
            {erros.whatsapp}
          </p>
        )}
        <p className="mt-1 text-xs text-ink-soft">Usamos apenas para confirmar o seu agendamento.</p>
      </div>
    </div>
  );
}
