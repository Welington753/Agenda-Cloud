// Aviso compacto das entradas (login, portal, recuperação de senha) enquanto
// a primeira leitura acorda a API. Os demais estados da conexão continuam
// com a faixa comum (FaixaConexao). Quem usa bloqueia o envio por conta
// própria: o aviso só informa.
import { Loader2 } from "lucide-react";

export function AvisoPreparandoAcesso() {
  return (
    <div
      role="status"
      data-testid="faixa-conexao-acordando"
      className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-border bg-paper-muted px-3 py-2.5 text-sm text-ink"
    >
      <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-ink-soft" aria-hidden="true" />
      <p>
        <span className="block font-medium">Preparando seu acesso…</span>
        <span className="block text-ink-soft">Pode levar cerca de 1 min.</span>
        <span className="block text-ink-soft">Continuamos automaticamente.</span>
      </p>
    </div>
  );
}
