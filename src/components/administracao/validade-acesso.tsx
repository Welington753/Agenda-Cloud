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
import { CalendarCheck, CircleAlert, Clock, Gift, InfinityIcon } from "lucide-react";
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
import { FormularioDePagamento, type CamposDoPagamento, type Ciclo } from "./formulario-pagamento";
import { centavosDe, diaBr, hojeLocal, origemDoValorDigitado, textoDoValor } from "@/lib/administracao/validade";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

const ESTADO: Record<EstadoComercial, { rotulo: string; cor: CorBadge; icone: ReactNode }> = {
  NO_EXPIRY: { rotulo: "Sem vencimento", cor: "destaque", icone: <InfinityIcon aria-hidden className="size-3.5" /> },
  UNTRACKED: { rotulo: "Validade ainda não definida", cor: "neutro", icone: <Clock aria-hidden className="size-3.5" /> },
  MISSING: { rotulo: "Sem validade registrada", cor: "aviso", icone: <CircleAlert aria-hidden className="size-3.5" /> },
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
  const [pg, setPg] = useState<CamposDoPagamento>(() => camposIniciais("MONTHLY"));
  const [dias, setDias] = useState("7");
  const [motivo, setMotivo] = useState("");
  const acoes = item.allowedActions;
  const precoDo = (c: Ciclo) => item.pricing?.cycles.find((p) => p.cycle === c);
  const sugestao = precoDo(pg.ciclo);
  const mudar = (parcial: Partial<CamposDoPagamento>) => setPg((atual) => ({ ...atual, ...parcial }));
  const estado = ESTADO[item.access.state];
  const suspenso = item.status === "SUSPENDED";

  /** Valor sugerido pelo servidor para o ciclo: contrato vigente, senão
   * catálogo; pendente deixa o campo vazio (nunca zero). */
  function valorSugerido(c: Ciclo) {
    const s = item.pricing?.cycles.find((p) => p.cycle === c);
    return { valor: s?.suggestedCents ? textoDoValor(s.suggestedCents) : "", atualizarContrato: false };
  }

  function camposIniciais(c: Ciclo): CamposDoPagamento {
    return {
      ciclo: c,
      ...valorSugerido(c),
      forma: "PIX",
      recebidoEm: hojeLocal(item.timezone),
      referencia: "",
      observacao: "",
      conferido: false,
    };
  }

  function abrir(nova: Acao) {
    setChave(novaChaveDeFormulario());
    setPg(camposIniciais(item.pricing?.preferredCycle ?? "MONTHLY"));
    setMotivo("");
    setDias(nova === "courtesy" ? "30" : "7");
    setAcao(nova);
  }

  const centavos = centavosDe(pg.valor);
  const origem = origemDoValorDigitado(centavos, sugestao);
  const numeroDeDias = Number(dias);
  const maxDias = acao === "courtesy" ? 180 : 30;
  const diasValidos = Number.isInteger(numeroDeDias) && numeroDeDias >= 1 && numeroDeDias <= maxDias;
  const podeConfirmar =
    acao === "paid"
      ? centavos !== null && pg.conferido && !!pg.recebidoEm && pg.recebidoEm <= hojeLocal(item.timezone)
      : diasValidos && motivo.trim().length >= 3;

  async function confirmar() {
    if (!acao || !podeConfirmar) return;
    const corpo =
      acao === "paid"
        ? {
            expectedUpdatedAt: item.updatedAt,
            requestKey: chave,
            cycle: pg.ciclo,
            amountCents: centavos,
            paymentMethod: pg.forma,
            receivedOn: pg.recebidoEm,
            ...(pg.referencia.trim() ? { reference: pg.referencia.trim() } : {}),
            ...(pg.observacao.trim() ? { notes: pg.observacao.trim() } : {}),
            manualConfirmation: true,
            ...(pg.atualizarContrato && origem === "ADJUSTED" ? { updateContract: true } : {}),
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
        <HistoricoDeValidade item={item} aoMudar={aoMudar} />
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
            <FormularioDePagamento
              item={item}
              campos={pg}
              mudar={mudar}
              aoTrocarCiclo={(c) => mudar({ ciclo: c, ...valorSugerido(c) })}
              sugestao={sugestao}
              origem={origem}
              valorInvalido={!!pg.valor && centavos === null}
            />
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
  if (access.state === "NO_EXPIRY") {
    return (
      <p className="text-sm" data-testid="validade-sem-vencimento">
        Acesso sem vencimento concedido pela administração. Não é pagamento, não muda plano, recursos nem papéis. Os
        períodos registrados continuam no histórico e voltam a valer se a concessão for retirada.
      </p>
    );
  }
  if (access.state === "UNTRACKED") {
    // Nem pago nem teste renovado: só a regularização individual define.
    return (
      <p className="text-sm text-ink-soft" data-testid="validade-nao-definida">
        Estabelecimento anterior ao controle de validade. Continua operando como antes, com os mesmos recursos, até a
        administração regularizar este estabelecimento individualmente (pagamento, prorrogação do teste ou cortesia).
        Referência do cadastro: o teste de {item.trial.durationDays} dias terminaria em{" "}
        {dataCadastro(item.trial.trialEndAt)}; essa data não foi aplicada.
      </p>
    );
  }
  if (access.state === "MISSING") {
    return (
      <p className="text-sm" data-testid="motivo-vencido">
        Não há período de validade registrado para este estabelecimento, e ele não é anterior ao controle: o acesso fica
        pausado até um registro. Dados e reservas estão preservados.
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
