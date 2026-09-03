import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { EstadoConfiguracoes } from "../page";
import { Campo } from "./campo";

interface SecaoPoliticaProps {
  form: Pick<
    EstadoConfiguracoes,
    | "antecedenciaMinimaMinutos"
    | "limiteDiasFuturos"
    | "prazoCancelamentoHoras"
    | "intervaloPadraoMinutos"
    | "confirmacaoAutomatica"
    | "permitirQualquerProfissional"
    | "permitirRemarcacaoCliente"
    | "exigirTelefoneCliente"
    | "exibirPrecoPublico"
  >;
  terminologia: Terminologia;
  setForm: (atualizar: (f: EstadoConfiguracoes) => EstadoConfiguracoes) => void;
}

const campoClasse = "w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink";

export function SecaoPolitica({ form, terminologia, setForm }: SecaoPoliticaProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <CartaoTitulo>Política de agendamento</CartaoTitulo>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Campo rotulo="Antecedência mín. (min)">
            <input
              type="number"
              min={0}
              value={form.antecedenciaMinimaMinutos}
              onChange={(e) => setForm((f) => ({ ...f, antecedenciaMinimaMinutos: Number(e.target.value) }))}
              className={campoClasse}
            />
          </Campo>
          <Campo rotulo="Agendar até (dias)">
            <input
              type="number"
              min={1}
              value={form.limiteDiasFuturos}
              onChange={(e) => setForm((f) => ({ ...f, limiteDiasFuturos: Number(e.target.value) }))}
              className={campoClasse}
            />
          </Campo>
          <Campo rotulo="Cancelar até (h antes)">
            <input
              type="number"
              min={0}
              value={form.prazoCancelamentoHoras}
              onChange={(e) => setForm((f) => ({ ...f, prazoCancelamentoHoras: Number(e.target.value) }))}
              className={campoClasse}
            />
          </Campo>
          <Campo rotulo="Intervalo padrão (min)">
            <input
              type="number"
              min={0}
              value={form.intervaloPadraoMinutos}
              onChange={(e) => setForm((f) => ({ ...f, intervaloPadraoMinutos: Number(e.target.value) }))}
              className={campoClasse}
            />
          </Campo>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={form.confirmacaoAutomatica}
              onChange={(e) => setForm((f) => ({ ...f, confirmacaoAutomatica: e.target.checked }))}
            />
            {`${terminologia.agendamento.plural} públicos nascem já confirmados (sem revisão manual)`}
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={form.permitirQualquerProfissional}
              onChange={(e) => setForm((f) => ({ ...f, permitirQualquerProfissional: e.target.checked }))}
            />
            {`Permitir que o ${terminologia.consumidor.singular.toLowerCase()} escolha "qualquer ${terminologia.profissional.singular.toLowerCase()}"`}
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={form.permitirRemarcacaoCliente}
              onChange={(e) => setForm((f) => ({ ...f, permitirRemarcacaoCliente: e.target.checked }))}
            />
            {`Permitir que o ${terminologia.consumidor.singular.toLowerCase()} remarque pelo link de confirmação`}
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={form.exigirTelefoneCliente}
              onChange={(e) => setForm((f) => ({ ...f, exigirTelefoneCliente: e.target.checked }))}
            />
            {`Exigir telefone do ${terminologia.consumidor.singular.toLowerCase()} no agendamento público`}
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={form.exibirPrecoPublico}
              onChange={(e) => setForm((f) => ({ ...f, exibirPrecoPublico: e.target.checked }))}
            />
            Exibir preços na página pública (serviços individuais ainda podem ocultar o próprio preço)
          </label>
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
