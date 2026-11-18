"use client";

// Uma movimentação do histórico: tipo, quantidade com sinal, saldo anterior e
// posterior, motivo, responsável e data. Estornar abre o motivo na própria
// linha; o lançamento original nunca muda (o estorno é um novo registro).
import { useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { estornarMovimentacao, novaChaveDeEnvio, type MovimentacaoEstoque } from "@/lib/api/estoque-api";
import { formatarDiferenca, formatarQuantidade } from "@/lib/estoque/quantidade";
import { podeEstornar, ROTULO_TIPO } from "@/lib/estoque/rotulos";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { CLASSE_CAMPO, ErroDoFormulario } from "@/components/estoque/comum";

const DATA_HORA = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function LinhaMovimentacao({
  tenantId,
  movimentacao: m,
  podeOperar,
  aoEstornar,
}: {
  tenantId: string;
  movimentacao: MovimentacaoEstoque;
  podeOperar: boolean;
  aoEstornar: (original: MovimentacaoEstoque, estorno: MovimentacaoEstoque) => void;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const chave = useRef(novaChaveDeEnvio());

  async function estornar() {
    if (enviando || motivo.trim().length < 3) {
      setErro("Informe o motivo do estorno (pelo menos 3 letras).");
      return;
    }
    setEnviando(true);
    setErro(null);
    const r = await estornarMovimentacao(tenantId, m.id, { requestKey: chave.current, reason: motivo.trim() });
    setEnviando(false);
    if (r.ok) {
      setAbrindo(false);
      aoEstornar(m, r.dados);
      return;
    }
    if (r.falha.tipo !== "falha_comunicacao") chave.current = novaChaveDeEnvio();
    setErro(mensagemDaFalha(r.falha));
  }

  return (
    <li className="space-y-2 py-3" data-testid={`movimentacao-${m.id}`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {ROTULO_TIPO[m.kind]}
            {m.reversedByMovementId && <Badge>Estornada</Badge>}
            {m.reversesMovementId && <Badge cor="info">Estorno de um lançamento</Badge>}
          </p>
          <p className="text-sm text-ink">{m.productName}</p>
          {m.reason && <p className="text-sm text-ink-soft">Motivo: {m.reason}</p>}
          <p className="text-xs text-ink-soft">
            {m.recordedBy.name} · {DATA_HORA.format(new Date(m.recordedAt))}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className={`text-sm font-bold ${m.deltaMilli < 0 ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-success)]"}`}>
            {formatarDiferenca(m.deltaMilli, m.unit)}
          </p>
          <p className="text-xs text-ink-soft">
            {formatarQuantidade(m.balanceBeforeMilli, m.unit)} → {formatarQuantidade(m.balanceAfterMilli, m.unit)}
          </p>
        </div>
      </div>
      {podeOperar && podeEstornar(m) && !abrindo && (
        <Botao variante="fantasma" tamanho="sm" onClick={() => setAbrindo(true)}>
          <Undo2 size={14} aria-hidden="true" /> Estornar
        </Botao>
      )}
      {abrindo && (
        <div className="space-y-2 rounded-[var(--radius-control)] bg-paper-muted p-3">
          <label htmlFor={`motivo-estorno-${m.id}`} className="block text-sm font-medium text-ink">
            Motivo do estorno
          </label>
          <input id={`motivo-estorno-${m.id}`} className={CLASSE_CAMPO} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <ErroDoFormulario mensagem={erro} />
          <div className="flex gap-2">
            <Botao variante="fantasma" tamanho="sm" onClick={() => setAbrindo(false)} disabled={enviando}>
              Cancelar
            </Botao>
            <Botao variante="perigo" tamanho="sm" onClick={() => void estornar()} disabled={enviando}>
              {enviando ? "Estornando…" : "Confirmar estorno"}
            </Botao>
          </div>
        </div>
      )}
    </li>
  );
}
