"use client";

// Registro da quitação de UM atendimento: valor efetivamente pago, forma e
// data do recebimento. O preço da reserva aparece só como sugestão (botão
// "Usar preço da reserva"): nada é registrado sem a pessoa informar o valor.
//
// Um envio por vez (barreira síncrona contra clique duplo) e a mesma chave do
// formulário em toda tentativa: repetir depois de uma resposta perdida
// devolve o mesmo registro, nunca um segundo.
import { useRef, useState, type FormEvent } from "react";
import { Botao } from "@/components/ui/button";
import { acaoAdministrativa, mensagemDoResultado, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import {
  FORMAS_DE_PAGAMENTO,
  MAIOR_VALOR_EM_CENTAVOS,
  ROTULO_FORMA,
  caminhoRecebimentos,
  ehRegistroDeRecebimento,
  type AtendimentoAQuitar,
  type FormaDePagamento,
} from "@/lib/api/recebimentos-api";
import { centavosParaCampo, precoParaCentavos } from "@/lib/servicos/dinheiro";
import { formatarMoeda } from "@/lib/format";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border bg-card px-3 text-sm text-ink";

export function RegistrarRecebimento({
  tenantId,
  atendimento,
  hoje,
  aoRegistrar,
  aoCancelar,
}: {
  tenantId: string;
  atendimento: AtendimentoAQuitar;
  hoje: string;
  aoRegistrar: (mensagem: string) => void;
  aoCancelar: () => void;
}) {
  const [chave] = useState(novaChaveDeFormulario);
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState<FormaDePagamento>("PIX");
  const [data, setData] = useState(hoje);
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [incerto, setIncerto] = useState(false);
  const emVoo = useRef(false);

  const lido = precoParaCentavos(valor);
  const problema = !lido.ok
    ? lido.erro
    : lido.centavos === null || lido.centavos <= 0
      ? valor.trim() === ""
        ? null
        : "Informe um valor maior que zero."
      : lido.centavos > MAIOR_VALOR_EM_CENTAVOS
        ? "Valor acima do máximo aceito."
        : data > hoje
          ? "A data do recebimento não pode ser depois de hoje."
          : null;
  const pronto = lido.ok && lido.centavos !== null && lido.centavos > 0 && !problema && data !== "";

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (!pronto || !lido.ok || lido.centavos === null || emVoo.current) return;
    emVoo.current = true;
    setEnviando(true);
    setErro(null);
    const r = await acaoAdministrativa(caminhoRecebimentos(tenantId), "POST", {
      requestKey: chave,
      appointmentId: atendimento.id,
      amountCents: lido.centavos,
      method: forma,
      receivedOn: data,
      notes: observacao,
    });
    emVoo.current = false;
    setEnviando(false);
    if (r.tipo === "ok" && ehRegistroDeRecebimento(r.dados)) {
      aoRegistrar(
        r.dados.created
          ? `Recebimento de ${formatarMoeda(r.dados.payment.amountCents)} registrado.`
          : "Este recebimento já estava registrado.",
      );
    } else if (r.tipo === "rede") {
      setIncerto(true);
    } else {
      setErro(r.tipo === "ok" ? "Resposta inesperada do servidor. Atualize antes de repetir." : mensagemDoResultado(r));
    }
  }

  return (
    <form onSubmit={(e) => void aoEnviar(e)} className="space-y-3 rounded-lg border border-dashed border-border p-3" data-testid="registrar-recebimento">
      <fieldset disabled={enviando} className="grid gap-3 sm:grid-cols-3">
        <label className="min-w-0 text-sm font-medium text-ink">
          Valor pago (R$)
          <input
            inputMode="decimal"
            autoComplete="off"
            className={CAMPO}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <label className="min-w-0 text-sm font-medium text-ink">
          Forma de pagamento
          <select className={CAMPO} value={forma} onChange={(e) => setForma(e.target.value as FormaDePagamento)}>
            {FORMAS_DE_PAGAMENTO.map((f) => (
              <option key={f} value={f}>
                {ROTULO_FORMA[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium text-ink">
          Data do recebimento
          <input type="date" max={hoje} className={CAMPO} value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <label className="min-w-0 text-sm font-medium text-ink sm:col-span-3">
          Observação (opcional)
          <input maxLength={300} className={CAMPO} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </label>
      </fieldset>
      {atendimento.bookedPriceCents !== null && (
        <p className="text-xs text-ink-soft">
          Preço da reserva: {formatarMoeda(atendimento.bookedPriceCents)}. Ele não é registrado sozinho: informe o
          valor que a pessoa pagou.{" "}
          <button
            type="button"
            className="min-h-11 font-medium text-[color:var(--color-accent-hover)] underline"
            onClick={() => setValor(centavosParaCampo(atendimento.bookedPriceCents))}
          >
            Usar preço da reserva
          </button>
        </p>
      )}
      <p className="text-xs text-ink-soft">
        Nesta versão, cada registro quita o atendimento inteiro. Pagamento parcial ainda não existe.
      </p>
      {(problema || erro) && (
        <p role="alert" className="text-sm text-ink" data-testid="erro-recebimento">
          {erro ?? problema}
        </p>
      )}
      {incerto && (
        <p role="alert" className="text-sm text-ink">
          Não foi possível confirmar com o servidor. Enviar de novo é seguro: o mesmo registro não é criado duas vezes.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Botao type="submit" className="min-h-11" disabled={!pronto || enviando} aria-busy={enviando} data-testid="confirmar-recebimento">
          {enviando ? "Registrando..." : incerto ? "Enviar de novo" : "Registrar recebimento"}
        </Botao>
        <Botao type="button" variante="fantasma" className="min-h-11" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
