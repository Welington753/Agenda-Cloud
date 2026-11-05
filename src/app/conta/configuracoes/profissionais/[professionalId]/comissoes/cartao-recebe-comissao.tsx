"use client";

// "Recebe comissão" e regra geral de um profissional (dono). Desligado,
// regra geral e exceções ficam guardadas, mas nenhuma conclusão gera
// comissão. A regra geral é opcional: percentual sobre o preço de cada
// serviço realizado ou valor fixo por serviço realizado. O servidor confere
// tudo de novo e só a próxima conclusão usa o que for salvo.
import { useState, type FormEvent } from "react";
import { CheckCircle2, CircleSlash } from "lucide-react";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import {
  caminhoConfiguracao,
  ehRegrasDoProfissional,
  percentualParaPontosBase,
  pontosBaseParaCampo,
  type RegrasDoProfissional,
} from "@/lib/api/comissoes-api";
import { centavosParaCampo, precoParaCentavos } from "@/lib/servicos/dinheiro";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

export const CAMPO =
  "mt-1 block min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm text-ink";

/** Lê o campo de valor de um percentual ou de um valor fixo. `mensagemZero`:
 * o que dizer para zero (a exceção tem "Sem comissão"; a regra geral não). */
export function lerValor(
  tipo: "PERCENTAGE" | "FIXED",
  valor: string,
  mensagemZero: string,
): { ok: true; corpo: { kind: "PERCENTAGE" | "FIXED"; value: number } } | { ok: false; erro: string } {
  const zero = precoParaCentavos(valor);
  if (zero.ok && zero.centavos !== null && zero.centavos <= 0) return { ok: false, erro: mensagemZero };
  if (tipo === "PERCENTAGE") {
    const lido = percentualParaPontosBase(valor);
    return lido.ok ? { ok: true, corpo: { kind: "PERCENTAGE", value: lido.pontos } } : lido;
  }
  const lido = precoParaCentavos(valor);
  if (!lido.ok) return lido;
  if (lido.centavos === null) return { ok: false, erro: "Informe o valor." };
  if (lido.centavos > 100_000_000) return { ok: false, erro: "Valor acima do máximo aceito." };
  return { ok: true, corpo: { kind: "FIXED", value: lido.centavos } };
}

type EscolhaGeral = "NENHUMA" | "PERCENTAGE" | "FIXED";

export function CartaoRecebeComissao({
  tenantId,
  dados,
  aoSalvar,
}: {
  tenantId: string;
  dados: RegrasDoProfissional;
  aoSalvar: (regras: RegrasDoProfissional) => void;
}) {
  const { notificar } = useToast();
  const { settings } = dados;
  const [recebe, setRecebe] = useState(settings.receivesCommission);
  const [escolha, setEscolha] = useState<EscolhaGeral>(settings.defaultRule?.kind ?? "NENHUMA");
  const [valor, setValor] = useState(
    settings.defaultRule?.kind === "PERCENTAGE"
      ? pontosBaseParaCampo(settings.defaultRule.value)
      : settings.defaultRule?.kind === "FIXED"
        ? centavosParaCampo(settings.defaultRule.value)
        : "",
  );
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const id = "configuracao-comissao";

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (gravando) return;
    let defaultRule: { kind: "PERCENTAGE" | "FIXED"; value: number } | null = null;
    if (escolha !== "NENHUMA") {
      const lido = lerValor(escolha, valor, "Para não pagar comissão, desligue “Recebe comissão”.");
      if (!lido.ok) return setErro(lido.erro);
      defaultRule = lido.corpo;
    }
    setErro(null);
    setGravando(true);
    const r = await acaoAdministrativa<unknown>(caminhoConfiguracao(tenantId, dados.professional.id), "PUT", {
      receivesCommission: recebe,
      defaultRule,
    });
    setGravando(false);
    if (r.tipo !== "ok") return setErro(mensagemDoResultado(r));
    if (!ehRegrasDoProfissional(r.dados)) return setErro("O servidor respondeu num formato inesperado. Atualize a página.");
    notificar(`Comissão de ${dados.professional.name} salva.`, "sucesso");
    aoSalvar(r.dados);
  }

  return (
    <Cartao>
      <CartaoCorpo>
        <form onSubmit={(e) => void salvar(e)} className="space-y-3" aria-labelledby={`${id}-titulo`} data-testid="configuracao-comissao">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 id={`${id}-titulo`} className="text-base font-semibold text-ink">
              Comissão do profissional
            </h2>
            <Badge cor={settings.receivesCommission ? "sucesso" : "neutro"} data-testid="estado-recebe-comissao">
              {settings.receivesCommission ? (
                <CheckCircle2 size={14} aria-hidden="true" className="mr-1 inline" />
              ) : (
                <CircleSlash size={14} aria-hidden="true" className="mr-1 inline" />
              )}
              {settings.receivesCommission ? "Recebe comissão" : "Não recebe comissão"}
            </Badge>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={recebe}
              onChange={(e) => {
                setRecebe(e.currentTarget.checked);
                setErro(null);
              }}
              className="size-5 accent-[var(--color-accent)]"
            />
            Recebe comissão
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink" htmlFor={`${id}-geral`}>
              Regra geral
              <select
                id={`${id}-geral`}
                className={CAMPO}
                value={escolha}
                onChange={(e) => {
                  setEscolha(e.target.value as EscolhaGeral);
                  setErro(null);
                }}
              >
                <option value="NENHUMA">Sem regra geral</option>
                <option value="PERCENTAGE">Percentual do preço de cada serviço</option>
                <option value="FIXED">Valor fixo por serviço realizado</option>
              </select>
            </label>
            {escolha !== "NENHUMA" && (
              <label className="text-sm font-medium text-ink" htmlFor={`${id}-valor`}>
                {escolha === "PERCENTAGE" ? "Percentual (%)" : "Valor por serviço (R$)"}
                <input
                  id={`${id}-valor`}
                  className={CAMPO}
                  inputMode="decimal"
                  placeholder={escolha === "PERCENTAGE" ? "Ex.: 40 ou 12,5" : "Ex.: 15,00"}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                />
              </label>
            )}
          </div>
          <p className="text-xs text-ink-soft">
            {!recebe
              ? "Desligado: a regra geral e as exceções ficam guardadas, mas nenhum atendimento concluído gera comissão para este profissional."
              : escolha === "NENHUMA"
                ? "Sem regra geral, os serviços sem exceção ficam não configurados e vão para conferência."
                : "Serviços sem exceção usam a regra geral. Uma exceção, inclusive “Sem comissão”, vale no lugar dela."}
          </p>
          {erro && (
            <p role="alert" className="text-sm text-danger">
              {erro}
            </p>
          )}
          <Botao type="submit" className="min-h-11" disabled={gravando} aria-busy={gravando}>
            Salvar comissão do profissional
          </Botao>
        </form>
      </CartaoCorpo>
    </Cartao>
  );
}
