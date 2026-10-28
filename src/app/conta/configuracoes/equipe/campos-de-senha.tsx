"use client";

// Senha e confirmação que o dono escolhe para um acesso interno (Criar acesso
// e Definir nova senha), com mostrar/ocultar. A senha fica só no estado desta
// tela: nada é gravado no navegador.
import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { SENHA_MAXIMA, SENHA_MINIMA, problemaDaSenha } from "@/lib/equipe/senha-do-acesso";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

export function CamposDeSenha({
  senha,
  confirmacao,
  aoMudarSenha,
  aoMudarConfirmacao,
  prefixo,
}: {
  senha: string;
  confirmacao: string;
  aoMudarSenha: (valor: string) => void;
  aoMudarConfirmacao: (valor: string) => void;
  /** Separa os `data-testid` quando há mais de um formulário na tela. */
  prefixo: string;
}) {
  const [visivel, setVisivel] = useState(false);
  const regra = useId();
  const problema = problemaDaSenha(senha, confirmacao);
  const tipo = visivel ? "text" : "password";

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium">
          Senha
          <input
            type={tipo}
            required
            minLength={SENHA_MINIMA}
            maxLength={SENHA_MAXIMA}
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            className={CAMPO}
            value={senha}
            onChange={(e) => aoMudarSenha(e.target.value)}
            aria-describedby={regra}
            data-testid={`${prefixo}-senha`}
          />
        </label>
        <label className="min-w-0 text-sm font-medium">
          Confirmar senha
          <input
            type={tipo}
            required
            minLength={SENHA_MINIMA}
            maxLength={SENHA_MAXIMA}
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            className={CAMPO}
            value={confirmacao}
            onChange={(e) => aoMudarConfirmacao(e.target.value)}
            aria-describedby={regra}
            data-testid={`${prefixo}-confirmar-senha`}
          />
        </label>
      </div>
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm font-medium text-ink hover:bg-paper-muted"
        aria-pressed={visivel}
        onClick={() => setVisivel((v) => !v)}
        data-testid={`${prefixo}-mostrar-senha`}
      >
        {visivel ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        {visivel ? "Ocultar senha" : "Mostrar senha"}
      </button>
      <p id={regra} className="text-xs text-ink-soft" role={problema ? "alert" : undefined}>
        {problema ??
          `De ${SENHA_MINIMA} a ${SENHA_MAXIMA} caracteres. Esta é a senha da pessoa: ela entra com o login e esta senha, sem precisar trocar. Entregue pessoalmente.`}
      </p>
    </div>
  );
}
