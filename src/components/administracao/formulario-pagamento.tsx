"use client";

// Campos do "Registrar pagamento" da validade do acesso (assinatura do Agenda
// Cloud). O valor chega preenchido com a sugestão do servidor (contratado
// vigente deste cliente, senão catálogo; pendente fica vazio, nunca zero), com
// a origem à vista. Mudar o valor ajusta só este pagamento, a menos que a
// pessoa marque que ele passa a ser o contratado nas próximas renovações. O
// servidor decide a origem de novo ao gravar.
import type { DetalheEstabelecimento, PrecoDoCiclo } from "@/lib/administracao/contratos";
import {
  FORMAS_DE_PAGAMENTO,
  hojeLocal,
  ORIGEM_DA_SUGESTAO,
  ORIGEM_DO_VALOR,
  reais,
} from "@/lib/administracao/validade";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

export type Ciclo = "MONTHLY" | "QUARTERLY";

export interface CamposDoPagamento {
  ciclo: Ciclo;
  valor: string;
  forma: string;
  recebidoEm: string;
  referencia: string;
  observacao: string;
  conferido: boolean;
  atualizarContrato: boolean;
}

export function FormularioDePagamento({
  item,
  campos,
  mudar,
  aoTrocarCiclo,
  sugestao,
  origem,
  valorInvalido,
}: {
  item: DetalheEstabelecimento;
  campos: CamposDoPagamento;
  mudar: (parcial: Partial<CamposDoPagamento>) => void;
  aoTrocarCiclo: (ciclo: Ciclo) => void;
  sugestao: PrecoDoCiclo | undefined;
  origem: "CONTRACT" | "CATALOG" | "ADJUSTED" | null;
  valorInvalido: boolean;
}) {
  return (
    <div className="space-y-3" data-testid="form-pagamento">
      <p>
        Plano {item.plan.name}. O período começa no fim da validade em curso (renovação antecipada) ou hoje, se não há
        validade em curso. Mensal e trimestral seguem o calendário, não 30 ou 90 dias.
      </p>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium">
          Ciclo
          <select className={CAMPO} value={campos.ciclo} onChange={(e) => aoTrocarCiclo(e.target.value as Ciclo)}>
            <option value="MONTHLY">Mensal</option>
            <option value="QUARTERLY">Trimestral</option>
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Valor deste pagamento (R$)
          <input
            className={CAMPO}
            inputMode="decimal"
            placeholder="0,00"
            value={campos.valor}
            data-testid="valor-pagamento"
            onChange={(e) => mudar({ valor: e.target.value })}
          />
        </label>
        <div className="space-y-1 text-xs text-ink-soft sm:col-span-2" data-testid="origem-do-valor">
          {sugestao && sugestao.source !== "PENDING" ? (
            <p>
              Sugestão: {ORIGEM_DA_SUGESTAO[sugestao.source]}, {reais(sugestao.suggestedCents!)}.
              {sugestao.source === "CONTRACT" && sugestao.catalogCents !== null ? ` Catálogo: ${reais(sugestao.catalogCents)}.` : ""}
            </p>
          ) : (
            <p className="font-medium text-ink">
              Preço ainda não definido para este plano e ciclo (nem contrato nem catálogo). Digite o valor combinado; ele
              não é gratuito.
            </p>
          )}
          {origem && <p>Este pagamento: {ORIGEM_DO_VALOR[origem]}.</p>}
        </div>
        {origem === "ADJUSTED" && item.allowedActions.changeContract !== false && (
          <label className="flex min-h-11 items-start gap-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={campos.atualizarContrato}
              data-testid="atualizar-contrato"
              onChange={(e) => mudar({ atualizarContrato: e.target.checked })}
            />
            <span>
              Usar este valor como contratado deste cliente nas próximas renovações (
              {campos.ciclo === "MONTHLY" ? "mensal" : "trimestral"}). Sem marcar, o ajuste vale só para este pagamento.
            </span>
          </label>
        )}
        <label className="min-w-0 text-sm font-medium">
          Forma de pagamento
          <select className={CAMPO} value={campos.forma} onChange={(e) => mudar({ forma: e.target.value })}>
            {Object.entries(FORMAS_DE_PAGAMENTO).map(([codigo, rotulo]) => (
              <option key={codigo} value={codigo}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Recebido em
          <input
            type="date"
            className={CAMPO}
            max={hojeLocal(item.timezone)}
            value={campos.recebidoEm}
            onChange={(e) => mudar({ recebidoEm: e.target.value })}
          />
        </label>
        <label className="min-w-0 text-sm font-medium sm:col-span-2">
          Referência (opcional)
          <input
            className={CAMPO}
            maxLength={120}
            placeholder="Ex.: identificador do comprovante"
            value={campos.referencia}
            onChange={(e) => mudar({ referencia: e.target.value })}
          />
        </label>
        <label className="min-w-0 text-sm font-medium sm:col-span-2">
          Observação (opcional)
          <input className={CAMPO} maxLength={300} value={campos.observacao} onChange={(e) => mudar({ observacao: e.target.value })} />
        </label>
      </fieldset>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-5"
          checked={campos.conferido}
          onChange={(e) => mudar({ conferido: e.target.checked })}
        />
        <span>
          Conferi o pagamento manualmente. O registro diz que a confirmação foi manual, pela administração: não houve
          confirmação automática por banco ou operadora.
        </span>
      </label>
      {valorInvalido && <p className="text-xs text-[color:var(--color-danger)]">Valor inválido.</p>}
      {item.status === "SUSPENDED" && <p className="text-xs">O estabelecimento continua inativo depois do registro.</p>}
    </div>
  );
}
