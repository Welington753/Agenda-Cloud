"use client";

// Etapas 2 e 3 da conferência: revisar as diferenças (com "Recontar" por
// item) e confirmar os ajustes, mostrando o saldo antes e depois. Só
// desenham: o rascunho, a revisão e o envio ficam na página.
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Package, Pencil } from "lucide-react";
import type { LinhaDaRevisao } from "@/lib/estoque/conferencia";
import { contar, corDaDiferenca } from "@/lib/estoque/apresentacao";
import { formatarDiferenca, formatarQuantidade, type UnidadeEstoque } from "@/lib/estoque/quantidade";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { CLASSE_AJUDA, CLASSE_CAMPO, CLASSE_ERRO_CAMPO, ErroDoFormulario, NotaInformativa, RotuloNoCelular, TABELA } from "@/components/estoque/comum";

export const SEM_ALTERACAO = "Nenhum saldo será alterado antes da confirmação.";
interface Resumo {
  contados: number;
  comDiferenca: number;
  semDiferenca: number;
}

const COR_DIFERENCA = {
  aviso: "bg-warning-soft text-[color:var(--color-warning)]",
  sucesso: "bg-success-soft text-[color:var(--color-success)]",
  neutro: "bg-paper-muted text-ink-soft",
} as const;

function Diferenca({ milli, unit }: { milli: number; unit: UnidadeEstoque }) {
  return (
    <span className={clsx("inline-flex rounded-[var(--radius-control)] px-2.5 py-1 text-sm font-semibold tabular-nums", COR_DIFERENCA[corDaDiferenca(milli)])}>
      {formatarDiferenca(milli, unit)}
    </span>
  );
}

export function RevisaoDasDiferencas({
  linhas,
  resumo,
  caminhos,
  nota,
  setNota,
  erroNota,
  ajustes,
  aoRecontar,
  aoContinuar,
}: {
  linhas: readonly LinhaDaRevisao[];
  resumo: Resumo;
  caminhos: ReadonlyMap<string, string>;
  nota: string;
  setNota: (v: string) => void;
  /** Motivo ausente ou curto, mostrado ao tentar continuar. */
  erroNota: string | null;
  ajustes: string;
  aoRecontar: (productId?: string) => void;
  aoContinuar: () => void;
}) {
  return (
    <>
      <Cartao>
        <CartaoCorpo className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" data-testid="resumo-revisao">
          <span className="flex items-center gap-2 font-semibold text-ink">
            <Package size={18} className="text-ink-soft" aria-hidden="true" /> {contar(resumo.contados, "produto contado", "produtos contados")}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-warning-soft px-3 py-1 font-semibold text-[color:var(--color-warning)]">
            <AlertTriangle size={16} aria-hidden="true" /> {resumo.comDiferenca} com diferença
          </span>
          <span className="flex items-center gap-2 text-ink-soft">
            <CheckCircle2 size={16} aria-hidden="true" /> {resumo.semDiferenca} sem diferença
          </span>
        </CartaoCorpo>
      </Cartao>

      <Cartao data-testid="revisao">
        <div className="space-y-1 p-4 sm:p-5">
          <h2 className="text-lg font-semibold text-ink">Revise as diferenças</h2>
          <p className="text-sm text-ink-soft">Confira cada item antes de continuar.</p>
        </div>
        <table className={TABELA.tabela} aria-label="Diferenças da conferência">
          <thead className={TABELA.cabecalho}>
            <tr>
              <th scope="col" className={TABELA.th}>Produto</th>
              <th scope="col" className={`${TABELA.th} text-right`}>Saldo registrado</th>
              <th scope="col" className={`${TABELA.th} text-right`}>Contagem física</th>
              <th scope="col" className={`${TABELA.th} text-right`}>Diferença</th>
              <th scope="col" className={TABELA.th}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className={TABELA.corpo}>
            {linhas.map((l) => (
              <tr key={l.productId} className={TABELA.linha}>
                <td className={clsx(TABELA.td, "min-w-0")}>
                  <p className="font-semibold text-ink">{l.nome}</p>
                  {caminhos.get(l.productId) && <p className="text-xs text-ink-soft">{caminhos.get(l.productId)}</p>}
                </td>
                <td className={clsx(TABELA.td, "tabular-nums text-ink md:text-right max-md:col-start-1")}>
                  <RotuloNoCelular>Registrado</RotuloNoCelular>
                  {formatarQuantidade(l.esperadoMilli, l.unit)}
                </td>
                <td className={clsx(TABELA.td, "tabular-nums text-ink md:text-right max-md:col-start-1")}>
                  <RotuloNoCelular>Contado</RotuloNoCelular>
                  {formatarQuantidade(l.contadoMilli, l.unit)}
                </td>
                <td className={clsx(TABELA.td, "text-right max-md:col-start-2 max-md:row-start-1")}>
                  <Diferenca milli={l.diferencaMilli} unit={l.unit} />
                </td>
                <td className={clsx(TABELA.td, "text-right max-md:col-start-2 max-md:row-start-2 max-md:row-span-2 max-md:self-center")}>
                  <Botao variante="fantasma" tamanho="sm" onClick={() => aoRecontar(l.productId)} aria-label={`Recontar ${l.nome}`}>
                    <Pencil size={14} aria-hidden="true" /> Recontar
                  </Botao>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-3 border-t border-border p-4 sm:p-5">
          <div>
            <label htmlFor="conf-nota" className="block text-sm font-medium text-ink">
              {resumo.comDiferenca > 0 ? "Motivo dos ajustes" : "Observação (opcional)"}
            </label>
            <textarea
              id="conf-nota"
              rows={2}
              className={`${CLASSE_CAMPO} mt-1.5`}
              maxLength={300}
              value={nota}
              required={resumo.comDiferenca > 0}
              aria-invalid={erroNota ? true : undefined}
              aria-describedby={erroNota ? "conf-nota-erro" : "conf-nota-ajuda"}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ex.: conferência física de fechamento"
            />
            {erroNota ? (
              <p id="conf-nota-erro" className={CLASSE_ERRO_CAMPO} role="alert">
                {erroNota}
              </p>
            ) : (
              <p id="conf-nota-ajuda" className={CLASSE_AJUDA}>
                {resumo.comDiferenca > 0 ? "Obrigatório: fica registrado em cada ajuste do histórico." : "Opcional quando nenhum saldo muda."}
              </p>
            )}
          </div>
          <NotaInformativa destaque>
            {resumo.comDiferenca > 0 ? (
              <>
                Ao confirmar, serão registradas <strong>{ajustes}</strong>.
              </>
            ) : (
              "Nenhum item tem diferença: a conferência fica registrada sem alterar saldos."
            )}
          </NotaInformativa>
        </div>
      </Cartao>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Botao variante="secundaria" onClick={() => aoRecontar()}>
          Voltar à contagem
        </Botao>
        <p className="text-sm text-ink-soft max-sm:order-last max-sm:w-full">{SEM_ALTERACAO}</p>
        <Botao onClick={() => aoContinuar()}>Continuar</Botao>
      </div>
    </>
  );
}

export function ConfirmacaoDosAjustes({
  resumo,
  comDiferenca,
  nota,
  ajustes,
  erro,
  enviando,
  aoVoltar,
  aoConfirmar,
}: {
  resumo: Resumo;
  comDiferenca: readonly LinhaDaRevisao[];
  nota: string;
  ajustes: string;
  erro: string | null;
  enviando: boolean;
  aoVoltar: () => void;
  aoConfirmar: () => void;
}) {
  return (
    <>
      <Cartao data-testid="confirmacao">
        <div className="space-y-1 p-4 sm:p-5">
          <h2 className="text-lg font-semibold text-ink">Confirme os ajustes</h2>
          <p className="text-sm text-ink-soft">
            {contar(resumo.contados, "produto contado", "produtos contados")} · {contar(resumo.comDiferenca, "saldo será alterado", "saldos serão alterados")}
          </p>
        </div>
        {comDiferenca.length > 0 ? (
          <table className={TABELA.tabela} aria-label="Saldos que serão alterados">
            <thead className={TABELA.cabecalho}>
              <tr>
                <th scope="col" className={TABELA.th}>Produto</th>
                <th scope="col" className={`${TABELA.th} text-right`}>Saldo antes</th>
                <th scope="col" className={`${TABELA.th} text-right`}>Saldo depois</th>
                <th scope="col" className={`${TABELA.th} text-right`}>Ajuste</th>
              </tr>
            </thead>
            <tbody className={TABELA.corpo}>
              {comDiferenca.map((l) => (
                <tr key={l.productId} className={TABELA.linha} data-testid={`ajuste-${l.productId}`}>
                  <td className={clsx(TABELA.td, "min-w-0 font-semibold text-ink")}>{l.nome}</td>
                  <td className={clsx(TABELA.td, "tabular-nums text-ink-soft md:text-right max-md:col-start-1")}>
                    <RotuloNoCelular>Antes</RotuloNoCelular>
                    {formatarQuantidade(l.esperadoMilli, l.unit)}
                  </td>
                  <td className={clsx(TABELA.td, "tabular-nums font-semibold text-ink md:text-right max-md:col-start-1")}>
                    <RotuloNoCelular>Depois</RotuloNoCelular>
                    {formatarQuantidade(l.contadoMilli, l.unit)}
                  </td>
                  <td className={clsx(TABELA.td, "text-right max-md:col-start-2 max-md:row-start-1")}>
                    <span className="sr-only">
                      {formatarQuantidade(l.esperadoMilli, l.unit)} → {formatarQuantidade(l.contadoMilli, l.unit)}{" "}
                    </span>
                    <Diferenca milli={l.diferencaMilli} unit={l.unit} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 pb-4 text-sm text-ink-soft sm:px-5">Nenhum saldo será alterado.</p>
        )}
        <div className="space-y-3 border-t border-border p-4 sm:p-5">
          {nota.trim() && (
            <p className="text-sm text-ink">
              <span className="font-medium">Motivo:</span> {nota.trim()}
            </p>
          )}
          <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warning-soft px-3 py-2.5 text-sm text-ink" role="note">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[color:var(--color-warning)]" aria-hidden="true" />
            <span>
              {resumo.comDiferenca > 0
                ? `Ao confirmar, os saldos acima mudam na hora e ${ajustes} ${resumo.comDiferenca === 1 ? "fica" : "ficam"} no histórico. Ajuste de conferência não pode ser estornado: para corrigir, faça uma nova conferência.`
                : "Ao confirmar, a conferência fica registrada no histórico sem alterar saldos."}
            </span>
          </p>
          <ErroDoFormulario mensagem={erro} />
        </div>
      </Cartao>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Botao variante="secundaria" onClick={() => aoVoltar()} disabled={enviando}>
          Voltar à revisão
        </Botao>
        <Botao onClick={() => aoConfirmar()} disabled={enviando}>
          {enviando ? "Confirmando…" : "Confirmar ajustes"}
        </Botao>
      </div>
    </>
  );
}
