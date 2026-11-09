// Alcance da aplicação em massa: todos os profissionais ativos ou os
// escolhidos (até MAXIMO_EM_MASSA). Só desenha.
import type { AlcanceEmMassa } from "@/lib/api/comissoes-em-massa-api";
import { MAXIMO_EM_MASSA } from "@/lib/profissionais/comissao-em-massa";

const OPCAO = "flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-border p-3 text-sm text-ink";

export function EscolhaDeAlcance({
  alcance,
  aoMudarAlcance,
  ativos,
  selecionados,
  aoAlternar,
}: {
  alcance: AlcanceEmMassa;
  aoMudarAlcance: (a: AlcanceEmMassa) => void;
  ativos: readonly { id: string; name: string }[];
  selecionados: readonly string[];
  aoAlternar: (id: string, marcado: boolean) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-semibold text-ink">Profissionais</legend>
      <label className={OPCAO}>
        <input
          type="radio"
          name="alcance"
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
          checked={alcance === "ALL"}
          onChange={() => aoMudarAlcance("ALL")}
        />
        <span>
          Todos os profissionais ativos ({ativos.length})
          <span className="block text-xs text-ink-soft">Profissionais inativos ficam de fora.</span>
        </span>
      </label>
      <label className={OPCAO}>
        <input
          type="radio"
          name="alcance"
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
          checked={alcance === "SELECTED"}
          onChange={() => aoMudarAlcance("SELECTED")}
        />
        <span>Escolher profissionais</span>
      </label>
      {alcance === "SELECTED" && (
        <div className="space-y-2 pl-1" data-testid="escolha-de-profissionais">
          <p className="text-xs text-ink-soft">
            {selecionados.length} de {ativos.length} escolhidos · até {MAXIMO_EM_MASSA} por vez
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {ativos.map((p) => (
              <li key={p.id} className="min-w-0">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-border px-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-[var(--color-accent)]"
                    checked={selecionados.includes(p.id)}
                    onChange={(e) => aoAlternar(p.id, e.currentTarget.checked)}
                  />
                  <span className="min-w-0 break-words">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
