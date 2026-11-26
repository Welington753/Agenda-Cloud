"use client";

// Vendas do período: as próprias ("Minhas operações", `mine`) ou todas
// ("Vendas", `all`, com a consulta geral). O resumo é de VALOR VENDIDO, que
// não é dinheiro recebido: o recebido fica nos recebimentos de vendas.
//
// Cada venda mostra as duas situações separadas: a da venda (ativa ou
// cancelada) e a do recebimento (a receber, recebida, estornado). Quem pode
// receber recebe dali mesmo; estorno e cancelamento ficam no detalhe.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/api/http-client";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { caminhoListaDeVendas, ehListaDeVendas, type EscopoDeVendas, type ResumoDeVenda } from "@/lib/api/vendas-api";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { formatarMoeda } from "@/lib/format";
import { dataCurta, mesDe, rotuloDoPeriodo, type PeriodoLocal } from "@/lib/conta/inicio";
import { rotaDaVenda } from "@/lib/conta/rotas";
import { deslocar } from "@/lib/profissionais/calendario";
import { hojeNoFuso } from "@/lib/profissionais/agenda-visual";
import {
  ROTULO_SITUACAO_DA_VENDA,
  ROTULO_SITUACAO_DO_RECEBIMENTO,
  corDaSituacaoDoRecebimento,
  hojeParaRecebimento,
  situacaoDoRecebimento,
} from "@/lib/vendas/apresentacao";
import { ReceberVenda } from "./receber-venda";

const MENSAGEM_DE_LEITURA = {
  sessao: "Sua sessão precisa ser verificada novamente. Entre de novo.",
  permissao: "Sua conta não pode ver estas vendas.",
  ausente: "Estabelecimento não encontrado.",
  rede: "Não foi possível conectar ao servidor. Tente novamente.",
  servidor: "Não foi possível carregar as vendas.",
} as const;

export function ListaDeVendas({
  tenantId,
  userId,
  escopo,
  podeReceber,
  podeReceberDeOutros,
  versao,
  aoMudar,
}: {
  tenantId: string;
  userId: string;
  escopo: EscopoDeVendas;
  /** `VENDAS_RECEBER`: receber as próprias vendas. */
  podeReceber: boolean;
  /** `VENDAS_VER_TODAS` também: receber vendas de outras pessoas. */
  podeReceberDeOutros: boolean;
  /** Muda quando outra parte da página gravou algo: relê. */
  versao: number;
  aoMudar: (mensagem: string) => void;
}) {
  const [periodo, setPeriodo] = useState<PeriodoLocal | null>(null);
  const [recebendo, setRecebendo] = useState<string | null>(null);
  const [mais, setMais] = useState<{ itens: ResumoDeVenda[]; cursor: string | null; carregando: boolean; falhou: boolean } | null>(null);
  const { estado, recarregar, anterior } = useLeituraPlataforma(caminhoListaDeVendas(tenantId, { scope: escopo, periodo }), ehListaDeVendas);
  const dados = estado.status === "pronto" ? estado.dados : anterior;

  useEffect(() => {
    if (versao > 0) recarregar();
  }, [versao, recarregar]);
  // Nova leitura da primeira página: a continuação anterior não vale mais.
  useEffect(() => setMais(null), [dados]);

  const atual = periodo ?? dados?.period ?? null;
  const hoje = dados ? hojeNoFuso(dados.timezone, new Date()) : null;
  const vendas = [...(dados?.sales ?? []), ...(mais?.itens ?? [])];
  const proximo = mais ? mais.cursor : (dados?.nextCursor ?? null);

  async function carregarMais() {
    if (!proximo || mais?.carregando) return;
    setMais((m) => ({ itens: m?.itens ?? [], cursor: proximo, carregando: true, falhou: false }));
    const r = await apiRequest<unknown>(caminhoListaDeVendas(tenantId, { scope: escopo, periodo: atual, cursor: proximo }));
    if (r.kind === "success" && ehListaDeVendas(r.data)) {
      const pagina = r.data;
      setMais((m) => ({ itens: [...(m?.itens ?? []), ...pagina.sales], cursor: pagina.nextCursor, carregando: false, falhou: false }));
    } else {
      setMais((m) => ({ itens: m?.itens ?? [], cursor: proximo, carregando: false, falhou: true }));
    }
  }

  return (
    <section className="space-y-4" aria-label={escopo === "mine" ? "Vendas que você registrou" : "Todas as vendas"} data-testid={`vendas-${escopo}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Botao type="button" variante="secundaria" className="min-h-11 min-w-11" aria-label="Mês anterior" disabled={!atual} onClick={() => atual && setPeriodo(mesDe(deslocar("mes", atual.from, -1)))}>
          <ChevronLeft size={16} aria-hidden="true" />
        </Botao>
        <p className="min-w-0 text-sm font-semibold text-ink" data-testid="periodo-vendas">
          {atual ? rotuloDoPeriodo(atual) : "Mês atual"}
        </p>
        <Botao type="button" variante="secundaria" className="min-h-11 min-w-11" aria-label="Próximo mês" disabled={!atual} onClick={() => atual && setPeriodo(mesDe(deslocar("mes", atual.from, 1)))}>
          <ChevronRight size={16} aria-hidden="true" />
        </Botao>
        <Botao type="button" variante="fantasma" className="min-h-11" onClick={recarregar}>
          <RefreshCw size={16} aria-hidden="true" />
          Atualizar
        </Botao>
      </div>

      {!dados && estado.status === "carregando" && <Skeleton className="h-32 w-full" />}
      {!dados && estado.status === "erro" && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <p role="alert" className="text-sm text-ink">
              {MENSAGEM_DE_LEITURA[estado.motivo]}
            </p>
            <Botao type="button" className="min-h-11" onClick={recarregar}>
              Tentar novamente
            </Botao>
          </CartaoCorpo>
        </Cartao>
      )}

      {dados && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="resumo-vendas">
            <Numero rotulo="Vendido no período" valor={formatarMoeda(dados.summary.soldCents)} testId="resumo-vendido" />
            <Numero rotulo="Vendas ativas" valor={String(dados.summary.activeSales)} testId="resumo-ativas" />
            <Numero rotulo="Vendas canceladas" valor={String(dados.summary.cancelledSales)} testId="resumo-canceladas" />
          </div>
          <p className="text-xs text-ink-soft">
            Vendido: soma das vendas ativas registradas no período{escopo === "mine" ? " por você" : ""}. Não é dinheiro recebido: o
            que entrou está nos recebimentos de vendas.
          </p>

          {vendas.length === 0 ? (
            <p className="rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-ink-soft" data-testid="sem-vendas">
              Nenhuma venda neste período.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="lista-vendas">
              {vendas.map((v) => {
                const situacao = situacaoDoRecebimento(v);
                const propria = v.recordedBy.id === userId;
                const podeReceberEsta = v.status === "ATIVA" && situacao !== "recebida" && podeReceber && (propria || podeReceberDeOutros);
                return (
                  <li key={v.id} className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4" data-testid="venda">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-0.5 text-sm">
                        <p className="font-semibold text-ink tabular-nums">
                          <span className={v.status === "CANCELADA" ? "line-through decoration-1" : undefined} data-testid="venda-total">
                            {formatarMoeda(v.totalCents)}
                          </span>{" "}
                          · {v.consumer ? v.consumer.name : "Balcão"}
                        </p>
                        <p className="break-words text-ink-soft">{v.items.map((i) => `${formatarQuantidade(i.quantityMilli, i.unit)} ${i.productName}`).join(", ")}</p>
                        <p className="text-ink-soft">
                          {dataCurta(v.localDate)}
                          {escopo === "all" ? ` · registrada por ${v.recordedBy.name}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Badge cor={v.status === "ATIVA" ? "info" : "neutro"} data-testid="situacao-venda">
                          {ROTULO_SITUACAO_DA_VENDA[v.status]}
                        </Badge>
                        <Badge cor={corDaSituacaoDoRecebimento(situacao)} data-testid="situacao-recebimento">
                          {ROTULO_SITUACAO_DO_RECEBIMENTO[situacao]}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={rotaDaVenda(v.id)} className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-[color:var(--color-accent-hover)] underline" data-testid="ver-venda">
                        Ver detalhe
                      </Link>
                      {podeReceberEsta && recebendo !== v.id && (
                        <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => setRecebendo(v.id)} data-testid="receber-da-lista">
                          Receber
                        </Botao>
                      )}
                    </div>
                    {recebendo === v.id && (
                      <ReceberVenda
                        tenantId={tenantId}
                        venda={v}
                        hoje={hojeParaRecebimento(v.localDate, hoje, new Date())}
                        aoRegistrar={(pagamento, criado) => {
                          setRecebendo(null);
                          aoMudar(criado ? `Recebimento de ${formatarMoeda(pagamento.amountCents)} registrado.` : "Este recebimento já estava registrado.");
                        }}
                        aoCancelar={() => setRecebendo(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {proximo && (
            <div className="space-y-2">
              {mais?.falhou && (
                <p role="alert" className="text-sm text-ink">
                  Não foi possível carregar mais vendas.
                </p>
              )}
              <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => void carregarMais()} disabled={mais?.carregando} aria-busy={mais?.carregando}>
                {mais?.carregando ? "Carregando..." : "Ver mais vendas"}
              </Botao>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Numero({ rotulo, valor, testId }: { rotulo: string; valor: string; testId: string }) {
  return (
    <Cartao data-testid={testId}>
      <CartaoCorpo>
        <p className="text-xs font-medium text-ink-soft">{rotulo}</p>
        <p className="text-xl font-bold break-words text-ink tabular-nums" data-testid={`${testId}-valor`}>
          {valor}
        </p>
      </CartaoCorpo>
    </Cartao>
  );
}
