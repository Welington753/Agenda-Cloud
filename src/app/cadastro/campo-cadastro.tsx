"use client";

// Campo de formulário do cadastro REAL — extraído só para manter
// `page.tsx` dentro do orçamento de linhas do lint (`quality/max-lines`) e
// para que rótulo, erro e acessibilidade sejam definidos num lugar só.
//
// Acessibilidade: `<label htmlFor>` sempre ligado ao `id` do input (é isto
// que faz `getByLabel` do Playwright e qualquer leitor de tela funcionarem),
// `aria-invalid` quando há erro e `aria-describedby` apontando para a
// mensagem do campo e/ou para a dica.
import type { InputHTMLAttributes } from "react";

interface CampoCadastroProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> {
  id: string;
  rotulo: string;
  erro?: string;
  dica?: string;
}

const CLASSE_BASE =
  "w-full rounded-[var(--radius-control)] border bg-card px-3.5 py-2.5 text-sm text-ink focus:border-accent";

export function CampoCadastro({ id, rotulo, erro, dica, ...props }: CampoCadastroProps) {
  const idErro = `${id}-erro`;
  const idDica = `${id}-dica`;
  const descritores = [erro ? idErro : null, dica ? idDica : null].filter(Boolean).join(" ");

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {rotulo}
      </label>
      <input
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descritores || undefined}
        className={`${CLASSE_BASE} ${erro ? "border-[color:var(--color-danger)]" : "border-border"}`}
        {...props}
      />
      {dica && (
        <p id={idDica} className="mt-1 text-xs text-ink-soft">
          {dica}
        </p>
      )}
      {erro && (
        <p id={idErro} className="mt-1 text-xs text-[color:var(--color-danger)]">
          {erro}
        </p>
      )}
    </div>
  );
}
