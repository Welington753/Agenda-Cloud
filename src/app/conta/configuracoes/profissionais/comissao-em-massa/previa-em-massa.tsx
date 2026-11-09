// Partes da tela de aplicação em massa que só desenham: o aviso do que não
// muda, os contadores e a lista de profissionais (prévia e resultado). Em
// celular cada profissional vira um bloco com rótulos; a partir de md, linhas
// de uma tabela.
import type { ReactNode } from "react";
import { AlertTriangle, Equal, Info, Lock, PencilLine, Users } from "lucide-react";
import type { PreviaEmMassa, ResultadoEmMassa } from "@/lib/api/comissoes-em-massa-api";
import { TEXTO_CONFIRMACAO_SUBSTITUIR, rotuloDaConfiguracao } from "@/lib/profissionais/comissao-em-massa";
import { Badge } from "@/components/ui/badge-base";
import { EstatisticaCard } from "@/components/ui/estatistica-card";

const ICONE_RESULTADO: Record<ResultadoEmMassa, typeof PencilLine> = { CHANGE: PencilLine, PRESERVE: Lock, UNCHANGED: Equal };

export function AvisoDoQueNaoMuda() {
  return (
    <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-border bg-paper-muted p-3 text-sm text-ink" data-testid="aviso-o-que-nao-muda">
      <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>
        <strong>Exceções por serviço</strong> e <strong>comissões já apuradas</strong> não são afetadas: a exceção de um serviço continua
        valendo no lugar da regra geral, e a regra nova vale só para os próximos atendimentos concluídos.
      </span>
    </p>
  );
}

export function Contadores({ dados, rotuloAlterados }: { dados: PreviaEmMassa; rotuloAlterados: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="contadores-em-massa">
      <EstatisticaCard icone={PencilLine} rotulo={rotuloAlterados} valor={String(dados.summary.change)} testId="contador-alterados" />
      <EstatisticaCard icone={Lock} rotulo="Preservados" valor={String(dados.summary.preserve)} corIcone="neutro" testId="contador-preservados" />
      <EstatisticaCard icone={Equal} rotulo="Sem mudança" valor={String(dados.summary.unchanged)} corIcone="neutro" testId="contador-sem-mudanca" />
    </div>
  );
}

export function ListaDeProfissionais({
  dados,
  rotulos,
  titulo,
}: {
  dados: PreviaEmMassa;
  rotulos: Record<ResultadoEmMassa, string>;
  titulo: string;
}) {
  if (dados.professionals.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-soft">
        <Users size={16} aria-hidden="true" />
        Nenhum profissional ativo no alcance.
      </p>
    );
  }
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-card">
      <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 border-b border-border px-4 py-2 text-xs font-medium text-ink-soft md:grid" aria-hidden="true">
        <span>Profissional</span>
        <span>Comissão atual</span>
        <span>Nova comissão</span>
        <span>Resultado</span>
      </div>
      <ul aria-label={titulo} data-testid="profissionais-em-massa" className="divide-y divide-border">
        {dados.professionals.map((p) => {
          const Icone = ICONE_RESULTADO[p.outcome];
          return (
            <li
              key={p.professional.id}
              className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-3"
              data-testid="profissional-em-massa"
              aria-label={p.professional.name}
            >
              <span className="font-semibold break-words text-ink">{p.professional.name}</span>
              <Campo rotulo="Comissão atual">{rotuloDaConfiguracao(p.current)}</Campo>
              <Campo rotulo="Nova comissão">{rotuloDaConfiguracao(p.next)}</Campo>
              <span>
                <Badge cor={p.outcome === "CHANGE" ? "destaque" : "neutro"} data-testid="resultado-do-profissional">
                  <Icone size={12} aria-hidden="true" className="mr-1 inline" />
                  {rotulos[p.outcome]}
                </Badge>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <span className="text-ink">
      <span className="text-xs text-ink-soft md:sr-only">{rotulo}: </span>
      {children}
    </span>
  );
}

/** SUBSTITUIR: explica o que muda e exige a confirmação explícita. */
export function ConfirmacaoDeSubstituicao({ confirmado, aoMudar }: { confirmado: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <div className="space-y-3 rounded-[var(--radius-control)] border border-border bg-warning-soft p-3" data-testid="aviso-substituicao">
      <p className="flex items-start gap-2 text-sm text-ink">
        <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--color-warning)]" />
        <span>
          <strong>Substituir</strong>: as configurações gerais individuais destes profissionais serão trocadas por esta regra, e
          “Recebe comissão” será ligado para todos eles, inclusive para quem estava desligado.
        </span>
      </p>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm font-medium text-ink">
        <input
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
          checked={confirmado}
          onChange={(e) => aoMudar(e.currentTarget.checked)}
          data-testid="confirmar-substituicao"
        />
        {TEXTO_CONFIRMACAO_SUBSTITUIR}
      </label>
    </div>
  );
}
