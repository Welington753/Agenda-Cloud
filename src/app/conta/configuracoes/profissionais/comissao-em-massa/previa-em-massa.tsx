// Partes da tela de aplicação em massa que só desenham: o aviso do que não
// muda, os contadores e a lista de profissionais (prévia e resultado). Em
// celular cada profissional vira um bloco com rótulos; a partir de md, linhas
// de uma tabela.
import type { ReactNode } from "react";
import { AlertTriangle, Equal, Eraser, Info, Lock, PencilLine, Users } from "lucide-react";
import type { PreviaEmMassa, ResultadoEmMassa } from "@/lib/api/comissoes-em-massa-api";
import { TEXTO_CONFIRMACAO_SUBSTITUIR, rotuloDaConfiguracao } from "@/lib/profissionais/comissao-em-massa";
import {
  descreverExcecoes,
  quantasExcecoes,
  remocoesDaPrevia,
  rotuloDasExcecoesNaPrevia,
  textoConfirmacaoRemocaoEmMassa,
} from "@/lib/profissionais/excecoes-de-comissao";
import { ConfirmacaoDeRemocao } from "@/components/conta/escolha-de-excecoes";
import { Badge } from "@/components/ui/badge-base";
import { EstatisticaCard } from "@/components/ui/estatistica-card";

const ICONE_RESULTADO: Record<ResultadoEmMassa, typeof PencilLine> = { CHANGE: PencilLine, PRESERVE: Lock, UNCHANGED: Equal };

export function AvisoDoQueNaoMuda() {
  return (
    <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-border bg-paper-muted p-3 text-sm text-ink" data-testid="aviso-o-que-nao-muda">
      <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>
        <strong>Comissões já apuradas</strong> não são afetadas: a regra nova vale só para os próximos atendimentos concluídos.{" "}
        <strong>Exceções por serviço</strong> continuam valendo no lugar da regra geral, a não ser que, ao substituir, você escolha
        removê-las.
      </span>
    </p>
  );
}

export function Contadores({ dados, rotuloAlterados }: { dados: PreviaEmMassa; rotuloAlterados: string }) {
  return (
    <div className={dados.exceptions === "REMOVE" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-4" : "grid gap-3 sm:grid-cols-3"} data-testid="contadores-em-massa">
      <EstatisticaCard icone={PencilLine} rotulo={rotuloAlterados} valor={String(dados.summary.change)} testId="contador-alterados" />
      <EstatisticaCard icone={Lock} rotulo="Preservados" valor={String(dados.summary.preserve)} corIcone="neutro" testId="contador-preservados" />
      <EstatisticaCard icone={Equal} rotulo="Sem mudança" valor={String(dados.summary.unchanged)} corIcone="neutro" testId="contador-sem-mudanca" />
      {dados.exceptions === "REMOVE" && (
        <EstatisticaCard
          icone={Eraser}
          rotulo="Exceções removidas"
          valor={String(dados.summary.exceptionsRemoved)}
          corIcone="neutro"
          testId="contador-excecoes-removidas"
        />
      )}
    </div>
  );
}

export function ListaDeProfissionais({
  dados,
  rotulos,
  titulo,
  aplicado,
}: {
  dados: PreviaEmMassa;
  rotulos: Record<ResultadoEmMassa, string>;
  titulo: string;
  /** Resultado já gravado ("removidas") ou prévia ("serão removidas"). */
  aplicado: boolean;
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
          const excecoes = rotuloDasExcecoesNaPrevia(p.exceptions, aplicado);
          return (
            <li
              key={p.professional.id}
              className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-3"
              data-testid="profissional-em-massa"
              aria-label={p.professional.name}
            >
              <span className="min-w-0">
                <span className="block font-semibold break-words text-ink">{p.professional.name}</span>
                {excecoes && (
                  <span
                    className={p.exceptions.removed ? "block text-xs break-words text-danger" : "block text-xs break-words text-ink-soft"}
                    data-testid="excecoes-do-profissional"
                  >
                    {excecoes}
                  </span>
                )}
              </span>
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
export function ConfirmacaoDeSubstituicao({
  removendo,
  confirmado,
  aoMudar,
}: {
  removendo: boolean;
  confirmado: boolean;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3 rounded-[var(--radius-control)] border border-border bg-warning-soft p-3" data-testid="aviso-substituicao">
      <p className="flex items-start gap-2 text-sm text-ink">
        <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--color-warning)]" />
        <span>
          <strong>Substituir</strong>: as configurações gerais individuais destes profissionais serão trocadas por esta regra, e
          “Recebe comissão” será ligado para todos eles, inclusive para quem estava desligado.{" "}
          {removendo
            ? "As exceções por serviço listadas abaixo também serão removidas."
            : "As exceções por serviço continuam valendo: substituir sozinho não remove exceções."}
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

/** SUBSTITUIR removendo exceções: quem perde quais exceções, e a segunda
 * confirmação. Sem exceção a remover, só avisa. */
export function RemocaoNaPrevia({
  dados,
  confirmado,
  aoMudar,
}: {
  dados: PreviaEmMassa;
  confirmado: boolean;
  aoMudar: (v: boolean) => void;
}) {
  const remocoes = remocoesDaPrevia(dados);
  if (remocoes.length === 0) {
    return (
      <p className="flex items-start gap-2 text-sm text-ink-soft" data-testid="aviso-remocao-excecoes">
        <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        Nenhum profissional alterado tem exceção por serviço: nada será removido.
      </p>
    );
  }
  const n = dados.summary.exceptionsRemoved;
  return (
    <ConfirmacaoDeRemocao
      titulo={`${quantasExcecoes(n)} por serviço de ${remocoes.length === 1 ? "1 profissional" : `${remocoes.length} profissionais`} ${
        n === 1 ? "será removida" : "serão removidas"
      }`}
      texto={textoConfirmacaoRemocaoEmMassa(n, remocoes.length)}
      confirmado={confirmado}
      aoMudar={aoMudar}
    >
      <ul className="list-disc space-y-1 pl-5" data-testid="excecoes-a-remover">
        {remocoes.map((r) => (
          <li key={r.id} className="break-words">
            <strong>{r.nome}</strong>: {descreverExcecoes(r.excecoes)}
          </li>
        ))}
      </ul>
    </ConfirmacaoDeRemocao>
  );
}
