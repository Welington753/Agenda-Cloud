// Alcance da lista e da Visão geral do portal (clientes, internos/teste,
// todos) e o selo "Interno/teste". Só desenha: a regra é do servidor
// (`tenants.is_test`), e o texto de alcance só afirma o recorte que a API
// confirmou (`alcanceConfirmado`).
//
// `segmentado` / `destacarAviso`: forma do tema "Azul e branco" (Visão geral):
// botões juntos numa barra e o alcance não confirmado num quadro de aviso. O
// comportamento, os rótulos e os `data-testid` são os mesmos.
import clsx from "clsx";
import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { ESCOPOS_DO_DIRETORIO, type EscopoDoDiretorio } from "@/lib/administracao/contratos-diretorio";
import { ESCOPOS, textoAlcance } from "@/lib/administracao/diretorio";

export function SeletorDeAlcance({
  valor,
  aoEscolher,
  segmentado = false,
}: {
  valor: EscopoDoDiretorio;
  aoEscolher: (escopo: EscopoDoDiretorio) => void;
  segmentado?: boolean;
}) {
  if (segmentado)
    return (
      <div
        role="group"
        aria-label="Alcance"
        className="inline-flex max-w-full flex-wrap gap-1 rounded-[var(--radius-card)] border border-border bg-card p-1 shadow-[var(--shadow-soft)]"
        data-testid="seletor-de-alcance"
      >
        {ESCOPOS_DO_DIRETORIO.map((escopo) => {
          const ativo = escopo === valor;
          return (
            <button
              key={escopo}
              type="button"
              aria-pressed={ativo}
              onClick={() => !ativo && aoEscolher(escopo)}
              className={clsx(
                "inline-flex min-h-10 cursor-pointer items-center rounded-[var(--radius-control)] px-4 text-sm font-medium transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                // Texto sobre o azul-claro: o azul escuro (accent-hover) mantém 4.5:1.
                ativo
                  ? "bg-accent-soft font-semibold text-[color:var(--color-accent-hover)]"
                  : "text-ink-soft hover:bg-paper-muted hover:text-ink",
              )}
            >
              {ESCOPOS[escopo].rotulo}
            </button>
          );
        })}
      </div>
    );
  return (
    <div role="group" aria-label="Alcance" className="flex flex-wrap gap-2" data-testid="seletor-de-alcance">
      {ESCOPOS_DO_DIRETORIO.map((escopo) => (
        <Botao
          key={escopo}
          variante={escopo === valor ? "primaria" : "secundaria"}
          aria-pressed={escopo === valor}
          className="min-h-11"
          onClick={() => escopo !== valor && aoEscolher(escopo)}
        >
          {ESCOPOS[escopo].rotulo}
        </Botao>
      ))}
    </div>
  );
}

export function TextoDeAlcance({
  confirmado,
  destacarAviso = false,
}: {
  confirmado: EscopoDoDiretorio | null;
  destacarAviso?: boolean;
}) {
  if (destacarAviso && !confirmado)
    return (
      <div
        className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[color:var(--color-warning)]/30 bg-warning-soft px-4 py-3 text-sm text-ink"
        data-testid="alcance-dos-numeros"
        data-alcance="nao-confirmado"
      >
        <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--color-warning)]" />
        <p>{textoAlcance(null)}</p>
      </div>
    );
  return (
    <p
      className={`text-sm ${confirmado ? "text-ink-soft" : "text-[color:var(--color-warning)]"}`}
      data-testid="alcance-dos-numeros"
      data-alcance={confirmado ?? "nao-confirmado"}
    >
      {textoAlcance(confirmado)}
    </p>
  );
}

export function SeloInternoTeste() {
  return (
    <Badge cor="aviso" data-testid="selo-interno-teste">
      Interno/teste
    </Badge>
  );
}
