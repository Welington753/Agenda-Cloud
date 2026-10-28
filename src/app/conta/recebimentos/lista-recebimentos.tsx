"use client";

// Recebimentos do período, com o estorno. Estornar pede o motivo e a senha
// do dono (a mesma reconfirmação das mudanças sensíveis); o registro
// original continua na lista, marcado como estornado.
import { useState } from "react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAcaoSensivel } from "@/components/administracao/reautenticacao";
import { acaoAdministrativa, mensagemDoResultado } from "@/lib/administracao/api-contas";
import { ROTULO_FORMA, caminhoRecebimentos, type Recebimento } from "@/lib/api/recebimentos-api";
import { formatarMoeda } from "@/lib/format";
import { dataCurta } from "@/lib/conta/inicio";

export function ListaRecebimentos({
  tenantId,
  recebimentos,
  podeEstornar = true,
  aoMudar,
}: {
  tenantId: string;
  recebimentos: readonly Recebimento[];
  /** `false`: o gerente consulta sem estornar. */
  podeEstornar?: boolean;
  aoMudar: (mensagem: string) => void;
}) {
  const executarSensivel = useAcaoSensivel();
  const [estornando, setEstornando] = useState<Recebimento | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function estornar() {
    if (!estornando || ocupado || motivo.trim().length < 3) return;
    setOcupado(true);
    setErro(null);
    const r = await executarSensivel(() =>
      acaoAdministrativa(`${caminhoRecebimentos(tenantId)}/${encodeURIComponent(estornando.id)}/refund`, "POST", {
        reason: motivo.trim(),
      }),
    );
    setOcupado(false);
    if (r.tipo === "ok") {
      setEstornando(null);
      setMotivo("");
      aoMudar("Recebimento estornado. O registro original continua no histórico.");
    } else {
      setErro(r.tipo === "rede" ? "Não foi possível confirmar o estorno. Atualize a lista antes de repetir." : mensagemDoResultado(r));
    }
  }

  if (recebimentos.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-ink-soft" data-testid="sem-recebimentos">
        Nenhum recebimento registrado neste período.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-2" data-testid="lista-recebimentos">
        {recebimentos.map((r) => (
          <li
            key={r.id}
            data-testid="recebimento"
            className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-0.5 text-sm">
              <p className="font-semibold text-ink">
                <span className={r.refund ? "line-through decoration-1" : undefined} data-testid="recebimento-valor">
                  {formatarMoeda(r.amountCents)}
                </span>{" "}
                · {ROTULO_FORMA[r.method]}
              </p>
              <p className="break-words text-ink">
                {r.appointment.consumerName} · {r.appointment.serviceName}
              </p>
              <p className="text-ink-soft">
                Atendimento de {dataCurta(r.appointment.localDate)} às {r.appointment.localStart} · recebido em{" "}
                {dataCurta(r.receivedOn)} · registrado por {r.recordedBy.name}
              </p>
              {r.notes && <p className="break-words text-ink-soft">{r.notes}</p>}
              {r.refund && (
                <p className="break-words text-ink-soft" data-testid="recebimento-estorno">
                  Estornado em {dataCurta(r.refund.refundedOn)} por {r.refund.refundedBy.name}: {r.refund.reason}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {r.refund ? (
                <Badge cor="neutro">Estornado</Badge>
              ) : (
                <>
                  <Badge cor="sucesso">Recebido</Badge>
                  <Botao
                    type="button"
                    variante="fantasma"
                    className="min-h-11"
                    hidden={!podeEstornar}
                    onClick={() => {
                      setErro(null);
                      setMotivo("");
                      setEstornando(r);
                    }}
                  >
                    Estornar
                  </Botao>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Modal
        aberto={estornando !== null}
        aoFechar={() => !ocupado && setEstornando(null)}
        titulo="Estornar o recebimento?"
        rodape={
          <>
            <Botao variante="secundaria" className="min-h-11" onClick={() => setEstornando(null)} disabled={ocupado}>
              Cancelar
            </Botao>
            <Botao
              variante="perigo"
              className="min-h-11"
              onClick={() => void estornar()}
              disabled={ocupado || motivo.trim().length < 3}
              data-testid="confirmar-estorno"
            >
              {ocupado ? "Estornando..." : "Estornar"}
            </Botao>
          </>
        }
      >
        {estornando && (
          <div className="space-y-3">
            <p>
              O estorno é do valor inteiro ({formatarMoeda(estornando.amountCents)}) e entra no período de hoje. O
              registro original não é apagado. O atendimento volta a aguardar quitação.
            </p>
            <label className="block text-sm font-medium">
              Motivo
              <input
                className="mt-1 min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm"
                maxLength={300}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </label>
            {erro && (
              <p role="alert" className="text-sm">
                {erro}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
