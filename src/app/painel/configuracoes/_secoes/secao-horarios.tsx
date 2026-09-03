import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import type { DiaSemana } from "@/lib/types";
import type { EstadoConfiguracoes } from "../page";
import { Campo } from "./campo";

const DIAS: { valor: DiaSemana; rotulo: string }[] = [
  { valor: 0, rotulo: "Dom" },
  { valor: 1, rotulo: "Seg" },
  { valor: 2, rotulo: "Ter" },
  { valor: 3, rotulo: "Qua" },
  { valor: 4, rotulo: "Qui" },
  { valor: 5, rotulo: "Sex" },
  { valor: 6, rotulo: "Sáb" },
];

interface SecaoHorariosProps {
  form: Pick<EstadoConfiguracoes, "diasFuncionamento" | "abertura" | "fechamento">;
  alternarDia: (dia: DiaSemana) => void;
  setForm: (atualizar: (f: EstadoConfiguracoes) => EstadoConfiguracoes) => void;
}

export function SecaoHorarios({ form, alternarDia, setForm }: SecaoHorariosProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <CartaoTitulo>Horários gerais</CartaoTitulo>
        <div className="flex flex-wrap gap-1.5">
          {DIAS.map((d) => (
            <button
              key={d.valor}
              type="button"
              onClick={() => alternarDia(d.valor)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                form.diasFuncionamento.includes(d.valor) ? "border-accent bg-accent text-white" : "border-border text-ink-soft"
              }`}
            >
              {d.rotulo}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Abertura">
            <input
              type="time"
              value={form.abertura}
              onChange={(e) => setForm((f) => ({ ...f, abertura: e.target.value }))}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo rotulo="Fechamento">
            <input
              type="time"
              value={form.fechamento}
              onChange={(e) => setForm((f) => ({ ...f, fechamento: e.target.value }))}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </Campo>
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
