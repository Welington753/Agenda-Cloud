"use client";

// Nova venda: produtos do catálogo de venda, quantidades, preço (sugerido, ou
// alterado por quem pode), cliente (balcão ou escolhido por toque) e a
// confirmação. Venda e recebimento são operações SEPARADAS:
//
// 1. "Confirmar venda" grava só a venda (estoque baixado, valor vendido).
// 2. Com a venda confirmada, "Receber" registra o dinheiro, à parte. Se o
//    recebimento falhar, a venda continua gravada e só o recebimento é
//    repetido (aqui ou depois, em Minhas operações).
//
// Os totais da tela são prévia; o que vale é a venda que o servidor devolve.
// Resposta perdida: a tela trava e "Enviar de novo" repete a MESMA chave com o
// MESMO conteúdo (lib/vendas/envio.ts). Nenhuma chave nova é gerada para
// repetir uma venda de resultado desconhecido.
import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { acaoAdministrativa, novaChaveDeFormulario } from "@/lib/administracao/api-contas";
import {
  caminhoVendas,
  ehVendaGravada,
  type ClienteDaBusca,
  type CorpoDaVenda,
  type ProdutoParaVenda,
  type RecebimentoDeVenda,
  type Venda,
} from "@/lib/api/vendas-api";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { formatarMoeda } from "@/lib/format";
import { rotaDaVenda } from "@/lib/conta/rotas";
import {
  adicionarProduto,
  alterarLinha,
  aplicarRecusa,
  avaliarCarrinho,
  corpoDaVenda,
  produtosDaRecusa,
  removerLinha,
  type LinhaDoCarrinho,
} from "@/lib/vendas/carrinho";
import { concluirEnvio, formularioTravado, iniciarEnvio, novoEnvio, type EstadoDoEnvio } from "@/lib/vendas/envio";
import { hojeParaRecebimento, mensagemDaRecusa, rotuloDoCliente } from "@/lib/vendas/apresentacao";
import { CatalogoDeVenda } from "./catalogo-de-venda";
import { EscolhaDeCliente } from "./escolha-de-cliente";
import { LinhaDaVenda } from "./linha-da-venda";
import { ReceberVenda } from "./receber-venda";

const CODIGOS_POR_PRODUTO = new Set(["PRECO_ALTERADO", "UNIDADE_ALTERADA", "SALDO_INSUFICIENTE"]);

export function NovaVenda({
  tenantId,
  podeAlterarPreco,
  podeReceber,
  aoMudar,
}: {
  tenantId: string;
  podeAlterarPreco: boolean;
  podeReceber: boolean;
  /** Avisa a página (outras abas releem). */
  aoMudar: () => void;
}) {
  const [linhas, setLinhas] = useState<LinhaDoCarrinho[]>([]);
  const [cliente, setCliente] = useState<ClienteDaBusca | null>(null);
  const [envio, setEnvio] = useState<EstadoDoEnvio<CorpoDaVenda>>(() => novoEnvio(novaChaveDeFormulario()));
  const [aviso, setAviso] = useState<string | null>(null);
  const [concluida, setConcluida] = useState<{ venda: Venda; criada: boolean; recebimento: RecebimentoDeVenda | null } | null>(null);
  const emVoo = useRef(false);
  const travado = formularioTravado(envio);
  const avaliado = avaliarCarrinho(linhas, podeAlterarPreco);

  function adicionar(produto: ProdutoParaVenda) {
    const r = adicionarProduto(linhas, produto);
    setLinhas(r.linhas);
    setAviso(r.resultado === "ja-no-carrinho" ? `${produto.name} já está na venda: ajuste a quantidade na linha.` : r.resultado === "limite" ? "Uma venda aceita até 50 produtos." : null);
  }

  async function confirmar() {
    if (emVoo.current) return;
    const inicio = iniciarEnvio(envio, (chave) => corpoDaVenda(avaliado, cliente?.id ?? null, chave));
    if (!inicio) return;
    emVoo.current = true;
    setEnvio(inicio.estado);
    setAviso(null);
    const r = await acaoAdministrativa(caminhoVendas(tenantId), "POST", inicio.corpo);
    emVoo.current = false;
    if (r.tipo === "ok" && ehVendaGravada(r.dados)) {
      setConcluida({ venda: r.dados.sale, criada: r.dados.created, recebimento: null });
      aoMudar();
      return;
    }
    if (r.tipo === "ok") {
      setEnvio(concluirEnvio(inicio.estado, { tipo: "rede" }));
      return;
    }
    const proximo = concluirEnvio(inicio.estado, r);
    setEnvio(proximo);
    if (proximo.fase === "recusado" && r.tipo === "conflito") {
      if (r.codigo && CODIGOS_POR_PRODUTO.has(r.codigo)) setLinhas((atuais) => aplicarRecusa(atuais, r.codigo, produtosDaRecusa(r.dados), formatarQuantidade));
      if (r.codigo === "CLIENTE_UNIFICADO" || r.codigo === "CLIENTE_NAO_ENCONTRADO") setCliente(null);
    }
  }

  /** Só depois de um resultado confirmado: outra venda, com outra chave. */
  function novaVenda() {
    setLinhas([]);
    setCliente(null);
    setAviso(null);
    setConcluida(null);
    setEnvio(novoEnvio(novaChaveDeFormulario()));
  }

  if (concluida) {
    const { venda, criada, recebimento } = concluida;
    return (
      <section aria-labelledby="titulo-venda-concluida" className="space-y-4" data-testid="venda-concluida">
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <h2 id="titulo-venda-concluida" className="flex items-center gap-2 text-base font-semibold text-ink">
              <CheckCircle2 size={18} aria-hidden="true" className="text-[color:var(--color-success)]" />
              {criada ? "Venda registrada" : "Esta venda já estava registrada"}
            </h2>
            {!criada && <p className="text-sm text-ink-soft">O pedido repetido devolveu a venda original; nenhuma venda nova foi criada.</p>}
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-soft">Valor vendido (confirmado pelo servidor)</dt>
                <dd className="text-lg font-bold text-ink tabular-nums" data-testid="total-confirmado">
                  {formatarMoeda(venda.totalCents)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-soft">Cliente</dt>
                <dd className="break-words text-ink">{venda.consumer ? venda.consumer.name : "Balcão (sem cliente)"}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">Recebimento</dt>
                <dd className="text-ink" data-testid="situacao-recebimento-concluida">
                  {recebimento || venda.activePaymentId ? "Recebida" : "A receber"}
                </dd>
              </div>
            </dl>
            <ul className="text-sm text-ink-soft">
              {venda.items.map((i) => (
                <li key={i.position} className="break-words">
                  {formatarQuantidade(i.quantityMilli, i.unit)} · {i.productName} · {formatarMoeda(i.lineTotalCents)}
                </li>
              ))}
            </ul>
          </CartaoCorpo>
        </Cartao>

        {recebimento ? (
          <p role="status" className="rounded-[var(--radius-card)] bg-success-soft p-3 text-sm text-ink" data-testid="recebimento-registrado">
            Recebimento de {formatarMoeda(recebimento.amountCents)} registrado.
          </p>
        ) : venda.activePaymentId ? null : podeReceber && venda.status === "ATIVA" ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Receber agora</h3>
            <ReceberVenda
              tenantId={tenantId}
              venda={venda}
              hoje={hojeParaRecebimento(venda.localDate, venda.localDate, new Date())}
              aoRegistrar={(pagamento) => {
                setConcluida({ ...concluida, recebimento: pagamento });
                aoMudar();
              }}
            />
          </div>
        ) : (
          <p className="text-sm text-ink-soft">O recebimento desta venda fica com quem pode receber.</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Botao type="button" className="min-h-11" onClick={novaVenda} data-testid="nova-venda">
            Nova venda
          </Botao>
          <Link href={rotaDaVenda(venda.id)} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-[color:var(--color-accent-hover)] underline">
            Ver detalhe da venda
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6" data-testid="nova-venda-form">
      <CatalogoDeVenda tenantId={tenantId} desativado={travado} noCarrinho={linhas.map((l) => l.productId)} aoAdicionar={adicionar} />

      <section aria-labelledby="titulo-carrinho" className="space-y-3">
        <h2 id="titulo-carrinho" className="text-base font-semibold text-ink">
          Produtos da venda
        </h2>
        {aviso && (
          <p role="status" className="text-sm text-ink">
            {aviso}
          </p>
        )}
        {linhas.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-ink-soft" data-testid="carrinho-vazio">
            Nenhum produto escolhido. Toque em “Adicionar” num produto acima.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="carrinho">
            {avaliado.linhas.map((l) => (
              <LinhaDaVenda
                key={l.productId}
                linha={l}
                desativado={travado}
                podeAlterarPreco={podeAlterarPreco}
                aoMudar={(m) => setLinhas((atuais) => alterarLinha(atuais, l.productId, m))}
                aoRemover={() => setLinhas((atuais) => removerLinha(atuais, l.productId))}
              />
            ))}
          </ul>
        )}
      </section>

      <EscolhaDeCliente tenantId={tenantId} cliente={cliente} aoEscolher={setCliente} desativado={travado} />

      <section className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4" aria-label="Confirmação">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-ink-soft">Total da venda (prévia; o servidor confirma)</p>
          <p className="text-xl font-bold text-ink tabular-nums" data-testid="total-previa">
            {avaliado.totalCentavos === null ? "—" : formatarMoeda(avaliado.totalCentavos)}
          </p>
        </div>
        <p className="text-xs text-ink-soft">
          {cliente ? `Cliente: ${rotuloDoCliente(cliente)}.` : "Venda de balcão, sem cliente."} Confirmar registra a venda e baixa o
          estoque; o recebimento é registrado depois, à parte.
        </p>
        {linhas.length > 0 && avaliado.problema && !travado && <p className="text-sm text-ink">{avaliado.problema}</p>}
        {envio.fase === "recusado" && (
          <p role="alert" className="text-sm text-ink" data-testid="erro-venda">
            {mensagemDaRecusa(envio.resultado)} Nada foi gravado.
          </p>
        )}
        {envio.fase === "incerto" && (
          <p role="alert" className="text-sm text-ink" data-testid="venda-incerta">
            Não foi possível confirmar com o servidor. A venda pode ter sido gravada. “Enviar de novo” repete exatamente o mesmo
            pedido: se ele já foi gravado, o servidor devolve a mesma venda, sem criar outra.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Botao
            type="button"
            className="min-h-11"
            onClick={() => void confirmar()}
            disabled={envio.fase === "enviando" || (!travado && !!avaliado.problema)}
            aria-busy={envio.fase === "enviando"}
            data-testid="confirmar-venda"
          >
            {envio.fase === "enviando" ? "Registrando..." : envio.fase === "incerto" ? "Enviar de novo" : "Confirmar venda"}
          </Botao>
        </div>
      </section>
    </div>
  );
}
