import clsx from "clsx";
import { CalendarX2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoVazio } from "@/components/ui/empty-state";

interface EtapaDataHorarioProps {
  diasCandidatos: Date[];
  dataSelecionada: Date | null;
  onSelecionarData: (data: Date) => void;
  horariosDisponiveis: Date[];
  carregandoHorarios: boolean;
  horarioSelecionado: Date | null;
  onSelecionarHorario: (hora: Date) => void;
}

const NOME_DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function EtapaDataHorario({
  diasCandidatos,
  dataSelecionada,
  onSelecionarData,
  horariosDisponiveis,
  carregandoHorarios,
  horarioSelecionado,
  onSelecionarHorario,
}: EtapaDataHorarioProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-ink">Escolha a data</h2>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {diasCandidatos.map((dia) => {
            const selecionado = dataSelecionada?.toDateString() === dia.toDateString();
            return (
              <button
                key={dia.toISOString()}
                type="button"
                onClick={() => onSelecionarData(dia)}
                aria-pressed={selecionado}
                className={clsx(
                  "flex shrink-0 flex-col items-center gap-0.5 rounded-[var(--radius-control)] border px-3.5 py-2.5 transition-colors",
                  selecionado ? "border-accent bg-accent text-white" : "border-border bg-card text-ink hover:border-accent"
                )}
              >
                <span className="text-[11px] font-medium uppercase opacity-80">{NOME_DIA_CURTO[dia.getDay()]}</span>
                <span className="text-base font-bold">{dia.getDate()}</span>
              </button>
            );
          })}
        </div>
      </div>

      {dataSelecionada && (
        <div>
          <h2 className="text-lg font-bold text-ink">Escolha o horário</h2>
          {carregandoHorarios ? (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : horariosDisponiveis.length === 0 ? (
            <div className="mt-3">
              <EstadoVazio
                icone={CalendarX2}
                titulo="Nenhum horário livre neste dia"
                descricao="Escolha outra data ou outro profissional."
              />
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {horariosDisponiveis.map((hora) => {
                const selecionado = horarioSelecionado?.getTime() === hora.getTime();
                return (
                  <button
                    key={hora.toISOString()}
                    type="button"
                    onClick={() => onSelecionarHorario(hora)}
                    aria-pressed={selecionado}
                    className={clsx(
                      "rounded-[var(--radius-control)] border px-2 py-2.5 text-sm font-semibold transition-colors",
                      selecionado ? "border-accent bg-accent text-white" : "border-border bg-card text-ink hover:border-accent"
                    )}
                  >
                    {hora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
