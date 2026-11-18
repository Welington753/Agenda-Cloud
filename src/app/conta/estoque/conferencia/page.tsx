"use client";

// Conferência de estoque em três etapas: contar (quantidade encontrada de
// cada produto), revisar as diferenças e confirmar. A confirmação é tudo ou
// nada e a API recusa uma contagem desatualizada (saldo ou unidade mudou):
// a tela marca os itens e pede nova revisão.
//
// O rascunho fica no navegador, isolado por usuário e estabelecimento
// (lib/estoque/rascunho-conferencia.ts): abrir a tela apaga o de outros
// contextos, sem permissão de operar ou com acesso recusado ele é apagado.
import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { confirmarConferencia, itensDesatualizados, novaChaveDeEnvio } from "@/lib/api/estoque-api";
import { anotarContagem, confirmarRevisao, itensMarcados, novoRascunho, reconciliar, revisar, type Rascunho, type Revisao } from "@/lib/estoque/conferencia";
import { falhaDeAcesso, mensagemDaFalha } from "@/lib/estoque/mensagens";
import { formatarDiferenca, formatarQuantidade } from "@/lib/estoque/quantidade";
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
import { AvisoDeFalha, CLASSE_CAMPO, ErroDoFormulario, SemEstabelecimento } from "@/components/estoque/comum";
import { HistoricoConferencias } from "./historico-conferencias";

const TITULO = "Conferência de estoque";

export default function ConferenciaDoEstoquePage() {
  const ctx = useContextoEstoque();
  const { notificar } = useToast();
  const { tenantId, userId, podeOperar } = ctx;
  const { estado: produtos, recarregar } = useProdutosParaEscolha(tenantId, "ALL");
  const { estado: categorias } = useCategorias(tenantId);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [categoriaId, setCategoriaId] = useState("");
  const [revisao, setRevisao] = useState<Extract<Revisao, { ok: true }> | null>(null);
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
    setErro(null);
  }

  function irParaRevisao() {
    if (!rascunho) return;
    const r = revisar(rascunho);
    if (!r.ok) return setErros(r.erros);
    setErros({});
    setErro(null);
    setRevisao(r);
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
      setNota("");
      chave.current = novaChaveDeEnvio();
      setVersaoHistorico((v) => v + 1);
      void recarregar();
      notificar(`Conferência confirmada: ${r.dados.adjustedCount} ajuste(s).`, "sucesso");
      return;
    }
    if (r.falha.tipo === "falha_comunicacao") return setErro(mensagemDaFalha(r.falha));
    chave.current = novaChaveDeEnvio();
    const desatualizados = itensDesatualizados(r.falha);
    if (desatualizados && rascunho) {
      setRascunho(reconciliar(rascunho, desatualizados.map((i) => ({ ...i, productId: i.productId }))));
      setRevisao(null);
      setErro("O estoque mudou desde a contagem. Os itens destacados precisam ser conferidos de novo.");
      return;
    }
    if (falhaDeAcesso(r.falha)) descartar();
    setErro(mensagemDaFalha(r.falha));
  }

  const marcados = rascunho ? itensMarcados(rascunho) : 0;

  return (
    <PaginaConta titulo={TITULO} descricao="Informe a quantidade encontrada, revise a diferença e confirme o ajuste.">
      {produtos.status === "carregando" && <Skeleton className="h-32 w-full" />}
      {produtos.status === "falha" && <AvisoDeFalha falha={produtos.falha} aoTentarDeNovo={() => void recarregar()} />}

      {produtos.status === "carregada" && podeOperar && !rascunho && (
        <Cartao>
          <CartaoCorpo className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="conf-categoria" className="block text-sm font-medium text-ink">O que conferir</label>
              <select id="conf-categoria" className={`${CLASSE_CAMPO} mt-1.5`} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Todos os produtos ativos</option>
                {listaDeCategorias.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    <option value={c.id}>{c.name} (toda a categoria)</option>
                    {c.subcategories.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{c.name} › {s.name}</option>)}
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
          <CartaoCorpo className="space-y-3">
            {rascunho.itens.length === 0 && <EstadoVazio icone={ClipboardCheck} titulo="Nenhum produto ativo nesta escolha" />}
            {marcados > 0 && <p className="text-sm text-ink" role="status">{marcados} item(ns) destacado(s) para conferir de novo.</p>}
            <ul className="divide-y divide-border">
              {rascunho.itens.map((i) => (
                <li key={i.productId} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid={`contar-${i.productId}`}>
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      {i.nome}
                      {i.situacao === "recontar" && <Badge cor="erro">Contar de novo</Badge>}
                      {i.situacao === "revisar" && <Badge cor="aviso">Saldo mudou</Badge>}
                    </p>
                    <p className="text-xs text-ink-soft">No sistema: {formatarQuantidade(i.balanceMilli, i.unit)}</p>
                    {erros[i.productId] && <p className="text-xs text-[color:var(--color-danger)]">{erros[i.productId]}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input aria-label={`Quantidade encontrada de ${i.nome} (${i.unit})`} className={`${CLASSE_CAMPO} w-32`} inputMode="decimal" value={i.contado} onChange={(e) => setRascunho((r) => (r ? anotarContagem(r, i.productId, e.target.value) : r))} />
                    <span className="text-sm text-ink-soft">{i.unit}</span>
                    {i.situacao === "revisar" && <Botao variante="secundaria" tamanho="sm" onClick={() => setRascunho((r) => (r ? confirmarRevisao(r, i.productId) : r))}>Conferido</Botao>}
                  </div>
                </li>
              ))}
            </ul>
            <ErroDoFormulario mensagem={erros.geral ?? erro} />
            <div className="flex flex-wrap justify-end gap-2">
              <Botao variante="fantasma" onClick={descartar}>Descartar contagem</Botao>
              <Botao onClick={irParaRevisao} disabled={rascunho.itens.length === 0}>Revisar diferenças</Botao>
            </div>
          </CartaoCorpo>
        </Cartao>
      )}

      {revisao && (
        <Cartao data-testid="revisao">
          <CartaoCorpo className="space-y-3">
            <h2 className="font-semibold text-ink">Revise antes de confirmar</h2>
            <ul className="divide-y divide-border text-sm">
              {revisao.linhas.map((l) => (
                <li key={l.productId} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span className="text-ink">{l.nome}</span>
                  <span className="text-ink-soft">
                    {formatarQuantidade(l.esperadoMilli, l.unit)} → {formatarQuantidade(l.contadoMilli, l.unit)}{" "}
                    <strong className={l.diferencaMilli === 0 ? "text-ink-soft" : l.diferencaMilli < 0 ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-success)]"}>
                      ({formatarDiferenca(l.diferencaMilli, l.unit)})
                    </strong>
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <label htmlFor="conf-nota" className="block text-sm font-medium text-ink">Observação (motivo dos ajustes, opcional)</label>
              <input id="conf-nota" className={`${CLASSE_CAMPO} mt-1.5`} maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} />
            </div>
            <ErroDoFormulario mensagem={erro} />
            <div className="flex flex-wrap justify-end gap-2">
              <Botao variante="fantasma" onClick={() => setRevisao(null)} disabled={enviando}>Voltar à contagem</Botao>
              <Botao onClick={() => void confirmar()} disabled={enviando}>{enviando ? "Confirmando…" : "Confirmar ajustes"}</Botao>
            </div>
          </CartaoCorpo>
        </Cartao>
      )}

      {produtos.status !== "falha" && <HistoricoConferencias tenantId={tenantId} versao={versaoHistorico} />}
    </PaginaConta>
  );
}
