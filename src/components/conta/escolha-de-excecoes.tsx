// Escolha do que acontece com as exceções por serviço quando a regra geral
// muda (edição individual e aplicação em massa) e a confirmação explícita da
// remoção. Só desenha: textos e regras em src/lib/profissionais/excecoes-de-comissao.ts.
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import clsx from "clsx";
import type { EscolhaDeExcecoes } from "@/lib/api/comissoes-em-massa-api";
import { ROTULO_ESCOLHA_EXCECOES } from "@/lib/profissionais/excecoes-de-comissao";

const OPCAO = "rounded-[var(--radius-control)] border border-border text-sm text-ink";

export function EscolhaDasExcecoes({
  nome,
  escolha,
  aoEscolher,
  motivoSemRemover,
  legenda = "Exceções por serviço",
}: {
  /** `name` do grupo de rádio. */
  nome: string;
  escolha: EscolhaDeExcecoes;
  aoEscolher: (e: EscolhaDeExcecoes) => void;
  /** Com texto, "Remover" fica indisponível e o texto explica por quê. */
  motivoSemRemover?: string | null;
  legenda?: string;
}) {
  return (
    <fieldset className="space-y-2" data-testid={`escolha-excecoes-${nome}`}>
      <legend className="mb-2 text-sm font-semibold text-ink">{legenda}</legend>
      {(["KEEP", "REMOVE"] as const).map((e) => {
        const indisponivel = e === "REMOVE" && Boolean(motivoSemRemover);
        const idDescricao = `${nome}-${e}-descricao`;
        // A descrição fica fora do <label>: o nome acessível do rádio é só o
        // título, e a explicação chega por aria-describedby.
        return (
          <div
            key={e}
            className={clsx(OPCAO, escolha === e && "border-border-strong bg-paper-muted", indisponivel && "opacity-70")}
          >
            <label className={clsx("flex min-h-11 items-center gap-3 px-3 pt-2", indisponivel ? "cursor-not-allowed" : "cursor-pointer")}>
              <input
                type="radio"
                name={nome}
                value={e}
                className="size-5 shrink-0 accent-[var(--color-accent)]"
                checked={escolha === e}
                disabled={indisponivel}
                aria-describedby={idDescricao}
                onChange={() => aoEscolher(e)}
              />
              <span className="font-medium">
                {ROTULO_ESCOLHA_EXCECOES[e].titulo}
                {e === "KEEP" && " (padrão)"}
              </span>
            </label>
            <p id={idDescricao} className="pr-3 pb-3 pl-11 text-xs text-ink-soft">
              {indisponivel ? motivoSemRemover : ROTULO_ESCOLHA_EXCECOES[e].descricao}
            </p>
          </div>
        );
      })}
    </fieldset>
  );
}

/** Quais exceções saem e a caixa de confirmação explícita. */
export function ConfirmacaoDeRemocao({
  titulo,
  children,
  texto,
  confirmado,
  aoMudar,
}: {
  titulo: string;
  children: ReactNode;
  texto: string;
  confirmado: boolean;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3 rounded-[var(--radius-control)] border border-border bg-warning-soft p-3" data-testid="aviso-remocao-excecoes">
      <p className="flex items-start gap-2 text-sm font-semibold text-ink">
        <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--color-warning)]" />
        {titulo}
      </p>
      <div className="text-sm text-ink">{children}</div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm font-medium text-ink">
        <input
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
          checked={confirmado}
          onChange={(e) => aoMudar(e.currentTarget.checked)}
          data-testid="confirmar-remocao-excecoes"
        />
        {texto}
      </label>
    </div>
  );
}
