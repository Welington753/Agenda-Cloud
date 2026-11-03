"use client";

// Acesso "sem vencimento" na ficha do estabelecimento (portal da plataforma).
// Concedido e retirado só pelo proprietário da plataforma, com motivo,
// confirmação explícita, senha (a mesma reautenticação) e histórico no
// servidor. Não é pagamento, não muda plano, recursos nem papéis.
//
// Antes de retirar, a tela mostra a consequência calculada pelo servidor
// (`noExpiry.revokePreview`): segue pelos períodos registrados até tal dia,
// ou fica bloqueado. Nada é inventado nem apagado, e a retirada não devolve a
// exceção de anterior ao controle.
import { useState } from "react";
import { InfinityIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useAcaoSensivel } from "./reautenticacao";
import { acaoAdministrativa, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import { dataCadastro, type DetalheEstabelecimento } from "@/lib/administracao/contratos";
import { consequenciaDaRetirada } from "@/lib/administracao/validade";
import { Retorno, useResultado } from "./resultado-acao";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

export function AcessoSemVencimento({ item, aoMudar }: { item: DetalheEstabelecimento; aoMudar: () => void }) {
  const executarSensivel = useAcaoSensivel();
  const { mensagem, ocupado, executar } = useResultado(aoMudar);
  const [acao, setAcao] = useState<"conceder" | "retirar" | null>(null);
  const [chave, setChave] = useState(novaChaveDeFormulario);
  const [motivo, setMotivo] = useState("");
  const [ciente, setCiente] = useState(false);
  const info = item.noExpiry;
  if (!info) return null;
  const acoes = item.allowedActions;
  const vigente = info.active;

  function abrir(nova: "conceder" | "retirar") {
    setChave(novaChaveDeFormulario());
    setMotivo("");
    setCiente(false);
    setAcao(nova);
  }

  const podeConfirmar = motivo.trim().length >= 3 && ciente;

  async function confirmar() {
    if (!acao || !podeConfirmar) return;
    const atual = acao;
    const corpo = { expectedUpdatedAt: item.updatedAt, requestKey: chave, reason: motivo.trim(), confirm: true };
    setAcao(null);
    await executar(
      () =>
        executarSensivel(() =>
          acaoAdministrativa(
            `/platform/establishments/${encodeURIComponent(item.id)}/access/no-expiry${atual === "retirar" ? "/revoke" : ""}`,
            "POST",
            corpo,
          ),
        ),
      atual === "conceder" ? "Acesso sem vencimento concedido." : "Acesso sem vencimento retirado.",
    );
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-3" data-testid="sem-vencimento">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Acesso sem vencimento</h2>
          {vigente ? (
            <Badge cor="destaque">
              <InfinityIcon aria-hidden className="size-3.5" />
              Em vigor
            </Badge>
          ) : (
            <Badge cor="neutro">Não concedido</Badge>
          )}
        </div>
        <p className="text-xs text-ink-soft">
          Exceção concedida pela administração: a validade não vence enquanto estiver em vigor. Não representa pagamento,
          não libera recursos fora do plano e não altera papéis. Inativo continua prevalecendo.
        </p>
        {vigente && (
          <p className="break-words text-sm">
            Concedido em {dataCadastro(vigente.grantedAt)} por {vigente.grantedBy.name}. Motivo: {vigente.reason}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {acoes.grantNoExpiry && (
            <Botao variante="secundaria" className="min-h-11" disabled={ocupado} onClick={() => abrir("conceder")}>
              Conceder sem vencimento
            </Botao>
          )}
          {acoes.revokeNoExpiry && (
            <Botao variante="perigo" className="min-h-11" disabled={ocupado} onClick={() => abrir("retirar")}>
              Retirar sem vencimento
            </Botao>
          )}
        </div>
        <Retorno mensagem={mensagem} />
        {info.history.some((c) => c.revoked) && (
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer py-2 font-medium">Concessões anteriores</summary>
            <ul className="space-y-2">
              {info.history
                .filter((c) => c.revoked)
                .map((c) => (
                  <li key={c.id} className="break-words text-ink-soft">
                    Concedido em {dataCadastro(c.grantedAt)} por {c.grantedBy.name} ({c.reason}); retirado em{" "}
                    {dataCadastro(c.revoked!.at)} por {c.revoked!.by.name} ({c.revoked!.reason}).
                  </li>
                ))}
            </ul>
          </details>
        )}
        <Modal
          aberto={acao !== null}
          aoFechar={() => setAcao(null)}
          titulo={acao === "retirar" ? "Retirar o acesso sem vencimento?" : "Conceder acesso sem vencimento?"}
          rodape={
            <>
              <Botao variante="secundaria" className="min-h-11" onClick={() => setAcao(null)}>
                Cancelar
              </Botao>
              <Botao
                variante={acao === "retirar" ? "perigo" : "primaria"}
                className="min-h-11"
                disabled={!podeConfirmar || ocupado}
                onClick={() => void confirmar()}
              >
                {acao === "retirar" ? "Retirar" : "Conceder"}
              </Botao>
            </>
          }
        >
          <div className="space-y-3" data-testid="form-sem-vencimento">
            {acao === "retirar" ? (
              <p data-testid="consequencia-retirada" className="font-medium">
                {consequenciaDaRetirada(info.revokePreview)}
              </p>
            ) : (
              <p>
                A validade deixa de vencer na próxima requisição, inclusive para quem já está com a sessão aberta. Não é
                registrado pagamento nem criado período.
                {item.status === "SUSPENDED" ? " O estabelecimento continua inativo até ser ativado." : ""}
              </p>
            )}
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
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-5" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
              <span>
                {acao === "retirar"
                  ? "Li a consequência acima e confirmo a retirada."
                  : "Confirmo que isto não é pagamento e não muda plano, recursos ou papéis."}
              </span>
            </label>
          </div>
        </Modal>
      </CartaoCorpo>
    </Cartao>
  );
}
