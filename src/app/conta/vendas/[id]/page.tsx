"use client";

// Detalhe da venda (`/conta/vendas/[id]`): itens com os preços congelados, o
// valor vendido, a situação da venda e a do recebimento (separadas), o
// histórico de recebimentos e as ações que a sessão pode fazer:
//
// - receber (integral, sem valor digitado);
// - estornar o recebimento ativo (motivo + senha confirmada há pouco);
// - cancelar a venda (motivo + senha; só sem recebimento ativo: estorne
//   antes). O cancelamento devolve as quantidades ao estoque.
//
// Estorno e cancelamento repetidos com o MESMO motivo devolvem o registro já
// gravado; por isso, sem resposta, o motivo fica travado e "Repetir" reenvia
// o mesmo conteúdo. Venda que a pessoa não pode ver responde 404.
import { useState } from "react";
import { useParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useRealAuth } from "@/lib/auth/real-auth-context";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { ReautenticacaoProvider } from "@/components/administracao/reautenticacao";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ROTULO_FORMA } from "@/lib/api/recebimentos-api";
import { caminhoDaVenda, ehVenda } from "@/lib/api/vendas-api";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { formatarMoeda } from "@/lib/format";
import { dataCurta } from "@/lib/conta/inicio";
import { ROTA_VENDAS } from "@/lib/conta/rotas";
import { useAreas } from "@/lib/conta/use-areas";
import {
  ROTULO_SITUACAO_DA_VENDA,
  ROTULO_SITUACAO_DO_RECEBIMENTO,
  acoesDaVenda,
  corDaSituacaoDoRecebimento,
  hojeParaRecebimento,
  situacaoDoRecebimentoNoDetalhe,
} from "@/lib/vendas/apresentacao";
import { ReceberVenda } from "../receber-venda";
import { JanelaDeCorrecao } from "./janela-de-correcao";

const MENSAGEM_DE_LEITURA = {
  sessao: "Sua sessão precisa ser verificada novamente. Entre de novo.",
  permissao: "Sua conta não pode ver esta venda.",
  ausente: "Venda não encontrada, ou fora do que sua conta pode ver.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar a venda.",
} as const;

export default function DetalheDaVendaPage() {
  return (
    <ReautenticacaoProvider>
      <Detalhe />
    </ReautenticacaoProvider>
  );
}

function Detalhe() {
  const { estado: sessao } = useRealAuth();
  const { id } = useParams<{ id: string }>();
  const tem = useAreas();
  const { notificar } = useToast();
  const tenantId = sessao.status === "autenticado" ? sessao.tenantIdAtivo : null;
  const userId = sessao.status === "autenticado" ? sessao.sessao.user.id : null;
  const { estado, recarregar, anterior } = useLeituraPlataforma(tenantId && id ? caminhoDaVenda(tenantId, id) : null, ehVenda);
  const venda = estado.status === "pronto" ? estado.dados : anterior;
  const [recebendo, setRecebendo] = useState(false);
  const [operacao, setOperacao] = useState<"cancelar" | "estornar" | null>(null);

  if (sessao.status !== "autenticado" || !tenantId || !userId) return null;
  const voltar = { href: ROTA_VENDAS, rotulo: "Voltar para Vendas" };

  if (!venda) {
    return (
      <PaginaConta titulo="Venda" voltar={voltar}>
        {estado.status === "carregando" && <Skeleton className="h-48 w-full" />}
        {estado.status === "erro" && (
          <Cartao>
            <CartaoCorpo className="space-y-3">
              <p role="alert" className="text-sm text-ink" data-testid="erro-detalhe-venda">
                {MENSAGEM_DE_LEITURA[estado.motivo]}
              </p>
              <Botao type="button" className="min-h-11" onClick={recarregar}>
                Tentar novamente
              </Botao>
            </CartaoCorpo>
          </Cartao>
        )}
      </PaginaConta>
    );
  }

  const situacao = situacaoDoRecebimentoNoDetalhe(venda);
  const acoes = acoesDaVenda(venda, userId, tem);
  const ativo = venda.payments.find((p) => p.id === venda.activePaymentId) ?? null;

  function concluiu(mensagem: string) {
    setOperacao(null);
    setRecebendo(false);
    notificar(mensagem, "sucesso");
    recarregar();
  }

  return (
    <PaginaConta
      titulo={`Venda de ${dataCurta(venda.localDate)}`}
      descricao={venda.consumer ? `Cliente: ${venda.consumer.name}` : "Venda de balcão, sem cliente."}
      voltar={voltar}
      acoes={
        <Botao type="button" variante="secundaria" className="min-h-11" onClick={recarregar}>
          <RefreshCw size={16} aria-hidden="true" />
          Atualizar
        </Botao>
      }
    >
      <Cartao>
        <CartaoCorpo className="space-y-4" data-testid="detalhe-venda">
          <div className="flex flex-wrap items-center gap-2">
            <Badge cor={venda.status === "ATIVA" ? "info" : "neutro"} data-testid="situacao-venda">
              {ROTULO_SITUACAO_DA_VENDA[venda.status]}
            </Badge>
            <Badge cor={corDaSituacaoDoRecebimento(situacao)} data-testid="situacao-recebimento">
              {ROTULO_SITUACAO_DO_RECEBIMENTO[situacao]}
            </Badge>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-ink-soft">Valor vendido</dt>
              <dd className="text-lg font-bold text-ink tabular-nums" data-testid="detalhe-total">
                {formatarMoeda(venda.totalCents)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">Recebido</dt>
              <dd className="text-lg font-bold text-ink tabular-nums" data-testid="detalhe-recebido">
                {ativo ? formatarMoeda(ativo.amountCents) : formatarMoeda(0)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">Registrada por</dt>
              <dd className="break-words text-ink">{venda.recordedBy.name}</dd>
            </div>
          </dl>
          <div>
            <h2 className="text-sm font-semibold text-ink">Itens</h2>
            <ul className="mt-1 divide-y divide-border text-sm" data-testid="itens-venda">
              {venda.items.map((i) => (
                <li key={i.position} className="flex flex-col gap-1 py-2 sm:flex-row sm:justify-between">
                  <span className="min-w-0 break-words text-ink">
                    {formatarQuantidade(i.quantityMilli, i.unit)} · {i.productName}
                  </span>
                  <span className="text-ink-soft tabular-nums">
                    {formatarMoeda(i.unitPriceCents)} / {i.unit}
                    {i.suggestedPriceCents !== null && i.suggestedPriceCents !== i.unitPriceCents && ` (sugerido ${formatarMoeda(i.suggestedPriceCents)})`}
                    {i.suggestedPriceCents === null && " (sem preço sugerido)"} · <strong className="text-ink">{formatarMoeda(i.lineTotalCents)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {venda.cancellation && (
            <p className="rounded-lg bg-paper-muted p-3 text-sm text-ink" data-testid="cancelamento">
              Cancelada em {new Date(venda.cancellation.cancelledAt).toLocaleDateString("pt-BR")} por {venda.cancellation.cancelledBy.name}:{" "}
              {venda.cancellation.reason}. As quantidades voltaram ao estoque.
            </p>
          )}
        </CartaoCorpo>
      </Cartao>

      <section aria-labelledby="titulo-recebimentos-venda" className="space-y-3">
        <h2 id="titulo-recebimentos-venda" className="text-base font-semibold text-ink">
          Recebimento
        </h2>
        {venda.payments.length === 0 ? (
          <p className="text-sm text-ink-soft">Nenhum recebimento registrado para esta venda.</p>
        ) : (
          <ul className="space-y-2" data-testid="recebimentos-da-venda">
            {venda.payments.map((p) => (
              <li key={p.id} className="space-y-1 rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm" data-testid="recebimento-da-venda">
                <p className="font-semibold text-ink tabular-nums">
                  <span className={p.refund ? "line-through decoration-1" : undefined}>{formatarMoeda(p.amountCents)}</span> · {ROTULO_FORMA[p.method]} ·{" "}
                  {p.refund ? "Estornado" : "Recebido"}
                </p>
                <p className="text-ink-soft">
                  Recebido em {dataCurta(p.receivedOn)} · registrado por {p.recordedBy.name}
                </p>
                {p.notes && <p className="break-words text-ink-soft">{p.notes}</p>}
                {p.refund && (
                  <p className="break-words text-ink-soft">
                    Estornado em {dataCurta(p.refund.refundedOn)} por {p.refund.refundedBy.name}: {p.refund.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {acoes.receber &&
          (recebendo ? (
            <ReceberVenda
              tenantId={tenantId}
              venda={venda}
              hoje={hojeParaRecebimento(venda.localDate, null, new Date())}
              aoRegistrar={(p, criado) => concluiu(criado ? `Recebimento de ${formatarMoeda(p.amountCents)} registrado.` : "Este recebimento já estava registrado.")}
              aoCancelar={() => setRecebendo(false)}
            />
          ) : (
            <Botao type="button" className="min-h-11" onClick={() => setRecebendo(true)} data-testid="receber-venda-detalhe">
              Receber {formatarMoeda(venda.totalCents)}
            </Botao>
          ))}
      </section>

      {(acoes.estornar || acoes.cancelar || acoes.cancelarDependeDeEstorno) && (
        <section aria-labelledby="titulo-correcoes" className="space-y-3">
          <h2 id="titulo-correcoes" className="text-base font-semibold text-ink">
            Correções
          </h2>
          <div className="flex flex-wrap gap-2">
            {acoes.estornar && (
              <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => setOperacao("estornar")} data-testid="estornar-recebimento-venda">
                Estornar recebimento
              </Botao>
            )}
            {acoes.cancelar && (
              <Botao type="button" variante="perigo" className="min-h-11" onClick={() => setOperacao("cancelar")} data-testid="cancelar-venda">
                Cancelar venda
              </Botao>
            )}
          </div>
          {acoes.cancelarDependeDeEstorno && (
            <p className="text-sm text-ink-soft" data-testid="cancelar-depende-de-estorno">
              Para cancelar esta venda, estorne antes o recebimento.
            </p>
          )}
          <p className="text-xs text-ink-soft">Estorno e cancelamento pedem um motivo e a confirmação da sua senha. Nada é apagado: o histórico fica.</p>
        </section>
      )}

      {operacao && (
        <JanelaDeCorrecao
          key={operacao}
          operacao={operacao}
          tenantId={tenantId}
          venda={venda}
          paymentId={venda.activePaymentId}
          aoFechar={() => setOperacao(null)}
          aoConcluir={concluiu}
        />
      )}
    </PaginaConta>
  );
}
