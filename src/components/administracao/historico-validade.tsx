"use client";

// Histórico da validade do acesso na ficha do estabelecimento: cada teste,
// período pago e cortesia, com o valor contratado e quem registrou. Nada é
// editado nem apagado: um registro feito por engano é ANULADO pela correção
// (só MASTER_OWNER, com senha e motivo) e continua aqui, marcado, com o valor
// original. A correção mostra antes como fica a validade e não devolve nem
// movimenta dinheiro.
import { useState } from "react";
import { Ban, Clock, Gift, ReceiptText } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAcaoSensivel } from "./reautenticacao";
import { Retorno, useResultado } from "./resultado-acao";
import { acaoAdministrativa, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import {
  dataCadastro,
  type DetalheEstabelecimento,
  type PeriodoDeAcesso,
  type TipoDePeriodo,
} from "@/lib/administracao/contratos";
import { CICLOS, diaBr, FORMAS_DE_PAGAMENTO, reais, validadeDepoisDaCorrecao } from "@/lib/administracao/validade";

const TIPO: Record<TipoDePeriodo, string> = { TRIAL: "Teste gratuito", PAID: "Período pago", COURTESY: "Cortesia" };
const CAMPO = "mt-1 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 py-2 text-sm";

export function HistoricoDeValidade({ item, aoMudar }: { item: DetalheEstabelecimento; aoMudar: () => void }) {
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(aoMudar);
  const [alvo, setAlvo] = useState<PeriodoDeAcesso | null>(null);
  const [chave, setChave] = useState(novaChaveDeFormulario);
  const [motivo, setMotivo] = useState("");
  const periodos = item.accessPeriods;
  const podeCorrigir = item.allowedActions.correctPeriod === true;
  if (!periodos.length) return null;

  function abrir(periodo: PeriodoDeAcesso) {
    setChave(novaChaveDeFormulario());
    setMotivo("");
    setAlvo(periodo);
  }

  async function confirmar() {
    if (!alvo || motivo.trim().length < 3) return;
    const corpo = { expectedUpdatedAt: item.updatedAt, requestKey: chave, reason: motivo.trim() };
    const caminho = `/platform/establishments/${encodeURIComponent(item.id)}/access/periods/${encodeURIComponent(alvo.id)}/correction`;
    setAlvo(null);
    await executar(
      () => executarSensivel(() => acaoAdministrativa(caminho, "POST", corpo)),
      "Registro anulado. Nenhum valor foi devolvido ou movimentado pelo sistema.",
    );
  }

  const previa = alvo?.correction?.allowed ? alvo.correction : null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Histórico</h3>
      <Retorno mensagem={mensagem} />
      <ul className="space-y-2" data-testid="historico-validade">
        {periodos.map((p) => (
          <li key={p.id} className="rounded-lg border border-border p-3 text-sm" data-testid="registro-validade">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {p.canceled ? (
                <Ban aria-hidden className="size-4" />
              ) : p.kind === "PAID" ? (
                <ReceiptText aria-hidden className="size-4" />
              ) : p.kind === "COURTESY" ? (
                <Gift aria-hidden className="size-4" />
              ) : (
                <Clock aria-hidden className="size-4" />
              )}
              <span className={p.canceled ? "line-through" : undefined}>
                {TIPO[p.kind]} · {diaBr(p.firstDay)} a {diaBr(p.lastDay)}
              </span>
              {p.canceled && <span className="text-xs font-semibold">Anulado</span>}
            </p>
            <p className="mt-1 break-words text-xs text-ink-soft">
              Plano {p.plan.name}
              {p.cycle && ` · ${CICLOS[p.cycle]}`}
              {p.amountCents !== null && ` · ${reais(p.amountCents)} contratado`}
              {p.paymentMethod && ` · ${FORMAS_DE_PAGAMENTO[p.paymentMethod] ?? p.paymentMethod}`}
              {p.receivedOn && `, recebido em ${diaBr(p.receivedOn)}`}
              {p.reference && ` · ref. ${p.reference}`}
            </p>
            {p.confirmationSource === "MANUAL" && (
              <p className="text-xs text-ink-soft">Confirmado manualmente pela administração (sem confirmação automática).</p>
            )}
            {p.reason && <p className="break-words text-xs text-ink-soft">Motivo: {p.reason}</p>}
            <p className="text-xs text-ink-soft">
              Registrado por {p.recordedBy.name} em {dataCadastro(p.recordedAt)}
            </p>
            {p.canceled && (
              <p className="break-words text-xs" data-testid="registro-anulado">
                Anulado por {p.canceled.by.name} em {dataCadastro(p.canceled.at)}: {p.canceled.reason}. Não conta para a
                validade; nenhum valor foi devolvido pelo sistema.
              </p>
            )}
            {podeCorrigir && p.correction?.allowed && (
              <Botao variante="secundaria" className="mt-2 min-h-11" disabled={ocupado} onClick={() => abrir(p)}>
                Corrigir registro
              </Botao>
            )}
            {podeCorrigir && p.correction && !p.correction.allowed && (
              <p className="mt-1 text-xs text-ink-soft">Há registro depois deste: para corrigir, anule primeiro o mais recente.</p>
            )}
          </li>
        ))}
      </ul>
      <Modal
        aberto={alvo !== null}
        aoFechar={() => setAlvo(null)}
        titulo="Corrigir registro feito por engano"
        rodape={
          <>
            <Botao variante="secundaria" className="min-h-11" onClick={() => setAlvo(null)}>
              Cancelar
            </Botao>
            <Botao className="min-h-11" disabled={motivo.trim().length < 3 || ocupado} onClick={() => void confirmar()}>
              Anular registro
            </Botao>
          </>
        }
      >
        {alvo && previa && (
          <div className="space-y-3" data-testid="form-correcao">
            <p>
              {TIPO[alvo.kind]} de {diaBr(alvo.firstDay)} a {diaBr(alvo.lastDay)}
              {alvo.amountCents !== null && `, ${reais(alvo.amountCents)}`}. O registro fica no histórico, marcado como
              anulado, e deixa de contar para a validade.
            </p>
            <p className="rounded-lg border border-border p-3" data-testid="impacto-correcao">
              <strong>Validade agora:</strong> {validadeDepoisDaCorrecao(item.access, item.timezone)}
              <br />
              <strong>Depois de anular:</strong> {validadeDepoisDaCorrecao(previa.after, item.timezone)}
            </p>
            <p className="text-xs">
              Isto corrige só o registro. O Agenda Cloud não devolve nem movimenta dinheiro: um estorno, se houver, é
              feito fora do sistema.
            </p>
            <label className="block text-sm font-medium">
              Motivo da correção (fica no histórico)
              <textarea
                required
                minLength={3}
                maxLength={300}
                rows={2}
                className={CAMPO}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
