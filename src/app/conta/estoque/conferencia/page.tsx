"use client";

// Conferência de estoque em três etapas: contar (quantidade encontrada de
// cada produto), revisar as diferenças e confirmar. Até a confirmação nenhum
// saldo muda, e a tela diz isso em cada etapa. A confirmação é tudo ou nada e
// a API recusa uma contagem desatualizada (saldo ou unidade mudou): a tela
// marca os itens e volta para a contagem.
//
// O rascunho fica no navegador, isolado por usuário e estabelecimento
// (lib/estoque/rascunho-conferencia.ts): abrir a tela apaga o de outros
// contextos, sem permissão de operar ou com acesso recusado ele é apagado.
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ClipboardCheck } from "lucide-react";
import { confirmarConferencia, itensDesatualizados, novaChaveDeEnvio } from "@/lib/api/estoque-api";
import { caminhoDaCategoria, contar, resumoDaRevisao } from "@/lib/estoque/apresentacao";
import { anotarContagem, confirmarRevisao, itensMarcados, novoRascunho, reconciliar, revisar, type Rascunho, type Revisao } from "@/lib/estoque/conferencia";
import { falhaDeAcesso, mensagemDaFalha } from "@/lib/estoque/mensagens";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { apagarOutrosContextos, apagarRascunho, armazenamentoDaSessao, gravarRascunho, lerRascunho } from "@/lib/estoque/rascunho-conferencia";
import { useCategorias } from "@/lib/estoque/use-categorias";
import { useContextoEstoque } from "@/lib/estoque/use-contexto-estoque";
import { useProdutosParaEscolha } from "@/lib/estoque/use-produtos-para-escolha";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoDeFalha, CLASSE_CAMPO, ErroDoFormulario, NotaInformativa, RotuloNoCelular, SemEstabelecimento, TABELA, trilhaDoEstoque } from "@/components/estoque/comum";
import { EtapasDaConferencia } from "./etapas-conferencia";
import { HistoricoConferencias } from "./historico-conferencias";
import { ConfirmacaoDosAjustes, RevisaoDasDiferencas, SEM_ALTERACAO } from "./revisao-conferencia";

const TITULO = "Conferência de estoque";
const ROTULO_ETAPA = ["Em contagem", "Em revisão", "Pronta para confirmar"] as const;

export default function ConferenciaDoEstoquePage() {
  const ctx = useContextoEstoque();
  const { notificar } = useToast();
  const { tenantId, userId, podeOperar } = ctx;
  const { estado: produtos, recarregar } = useProdutosParaEscolha(tenantId, "ALL");
  const { estado: categorias } = useCategorias(tenantId);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [categoriaId, setCategoriaId] = useState("");
  const [revisao, setRevisao] = useState<Extract<Revisao, { ok: true }> | null>(null);
  const [naConfirmacao, setNaConfirmacao] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [versaoHistorico, setVersaoHistorico] = useState(0);
  const chave = useRef(novaChaveDeEnvio());
  const armazenamento = useMemo(() => armazenamentoDaSessao(), []);

  // Contexto mudou (pessoa, estabelecimento ou permissão): rascunho de outro
  // contexto sai; sem permissão de operar, o deste também.
  useEffect(() => {
    setRascunho(null);
    setRevisao(null);
    setNaConfirmacao(false);
    if (!userId || !tenantId) return;
    apagarOutrosContextos(armazenamento, userId, tenantId);
    if (!podeOperar) apagarRascunho(armazenamento, userId, tenantId);
  }, [armazenamento, userId, tenantId, podeOperar]);

  // Rascunho salvo, conferido contra o estado atual dos produtos.
  useEffect(() => {
    if (!userId || !tenantId || !podeOperar || produtos.status !== "carregada") return;
    const salvo = lerRascunho(armazenamento, userId, tenantId);
    if (salvo) {
      setRascunho(
        reconciliar(
          salvo,
          produtos.produtos.map((p) => ({ productId: p.id, balanceMilli: p.balanceMilli, balanceVersion: p.balanceVersion, unit: p.unit, archived: p.archived })),
          true,
        ),
      );
    }
  }, [armazenamento, userId, tenantId, podeOperar, produtos]);

  useEffect(() => {
    if (rascunho) gravarRascunho(armazenamento, rascunho);
  }, [armazenamento, rascunho]);

  if (!ctx.pronto) return null;
  if (!tenantId || !userId) return <SemEstabelecimento titulo={TITULO} />;
  const listaDeCategorias = categorias.status === "carregada" ? categorias.categorias.filter((c) => !c.archived) : [];
  const caminhos = new Map(produtos.status === "carregada" ? produtos.produtos.map((p) => [p.id, caminhoDaCategoria(p)]) : []);

  function iniciar() {
    if (produtos.status !== "carregada") return;
    const escolhidos = produtos.produtos.filter((p) => !p.archived && (!categoriaId || p.categoryId === categoriaId || p.subcategoryId === categoriaId));
    setRascunho(novoRascunho(userId!, tenantId!, escolhidos));
    chave.current = novaChaveDeEnvio();
  }

  function descartar() {
    apagarRascunho(armazenamento, userId!, tenantId!);
    setRascunho(null);
    setRevisao(null);
    setNaConfirmacao(false);
    setErro(null);
  }

  function irParaRevisao() {
    if (!rascunho) return;
    const r = revisar(rascunho);
    if (!r.ok) return setErros(r.erros);
    setErros({});
    setErro(null);
    setRevisao(r);
    setNaConfirmacao(false);
  }

  /** Volta para a contagem; com um produto, leva o cursor ao campo dele. */
  function voltarParaContagem(productId?: string) {
    setRevisao(null);
    setNaConfirmacao(false);
    if (productId) setTimeout(() => document.getElementById(`contagem-${productId}`)?.focus(), 0);
  }

  async function confirmar() {
    if (!revisao || enviando) return;
    setEnviando(true);
    setErro(null);
    const r = await confirmarConferencia(tenantId!, { requestKey: chave.current, note: nota.trim() || null, items: revisao.envio });
    setEnviando(false);
    if (r.ok) {
      apagarRascunho(armazenamento, userId!, tenantId!);
      setRascunho(null);
      setRevisao(null);
      setNaConfirmacao(false);
      setNota("");
      chave.current = novaChaveDeEnvio();
      setVersaoHistorico((v) => v + 1);
      void recarregar();
      notificar(`Conferência confirmada: ${contar(r.dados.adjustedCount, "ajuste registrado", "ajustes registrados")}.`, "sucesso");
      return;
    }
    if (r.falha.tipo === "falha_comunicacao") return setErro(mensagemDaFalha(r.falha));
    chave.current = novaChaveDeEnvio();
    const desatualizados = itensDesatualizados(r.falha);
    if (desatualizados && rascunho) {
      setRascunho(reconciliar(rascunho, desatualizados));
      voltarParaContagem();
      setErro("O estoque mudou desde a contagem. Os itens destacados precisam ser conferidos de novo. Nenhum saldo foi alterado.");
      return;
    }
    if (falhaDeAcesso(r.falha)) descartar();
    setErro(mensagemDaFalha(r.falha));
  }

  const marcados = rascunho ? itensMarcados(rascunho) : 0;
  const etapa = !rascunho ? 0 : !revisao ? 0 : naConfirmacao ? 2 : 1;
  const resumo = revisao ? resumoDaRevisao(revisao.linhas) : null;
  const comDiferenca = revisao ? revisao.linhas.filter((l) => l.diferencaMilli !== 0) : [];
  const ajustes = contar(resumo?.comDiferenca ?? 0, "movimentação de ajuste", "movimentações de ajuste");

  return (
    <PaginaConta
      trilha={trilhaDoEstoque(TITULO)}
      titulo={TITULO}
      descricao="Compare a contagem física com o saldo registrado."
      acoes={
        rascunho && (
          <Badge cor="aviso" data-testid="situacao-conferencia">
            {ROTULO_ETAPA[etapa]}
          </Badge>
        )
      }
    >
      {produtos.status === "carregando" && <Skeleton className="h-32 w-full" />}
      {produtos.status === "falha" && <AvisoDeFalha falha={produtos.falha} aoTentarDeNovo={() => void recarregar()} />}

      {produtos.status === "carregada" && podeOperar && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <EtapasDaConferencia atual={etapa} />
            <NotaInformativa>
              {rascunho ? "Nenhuma movimentação de estoque foi registrada nesta conferência." : "Escolha o que conferir e comece a contagem. Os saldos só mudam na confirmação."}
            </NotaInformativa>
          </CartaoCorpo>
        </Cartao>
      )}

      {produtos.status === "carregada" && podeOperar && !rascunho && (
        <Cartao>
          <CartaoCorpo className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="conf-categoria" className="block text-sm font-medium text-ink">
                O que conferir
              </label>
              <select id="conf-categoria" className={`${CLASSE_CAMPO} mt-1.5`} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Todos os produtos ativos</option>
                {listaDeCategorias.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    <option value={c.id}>{c.name} (toda a categoria)</option>
                    {c.subcategories
                      .filter((s) => !s.archived)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {c.name} › {s.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <Botao onClick={iniciar}>
              <ClipboardCheck size={16} aria-hidden="true" /> Começar contagem
            </Botao>
          </CartaoCorpo>
        </Cartao>
      )}

      {rascunho && !revisao && (
        <Cartao data-testid="contagem">
          <div className="space-y-1 p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-ink">Conte os produtos</h2>
            <p className="text-sm text-ink-soft">Informe a quantidade encontrada de cada item. Deixe em branco o que não contou.</p>
          </div>
          {rascunho.itens.length === 0 ? (
            <div className="px-4 pb-4">
              <EstadoVazio icone={ClipboardCheck} titulo="Nenhum produto ativo nesta escolha" />
            </div>
          ) : (
            <table className={TABELA.tabela} aria-label="Contagem física">
              <thead className={TABELA.cabecalho}>
                <tr>
                  <th scope="col" className={TABELA.th}>Produto</th>
                  <th scope="col" className={`${TABELA.th} text-right`}>Saldo registrado</th>
                  <th scope="col" className={TABELA.th}>Contagem física</th>
                </tr>
              </thead>
              <tbody className={TABELA.corpo}>
                {rascunho.itens.map((i) => (
                  <tr key={i.productId} data-testid={`contar-${i.productId}`} className={clsx(TABELA.linha, i.situacao !== "ok" && "bg-warning-soft")}>
                    <td className={clsx(TABELA.td, "min-w-0 max-md:col-span-2")}>
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                        {i.nome}
                        {i.situacao === "recontar" && <Badge cor="erro">Contar de novo</Badge>}
                        {i.situacao === "revisar" && <Badge cor="aviso">Saldo mudou</Badge>}
                      </p>
                      {caminhos.get(i.productId) && <p className="text-xs text-ink-soft">{caminhos.get(i.productId)}</p>}
                      {erros[i.productId] && <p className="text-xs font-medium text-[color:var(--color-danger)]">{erros[i.productId]}</p>}
                    </td>
                    <td className={clsx(TABELA.td, "tabular-nums text-ink md:text-right max-md:self-center")}>
                      <RotuloNoCelular>Saldo registrado</RotuloNoCelular>
                      {formatarQuantidade(i.balanceMilli, i.unit)}
                    </td>
                    <td className={TABELA.td}>
                      <div className="flex items-center gap-2 max-md:justify-end">
                        <input
                          id={`contagem-${i.productId}`}
                          aria-label={`Quantidade encontrada de ${i.nome} (${i.unit})`}
                          className={`${CLASSE_CAMPO} w-28 text-right tabular-nums`}
                          inputMode="decimal"
                          value={i.contado}
                          onChange={(e) => setRascunho((r) => (r ? anotarContagem(r, i.productId, e.target.value) : r))}
                        />
                        <span className="w-8 text-sm text-ink-soft">{i.unit}</span>
                        {i.situacao === "revisar" && (
                          <Botao variante="secundaria" tamanho="sm" onClick={() => setRascunho((r) => (r ? confirmarRevisao(r, i.productId) : r))}>
                            Conferido
                          </Botao>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="space-y-3 border-t border-border p-4 sm:p-5">
            {marcados > 0 && (
              <p className="text-sm text-ink" role="status">
                {contar(marcados, "item destacado", "itens destacados")} para conferir de novo.
              </p>
            )}
            <ErroDoFormulario mensagem={erros.geral ?? erro} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Botao variante="secundaria" onClick={descartar}>
                Descartar contagem
              </Botao>
              <p className="text-sm text-ink-soft max-sm:order-last max-sm:w-full">{SEM_ALTERACAO}</p>
              <Botao onClick={irParaRevisao} disabled={rascunho.itens.length === 0}>
                Revisar diferenças
              </Botao>
            </div>
          </div>
        </Cartao>
      )}

      {revisao && resumo && !naConfirmacao && (
        <RevisaoDasDiferencas
          linhas={revisao.linhas}
          resumo={resumo}
          caminhos={caminhos}
          nota={nota}
          setNota={setNota}
          ajustes={ajustes}
          aoRecontar={voltarParaContagem}
          aoContinuar={() => setNaConfirmacao(true)}
        />
      )}

      {revisao && resumo && naConfirmacao && (
        <ConfirmacaoDosAjustes
          resumo={resumo}
          comDiferenca={comDiferenca}
          nota={nota}
          ajustes={ajustes}
          erro={erro}
          enviando={enviando}
          aoVoltar={() => setNaConfirmacao(false)}
          aoConfirmar={() => void confirmar()}
        />
      )}

      {produtos.status !== "falha" && <HistoricoConferencias tenantId={tenantId} versao={versaoHistorico} />}
    </PaginaConta>
  );
}
