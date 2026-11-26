"use client";

// Uma movimentação do histórico, como linha da tabela: data e responsável,
// produto, tipo, quantidade com sinal e o saldo antes e depois. Estornar
// abre uma janela com o motivo; o lançamento original nunca muda (o estorno
// é um novo registro).
import { useRef, useState } from "react";
import clsx from "clsx";
import { Undo2 } from "lucide-react";
import { estornarMovimentacao, novaChaveDeEnvio, type MovimentacaoEstoque } from "@/lib/api/estoque-api";
import { corDoTipo } from "@/lib/estoque/apresentacao";
import { formatarDiferenca, formatarQuantidade } from "@/lib/estoque/quantidade";
import { podeEstornar, ROTULO_TIPO } from "@/lib/estoque/rotulos";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { CLASSE_CAMPO, ErroDoFormulario, MenuDeAcoes, RotuloNoCelular, TABELA, type ItemDoMenu } from "@/components/estoque/comum";

const DATA = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const HORA = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });

export function LinhaMovimentacao({
  movimentacao: m,
  podeOperar,
  aoPedirEstorno,
}: {
  movimentacao: MovimentacaoEstoque;
  podeOperar: boolean;
  aoPedirEstorno: (m: MovimentacaoEstoque) => void;
}) {
  const data = new Date(m.recordedAt);
  const itens: ItemDoMenu[] = podeOperar && podeEstornar(m) ? [{ rotulo: "Estornar", icone: Undo2, aoEscolher: () => aoPedirEstorno(m) }] : [];

  return (
    <tr data-testid={`movimentacao-${m.id}`} className={TABELA.linha}>
      <td className={clsx(TABELA.td, "whitespace-nowrap max-md:col-start-1 max-md:row-start-4")}>
        <span className="text-ink">{DATA.format(data)}</span> <span className="text-ink-soft">{HORA.format(data)}</span>
        <p className="text-xs text-ink-soft">{m.recordedBy.name}</p>
      </td>
      <td className={clsx(TABELA.td, "min-w-0 max-md:col-start-1 max-md:row-start-1")}>
        <p className="font-semibold text-ink">{m.productName}</p>
        {m.reason && <p className="text-xs text-ink-soft">Motivo: {m.reason}</p>}
      </td>
      <td className={clsx(TABELA.td, "max-md:col-start-1 max-md:row-start-2")}>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge cor={corDoTipo(m.kind)}>{ROTULO_TIPO[m.kind]}</Badge>
          {m.reversedByMovementId && <Badge>Estornada</Badge>}
          {m.saleId && <Badge>Venda</Badge>}
        </span>
      </td>
      <td className={clsx(TABELA.td, "text-right max-md:col-start-2 max-md:row-start-1")}>
        <span className={clsx("font-bold tabular-nums", m.deltaMilli < 0 ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-success)]")}>
          {formatarDiferenca(m.deltaMilli, m.unit)}
        </span>
      </td>
      <td className={clsx(TABELA.td, "whitespace-nowrap text-ink tabular-nums md:text-right max-md:col-start-1 max-md:row-start-3")} data-testid="saldo-antes-depois">
        <RotuloNoCelular>Saldo</RotuloNoCelular>
        <span className="text-ink-soft">{formatarQuantidade(m.balanceBeforeMilli, m.unit)}</span> → <span className="font-semibold">{formatarQuantidade(m.balanceAfterMilli, m.unit)}</span>
      </td>
      <td className={clsx(TABELA.td, "w-12 text-right max-md:col-start-2 max-md:row-start-2")}>
        <MenuDeAcoes rotulo={`Ações da movimentação de ${m.productName}`} itens={itens} />
      </td>
    </tr>
  );
}

/** Janela do estorno: mostra o efeito no saldo e pede o motivo. Uma chave
 * por janela aberta; recusa definitiva troca a chave, falha de rede não. */
export function JanelaDeEstorno({
  tenantId,
  movimentacao: m,
  aoFechar,
  aoEstornar,
}: {
  tenantId: string;
  movimentacao: MovimentacaoEstoque | null;
  aoFechar: () => void;
  aoEstornar: (original: MovimentacaoEstoque, estorno: MovimentacaoEstoque) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const chave = useRef(novaChaveDeEnvio());

  async function estornar() {
    if (!m || enviando) return;
    if (motivo.trim().length < 3) {
      setErro("Informe o motivo do estorno (pelo menos 3 letras).");
      return;
    }
    setEnviando(true);
    setErro(null);
    const r = await estornarMovimentacao(tenantId, m.id, { requestKey: chave.current, reason: motivo.trim() });
    setEnviando(false);
    if (r.ok) {
      aoEstornar(m, r.dados);
      return;
    }
    if (r.falha.tipo !== "falha_comunicacao") chave.current = novaChaveDeEnvio();
    setErro(mensagemDaFalha(r.falha));
  }

  const fechar = () => !enviando && aoFechar();
  return (
    <Modal
      aberto={m !== null}
      aoFechar={fechar}
      titulo="Estornar movimentação"
      rodape={
        <>
          <Botao variante="secundaria" onClick={fechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao variante="perigo" type="submit" form="form-estorno" disabled={enviando}>
            {enviando ? "Estornando…" : "Confirmar estorno"}
          </Botao>
        </>
      }
    >
      {m && (
        <form
          id="form-estorno"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void estornar();
          }}
        >
          <p className="text-sm text-ink">
            {ROTULO_TIPO[m.kind]} de <strong>{m.productName}</strong> ({formatarDiferenca(m.deltaMilli, m.unit)}). O estorno lança{" "}
            <strong>{formatarDiferenca(-m.deltaMilli, m.unit)}</strong> como um novo registro; o lançamento original fica no histórico.
          </p>
          <div>
            <label htmlFor="motivo-estorno" className="block text-sm font-medium text-ink">
              Motivo do estorno
            </label>
            <input id="motivo-estorno" className={`${CLASSE_CAMPO} mt-1.5`} maxLength={300} value={motivo} autoFocus onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <ErroDoFormulario mensagem={erro} />
        </form>
      )}
    </Modal>
  );
}
