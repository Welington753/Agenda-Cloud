"use client";

// Campos de código do segundo fator: largura total, altura mínima de toque,
// teclado numérico no celular e colar permitido (espaços, hífens e texto em
// volta saem ao colar). Nada é guardado fora do estado do formulário.
import { limparCodigoDeRecuperacao, limparCodigoDoAplicativo } from "@/lib/administracao/segundo-fator";

const CLASSE =
  "mt-1 min-h-12 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-center text-xl tracking-[0.2em] tabular-nums";

export function CampoCodigoDoAplicativo({
  valor,
  aoMudar,
  rotulo = "Código de 6 dígitos do aplicativo",
  autoFocus = false,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  rotulo?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-ink">
      {rotulo}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={12}
        autoFocus={autoFocus}
        value={valor}
        onChange={(e) => aoMudar(limparCodigoDoAplicativo(e.target.value))}
        className={CLASSE}
        data-testid="campo-codigo-aplicativo"
      />
    </label>
  );
}

export function CampoCodigoDeRecuperacao({ valor, aoMudar }: { valor: string; aoMudar: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium text-ink">
      Código de recuperação
      <input
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={40}
        value={valor}
        onChange={(e) => aoMudar(limparCodigoDeRecuperacao(e.target.value))}
        className={`${CLASSE} text-base tracking-wider`}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        data-testid="campo-codigo-recuperacao"
      />
    </label>
  );
}

export function CampoSenha({ valor, aoMudar }: { valor: string; aoMudar: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium text-ink">
      Sua senha
      <input
        type="password"
        autoComplete="current-password"
        required
        minLength={10}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm"
        data-testid="campo-senha-segundo-fator"
      />
    </label>
  );
}

export function Erro({ texto }: { texto: string }) {
  if (!texto) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {texto}
    </p>
  );
}
