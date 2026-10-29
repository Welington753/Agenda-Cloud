"use client";

// Validade do acesso do estabelecimento (assinatura do Agenda Cloud), separada
// da situação administrativa (suspender, arquivar, reativar) e do plano.
// Nada aqui é recebimento de atendimento.
//
// Três ações, cada uma com confirmação, senha (mesma reautenticação das
// contas) e histórico no servidor: pagamento confirmado MANUALMENTE,
// prorrogação do teste e cortesia. Cada formulário tem uma chave própria:
// repetir o envio (resposta perdida, clique duplo) devolve o mesmo registro,
// sem duplicar pagamento nem estender a validade duas vezes. Nenhuma delas
// tira suspensão ou arquivamento.
import { useState, type ReactNode } from "react";
import { CalendarCheck, CircleAlert, Clock, Gift } from "lucide-react";
import { Badge, type CorBadge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useAcaoSensivel } from "./reautenticacao";
import { acaoAdministrativa, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import {
  dataCadastro,
  type DetalheEstabelecimento,
  type EstadoComercial,
} from "@/lib/administracao/contratos";
import { Retorno, useResultado } from "./resultado-acao";
import { HistoricoDeValidade } from "./historico-validade";
import { centavosDe, diaBr, FORMAS_DE_PAGAMENTO, hojeLocal } from "@/lib/administracao/validade";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

const ESTADO: Record<EstadoComercial, { rotulo: string; cor: CorBadge; icone: ReactNode }> = {
  UNTRACKED: { rotulo: "Sem validade registrada", cor: "neutro", icone: <Clock aria-hidden className="size-3.5" /> },
  TRIAL: { rotulo: "Teste gratuito", cor: "info", icone: <Clock aria-hidden className="size-3.5" /> },
  PAID: { rotulo: "Período pago", cor: "sucesso", icone: <CalendarCheck aria-hidden className="size-3.5" /> },
  COURTESY: { rotulo: "Cortesia", cor: "destaque", icone: <Gift aria-hidden className="size-3.5" /> },
  EXPIRED: { rotulo: "Vencido", cor: "aviso", icone: <CircleAlert aria-hidden className="size-3.5" /> },
};

type Acao = "paid" | "trial-extension" | "courtesy";

const TITULO: Record<Acao, string> = {
  paid: "Registrar pagamento confirmado manualmente",
  "trial-extension": "Prorrogar o teste gratuito",
  courtesy: "Conceder cortesia",
};

export function ValidadeDoAcesso({ item, aoMudar }: { item: DetalheEstabelecimento; aoMudar: () => void }) {
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(aoMudar);
  const [acao, setAcao] = useState<Acao | null>(null);
  // A chave nasce com o formulário aberto e vale para todas as tentativas
  // dele: o servidor nunca grava duas vezes o mesmo envio.
  const [chave, setChave] = useState(novaChaveDeFormulario);
  const [ciclo, setCiclo] = useState<"MONTHLY" | "QUARTERLY">("MONTHLY");
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState("PIX");
  const [recebidoEm, setRecebidoEm] = useState(() => hojeLocal(item.timezone));
  const [referencia, setReferencia] = useState("");
  const [observacao, setObservacao] = useState("");
  const [dias, setDias] = useState("7");
  const [motivo, setMotivo] = useState("");
  const [conferido, setConferido] = useState(false);
  const acoes = item.allowedActions;
  const estado = ESTADO[item.access.state];
  const suspenso = item.status === "SUSPENDED";

  function abrir(nova: Acao) {
    setChave(novaChaveDeFormulario());
    setValor("");
    setReferencia("");
    setObservacao("");
    setMotivo("");
    setDias(nova === "courtesy" ? "30" : "7");
    setConferido(false);
    setRecebidoEm(hojeLocal(item.timezone));
    setAcao(nova);
  }

  const centavos = centavosDe(valor);
  const numeroDeDias = Number(dias);
  const maxDias = acao === "courtesy" ? 180 : 30;
  const diasValidos = Number.isInteger(numeroDeDias) && numeroDeDias >= 1 && numeroDeDias <= maxDias;
  const podeConfirmar =
    acao === "paid"
      ? centavos !== null && conferido && !!recebidoEm && recebidoEm <= hojeLocal(item.timezone)
      : diasValidos && motivo.trim().length >= 3;

  async function confirmar() {
    if (!acao || !podeConfirmar) return;
    const corpo =
      acao === "paid"
        ? {
            expectedUpdatedAt: item.updatedAt,
            requestKey: chave,
            cycle: ciclo,
            amountCents: centavos,
            paymentMethod: forma,
            receivedOn: recebidoEm,
            ...(referencia.trim() ? { reference: referencia.trim() } : {}),
            ...(observacao.trim() ? { notes: observacao.trim() } : {}),
            manualConfirmation: true,
          }
        : { expectedUpdatedAt: item.updatedAt, requestKey: chave, days: numeroDeDias, reason: motivo.trim() };
    const atual = acao;
    setAcao(null);
    await executar(
      () =>
        executarSensivel(() =>
          acaoAdministrativa(`/platform/establishments/${encodeURIComponent(item.id)}/access/${atual}`, "POST", corpo),
        ),
      atual === "paid"
        ? suspenso
          ? "Pagamento registrado. O estabelecimento continua suspenso até a reativação."
          : "Pagamento registrado e período liberado."
        : atual === "courtesy"
          ? "Cortesia concedida."
          : "Teste prorrogado.",
    );
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-4" data-testid="validade-acesso">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Validade do acesso</h2>
          <Badge cor={estado.cor} data-testid="estado-validade">
            {estado.icone}
            {estado.rotulo}
          </Badge>
        </div>
        <ResumoDaValidade item={item} />
        {suspenso && (
          <p className="text-xs text-ink-soft">
            Estabelecimento suspenso pela administração: registrar validade não tira a suspensão. Use Reativar, em
            Situação, quando for o caso.
          </p>
        )}
        {(acoes.recordPayment || acoes.extendTrial || acoes.grantCourtesy) && (
          <div className="flex flex-wrap gap-2">
            {acoes.recordPayment && (
              <Botao className="min-h-11" disabled={ocupado} onClick={() => abrir("paid")}>
                Registrar pagamento
              </Botao>
            )}
            {acoes.extendTrial && (
              <Botao variante="secundaria" className="min-h-11" disabled={ocupado} onClick={() => abrir("trial-extension")}>
                Prorrogar teste
              </Botao>
            )}
            {acoes.grantCourtesy && (
              <Botao variante="secundaria" className="min-h-11" disabled={ocupado} onClick={() => abrir("courtesy")}>
                Conceder cortesia
              </Botao>
            )}
          </div>
        )}
        {!acoes.recordPayment && !acoes.grantCourtesy && item.status !== "ARCHIVED" && (
          <p className="text-xs text-ink-soft">Só a pessoa responsável pela plataforma registra validade.</p>
        )}
        {item.status === "ARCHIVED" && (
          <p className="text-xs text-ink-soft">Estabelecimento arquivado: reative antes de registrar validade.</p>
        )}
        <Retorno mensagem={mensagem} />
        <HistoricoDeValidade periodos={item.accessPeriods} />
        <Modal
          aberto={acao !== null}
          aoFechar={() => setAcao(null)}
          titulo={acao ? TITULO[acao] : ""}
          rodape={
            <>
              <Botao variante="secundaria" className="min-h-11" onClick={() => setAcao(null)}>
                Cancelar
              </Botao>
              <Botao className="min-h-11" disabled={!podeConfirmar || ocupado} onClick={() => void confirmar()}>
                {acao === "paid" ? "Registrar e liberar" : acao === "courtesy" ? "Conceder" : "Prorrogar"}
              </Botao>
            </>
          }
        >
          {acao === "paid" && (
            <div className="space-y-3" data-testid="form-pagamento">
              <p>
                Plano {item.plan.name}. O período começa no fim da validade em curso (renovação antecipada) ou hoje, se
                não há validade em curso. Mensal e trimestral seguem o calendário, não 30 ou 90 dias.
              </p>
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <label className="min-w-0 text-sm font-medium">
                  Ciclo
                  <select className={CAMPO} value={ciclo} onChange={(e) => setCiclo(e.target.value as "MONTHLY" | "QUARTERLY")}>
                    <option value="MONTHLY">Mensal</option>
                    <option value="QUARTERLY">Trimestral</option>
                  </select>
                </label>
                <label className="min-w-0 text-sm font-medium">
                  Valor contratado (R$)
                  <input
                    className={CAMPO}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                  />
                </label>
                <label className="min-w-0 text-sm font-medium">
                  Forma de pagamento
                  <select className={CAMPO} value={forma} onChange={(e) => setForma(e.target.value)}>
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
                    value={recebidoEm}
                    onChange={(e) => setRecebidoEm(e.target.value)}
                  />
                </label>
                <label className="min-w-0 text-sm font-medium sm:col-span-2">
                  Referência (opcional)
                  <input
                    className={CAMPO}
                    maxLength={120}
                    placeholder="Ex.: identificador do comprovante"
                    value={referencia}
                    onChange={(e) => setReferencia(e.target.value)}
                  />
                </label>
                <label className="min-w-0 text-sm font-medium sm:col-span-2">
                  Observação (opcional)
                  <input className={CAMPO} maxLength={300} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
                </label>
              </fieldset>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 size-5" checked={conferido} onChange={(e) => setConferido(e.target.checked)} />
                <span>
                  Conferi o pagamento manualmente. O registro diz que a confirmação foi manual, pela administração: não
                  houve confirmação automática por banco ou operadora.
                </span>
              </label>
              {valor && centavos === null && <p className="text-xs text-[color:var(--color-danger)]">Valor inválido.</p>}
              {suspenso && <p className="text-xs">O estabelecimento continua suspenso depois do registro.</p>}
            </div>
          )}
          {(acao === "trial-extension" || acao === "courtesy") && (
            <div className="space-y-3" data-testid="form-validade">
              <p>
                {acao === "trial-extension"
                  ? "Os dias são acrescentados ao fim do teste em curso, ou a partir de hoje se ele já venceu. O teste não recomeça do zero."
                  : "A cortesia começa no fim da validade em curso, ou hoje se não há validade em curso. Sem valor cobrado."}
              </p>
              <label className="block text-sm font-medium">
                Dias (1 a {maxDias})
                <input
                  type="number"
                  min={1}
                  max={maxDias}
                  className={CAMPO}
                  value={dias}
                  onChange={(e) => setDias(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Motivo (fica no histórico)
                <textarea
                  required
                  minLength={3}
                  maxLength={300}
                  rows={2}
                  className={`${CAMPO} py-2`}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </label>
            </div>
          )}
        </Modal>
      </CartaoCorpo>
    </Cartao>
  );
}

function ResumoDaValidade({ item }: { item: DetalheEstabelecimento }) {
  const { access } = item;
  if (access.state === "UNTRACKED") {
    return (
      <p className="text-sm text-ink-soft">
        Estabelecimento anterior ao controle de validade: o acesso não vence até a administração registrar um período.
        Pelo cadastro, o teste de {item.trial.durationDays} dias terminaria em {dataCadastro(item.trial.trialEndAt)}.
      </p>
    );
  }
  if (access.state === "EXPIRED") {
    return (
      <p className="text-sm" data-testid="motivo-vencido">
        {access.expiredKind === "TRIAL" ? "O teste gratuito" : access.expiredKind === "COURTESY" ? "A cortesia" : "O período pago"}{" "}
        terminou em {access.expiredAt ? dataCadastro(access.expiredAt) : "data não informada"}. A equipe vê o motivo e o
        caminho de regularização; dados e reservas estão preservados.
      </p>
    );
  }
  return (
    <p className="text-sm">
      Válido até <strong>{access.lastDay ? diaBr(access.lastDay) : "—"}</strong> (inclui as renovações já registradas).
    </p>
  );
}
