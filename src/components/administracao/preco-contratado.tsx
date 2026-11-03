"use client";

// Preço do plano atual para este cliente, na ficha do estabelecimento
// (portal da plataforma): catálogo, valor contratado específico e o que o
// formulário "Registrar pagamento" preenche. Alterar o contratado vale para
// as próximas renovações e não registra pagamento; o que já foi registrado
// nunca é recalculado.
import { useState } from "react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useAcaoSensivel } from "./reautenticacao";
import { acaoAdministrativa, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import { dataCadastro, type Ciclo, type DetalheEstabelecimento } from "@/lib/administracao/contratos";
import { centavosDe, CICLOS, ORIGEM_DA_SUGESTAO, reais, textoDoValor } from "@/lib/administracao/validade";
import { Retorno, useResultado } from "./resultado-acao";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

export function PrecoContratado({ item, aoMudar }: { item: DetalheEstabelecimento; aoMudar: () => void }) {
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(aoMudar);
  const [ciclo, setCiclo] = useState<Ciclo | null>(null);
  const [chave, setChave] = useState(novaChaveDeFormulario);
  const [valor, setValor] = useState("");
  const [seguirCatalogo, setSeguirCatalogo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const pricing = item.pricing;
  if (!pricing) return null;
  const pode = item.allowedActions.changeContract === true;

  function abrir(c: Ciclo) {
    const atual = pricing!.cycles.find((p) => p.cycle === c);
    setChave(novaChaveDeFormulario());
    setValor(atual?.contractCents ? textoDoValor(atual.contractCents) : "");
    setSeguirCatalogo(false);
    setMotivo("");
    setCiclo(c);
  }

  const centavos = seguirCatalogo ? null : centavosDe(valor);
  const podeConfirmar = !!ciclo && motivo.trim().length >= 3 && (seguirCatalogo || centavos !== null);

  async function confirmar() {
    if (!ciclo || !podeConfirmar) return;
    const corpo = { expectedUpdatedAt: item.updatedAt, requestKey: chave, cycle: ciclo, amountCents: centavos, reason: motivo.trim() };
    setCiclo(null);
    await executar(
      () =>
        executarSensivel(() =>
          acaoAdministrativa(`/platform/establishments/${encodeURIComponent(item.id)}/contract-price`, "PUT", corpo),
        ),
      "Valor contratado atualizado para as próximas renovações.",
    );
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-3" data-testid="preco-contratado">
        <h2 className="font-semibold">Preço da assinatura · plano {item.plan.name}</h2>
        <p className="text-xs text-ink-soft">
          Escolher plano e preço não registra pagamento nem comprova recebimento. O pagamento é registrado à parte, em
          Validade do acesso.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {pricing.cycles.map((p) => (
            <li key={p.cycle} className="space-y-1 rounded-[var(--radius-control)] border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{CICLOS[p.cycle]}</span>
                <Badge cor={p.source === "PENDING" ? "aviso" : p.source === "CONTRACT" ? "destaque" : "neutro"}>
                  {ORIGEM_DA_SUGESTAO[p.source]}
                </Badge>
              </div>
              <p data-testid={`preco-${p.cycle}`}>
                {p.suggestedCents === null ? "Pendente" : reais(p.suggestedCents)}
                {pricing.preferredCycle === p.cycle ? " · ciclo combinado" : ""}
              </p>
              <p className="text-xs text-ink-soft">
                Catálogo: {p.catalogCents === null ? "pendente" : reais(p.catalogCents)} · Contrato:{" "}
                {p.contractCents === null ? "segue o catálogo" : reais(p.contractCents)}
              </p>
              {pode && (
                <Botao variante="secundaria" className="min-h-11" disabled={ocupado} onClick={() => abrir(p.cycle)}>
                  Alterar contratado
                </Botao>
              )}
            </li>
          ))}
        </ul>
        <Retorno mensagem={mensagem} />
        {pricing.contractHistory.length > 0 && (
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer py-2 font-medium">Histórico do contrato</summary>
            <ul className="space-y-1">
              {pricing.contractHistory.map((m) => (
                <li key={m.id} className="break-words text-ink-soft">
                  {dataCadastro(m.recordedAt)} · {m.planName} · {CICLOS[m.cycle]}:{" "}
                  {m.amountCents === null ? "segue o catálogo" : reais(m.amountCents)} · {m.recordedBy.name}
                  {m.reason ? ` · ${m.reason}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
        <Modal
          aberto={ciclo !== null}
          aoFechar={() => setCiclo(null)}
          titulo={`Valor contratado ${ciclo === "QUARTERLY" ? "trimestral" : "mensal"}`}
          rodape={
            <>
              <Botao variante="secundaria" className="min-h-11" onClick={() => setCiclo(null)}>
                Cancelar
              </Botao>
              <Botao className="min-h-11" disabled={!podeConfirmar || ocupado} onClick={() => void confirmar()}>
                Salvar contrato
              </Botao>
            </>
          }
        >
          <div className="space-y-3" data-testid="form-contrato">
            <p>
              Vale para os próximos pagamentos deste cliente neste ciclo. Períodos e pagamentos já registrados não mudam.
            </p>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-5"
                checked={seguirCatalogo}
                onChange={(e) => setSeguirCatalogo(e.target.checked)}
              />
              <span>Seguir o preço do catálogo (sem valor específico)</span>
            </label>
            {!seguirCatalogo && (
              <label className="block text-sm font-medium">
                Valor contratado (R$)
                <input className={CAMPO} inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
              </label>
            )}
            <label className="block text-sm font-medium">
              Motivo (fica no histórico)
              <input className={CAMPO} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </label>
          </div>
        </Modal>
      </CartaoCorpo>
    </Cartao>
  );
}
