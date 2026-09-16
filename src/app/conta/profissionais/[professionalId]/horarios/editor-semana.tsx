"use client";

// Editor da semana de trabalho (Lote 6D.3). Sete dias sempre visíveis: dia
// sem intervalo nenhum é dia SEM ATENDIMENTO, dito com todas as letras — a
// tela nunca deixa a ausência de configuração parecer "disponível sempre".
//
// O limite de dois intervalos por dia não é escolha de UI: é o que a tabela
// real guarda (um período e uma pausa, ver
// backend/src/professionals/working-hours.ts).
import { Plus, Trash2 } from "lucide-react";
import type { IntervaloReal } from "@/lib/api/working-hours-api";
import {
  DIAS_DA_SEMANA,
  MAXIMO_DE_INTERVALOS_POR_DIA,
  type ErroDeCampo,
  type SemanaEditavel,
} from "@/lib/profissionais/horarios";
import { Botao } from "@/components/ui/button";

interface EditorSemanaProps {
  semana: SemanaEditavel;
  errosDeCampo: Record<number, ErroDeCampo[]>;
  erroDoDia: Record<number, string>;
  desabilitado: boolean;
  aoAlterar: (weekday: number, intervals: IntervaloReal[]) => void;
}

const CLASSE_HORA =
  "w-[6.5rem] rounded-[var(--radius-control)] border bg-card px-2.5 py-1.5 text-sm text-ink focus:border-accent";

export function EditorSemana({
  semana,
  errosDeCampo,
  erroDoDia,
  desabilitado,
  aoAlterar,
}: EditorSemanaProps) {
  function alterarCampo(
    weekday: number,
    indice: number,
    campo: "start" | "end",
    valor: string,
  ) {
    const intervals = (semana[weekday] ?? []).map((intervalo, i) =>
      i === indice ? { ...intervalo, [campo]: valor } : intervalo,
    );
    aoAlterar(weekday, intervals);
  }

  function adicionar(weekday: number) {
    const atuais = semana[weekday] ?? [];
    const padrao = atuais.length === 0 ? { start: "09:00", end: "12:00" } : { start: "13:00", end: "18:00" };
    aoAlterar(weekday, [...atuais, padrao]);
  }

  function remover(weekday: number, indice: number) {
    aoAlterar(
      weekday,
      (semana[weekday] ?? []).filter((_, i) => i !== indice),
    );
  }

  function erroDoCampo(weekday: number, indice: number, campo: "start" | "end"): string | null {
    const erro = (errosDeCampo[weekday] ?? []).find(
      (e) => e.intervalo === indice && e.campo === campo,
    );
    return erro?.mensagem ?? null;
  }

  return (
    <ul className="space-y-3">
      {DIAS_DA_SEMANA.map(({ weekday, nome }) => {
        const intervals = semana[weekday] ?? [];
        const naoAtende = intervals.length === 0;
        const podeAdicionar = intervals.length < MAXIMO_DE_INTERVALOS_POR_DIA;

        return (
          <li
            key={weekday}
            className="rounded-[var(--radius-control)] border border-border p-3"
            aria-labelledby={`dia-${weekday}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p id={`dia-${weekday}`} className="text-sm font-semibold text-ink">
                {nome}
              </p>
              {podeAdicionar && (
                <Botao
                  type="button"
                  variante="secundaria"
                  tamanho="sm"
                  disabled={desabilitado}
                  onClick={() => adicionar(weekday)}
                  aria-label={`Adicionar intervalo em ${nome}`}
                >
                  <Plus size={14} className="mr-1" />
                  Adicionar intervalo
                </Botao>
              )}
            </div>

            {naoAtende ? (
              <p className="mt-1.5 text-sm text-ink-soft">Não atende neste dia.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {intervals.map((intervalo, indice) => {
                  const erroInicio = erroDoCampo(weekday, indice, "start");
                  const erroFim = erroDoCampo(weekday, indice, "end");
                  return (
                    <div key={indice} className="flex flex-wrap items-start gap-2">
                      <div>
                        <label
                          htmlFor={`inicio-${weekday}-${indice}`}
                          className="mb-0.5 block text-xs text-ink-soft"
                        >
                          {`Início ${indice + 1} — ${nome}`}
                        </label>
                        <input
                          id={`inicio-${weekday}-${indice}`}
                          type="text"
                          inputMode="numeric"
                          placeholder="09:00"
                          value={intervalo.start}
                          disabled={desabilitado}
                          aria-invalid={erroInicio ? true : undefined}
                          onChange={(e) => alterarCampo(weekday, indice, "start", e.target.value)}
                          className={`${CLASSE_HORA} ${erroInicio ? "border-[color:var(--color-danger)]" : "border-border"}`}
                        />
                        {erroInicio && (
                          <p className="mt-0.5 text-xs text-[color:var(--color-danger)]">{erroInicio}</p>
                        )}
                      </div>

                      <div>
                        <label
                          htmlFor={`fim-${weekday}-${indice}`}
                          className="mb-0.5 block text-xs text-ink-soft"
                        >
                          {`Fim ${indice + 1} — ${nome}`}
                        </label>
                        <input
                          id={`fim-${weekday}-${indice}`}
                          type="text"
                          inputMode="numeric"
                          placeholder="12:00"
                          value={intervalo.end}
                          disabled={desabilitado}
                          aria-invalid={erroFim ? true : undefined}
                          onChange={(e) => alterarCampo(weekday, indice, "end", e.target.value)}
                          className={`${CLASSE_HORA} ${erroFim ? "border-[color:var(--color-danger)]" : "border-border"}`}
                        />
                        {erroFim && (
                          <p className="mt-0.5 text-xs text-[color:var(--color-danger)]">{erroFim}</p>
                        )}
                      </div>

                      <Botao
                        type="button"
                        variante="secundaria"
                        tamanho="sm"
                        className="mt-5"
                        disabled={desabilitado}
                        onClick={() => remover(weekday, indice)}
                        aria-label={`Remover intervalo ${indice + 1} de ${nome}`}
                      >
                        <Trash2 size={14} />
                      </Botao>
                    </div>
                  );
                })}
              </div>
            )}

            {erroDoDia[weekday] && (
              <p role="alert" className="mt-1.5 text-xs text-[color:var(--color-danger)]">
                {erroDoDia[weekday]}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
