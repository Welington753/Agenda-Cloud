"use client";

// Cadastro e edição de produto. O saldo nunca é editado aqui: na criação, o
// saldo inicial vira a primeira movimentação; depois, só movimentações mudam
// o saldo. A unidade trava depois da primeira movimentação. Trocar a
// categoria limpa a subcategoria que não é dela.
//
// Na criação, "Cadastrar e continuar" usa a mesma validação e o mesmo envio
// de "Cadastrar produto". Quem limpa é a página: só depois do sucesso da API
// ela abre um formulário novo (outra chave de pedido), que chega com `aviso`
// e o foco no Nome. Em erro, nada muda e a chave anterior fica.
//
// Na criação também: "+ Nova categoria" e "+ Nova subcategoria" (da
// categoria escolhida) abrem um campo de nome sem sair do produto; gravou,
// a opção nova já vem escolhida. "Duplicar cadastro" chega como `modelo`
// (lib/estoque/atalhos-produto.ts): os campos vêm preenchidos, sem código
// interno nem saldo inicial, e só o envio cria alguma coisa.
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { CategoriaEstoque, DadosDoProduto, ProdutoEstoque } from "@/lib/api/estoque-api";
import { lerQuantidade, MAIOR_SALDO_MILLI, quantidadeParaCampo, UNIDADES, type UnidadeEstoque } from "@/lib/estoque/quantidade";
import { FINALIDADES, type FinalidadeEstoque } from "@/lib/estoque/rotulos";
import { subcategoriaCompativel } from "@/lib/estoque/filtros";
import type { ModeloDeProduto } from "@/lib/estoque/atalhos-produto";
import { Botao } from "@/components/ui/button";
import { Campo, CLASSE_CAMPO, ErroDoFormulario, NotaInformativa } from "@/components/estoque/comum";
import { AtalhoDeNome, BotaoDeAtalho, type ResultadoDoAtalho } from "./atalho-de-nome";

export interface EnvioDoProduto {
  dados: DadosDoProduto;
  initialQuantityMilli: number | null;
}

export function FormularioProduto({
  produto,
  categorias,
  enviando,
  erro,
  aviso = false,
  modelo = null,
  aoCriarCategoria,
  aoCriarSubcategoria,
  aoEnviar,
  aoCancelar,
}: {
  produto: ProdutoEstoque | null;
  categorias: CategoriaEstoque[];
  enviando: boolean;
  erro: string | null;
  /** O produto anterior foi cadastrado por "Cadastrar e continuar". */
  aviso?: boolean;
  /** "Duplicar cadastro": dados do produto de origem para revisar. */
  modelo?: ModeloDeProduto | null;
  aoCriarCategoria?: (nome: string) => Promise<ResultadoDoAtalho>;
  aoCriarSubcategoria?: (categoriaId: string, nome: string) => Promise<ResultadoDoAtalho>;
  aoEnviar: (envio: EnvioDoProduto, continuar: boolean) => void;
  aoCancelar: () => void;
}) {
  const base = produto ?? modelo;
  const [nome, setNome] = useState(base?.name ?? "");
  const [descricao, setDescricao] = useState(base?.description ?? "");
  const [codigo, setCodigo] = useState(produto?.internalCode ?? "");
  const [categoriaId, setCategoriaId] = useState(base?.categoryId ?? "");
  const [subcategoriaId, setSubcategoriaId] = useState(base?.subcategoryId ?? "");
  const [finalidade, setFinalidade] = useState<FinalidadeEstoque>(base?.purpose ?? "AMBOS");
  const [unidade, setUnidade] = useState<UnidadeEstoque>(base?.unit ?? "UN");
  const [minimo, setMinimo] = useState(base ? quantidadeParaCampo(base.minQuantityMilli) : "0");
  const [atalho, setAtalho] = useState<"categoria" | "subcategoria" | null>(null);
  const [inicial, setInicial] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const unidadeTravada = !!produto && produto.balanceVersion > 0;
  // Atalhos de categoria só na criação (inclusive a cópia).
  const podeCriar = !produto && !!aoCriarCategoria && !!aoCriarSubcategoria;
  const campoNome = useRef<HTMLInputElement>(null);
  // Qual botão de cadastro mostra "Salvando…" (os dois ficam bloqueados).
  const [continuando, setContinuando] = useState(false);

  useEffect(() => {
    if (!aviso && !modelo) return;
    // Na cópia o painel acabou de abrir e põe o foco nele depois deste efeito
    // (efeito do pai roda depois): o Nome recebe o foco na volta seguinte.
    const espera = setTimeout(() => campoNome.current?.focus(), 0);
    return () => clearTimeout(espera);
  }, [aviso, modelo]);

  // Só categorias e subcategorias ativas (e a atual do produto, para ele não
  // perder o vínculo só por abrir o formulário).
  const opcoes = useMemo(
    () => categorias.filter((c) => !c.archived || c.id === produto?.categoryId),
    [categorias, produto?.categoryId],
  );
  const subs = useMemo(
    () => (opcoes.find((c) => c.id === categoriaId)?.subcategories ?? []).filter((s) => !s.archived || s.id === produto?.subcategoryId),
    [opcoes, categoriaId, produto?.subcategoryId],
  );

  function trocarCategoria(id: string) {
    setCategoriaId(id);
    // A subcategoria nova seria da categoria anterior: o campo fecha.
    setAtalho((aberto) => (aberto === "subcategoria" ? null : aberto));
    setSubcategoriaId((atual) => subcategoriaCompativel(categorias, id || null, atual || null) ?? "");
  }

  /** Grava pelo atalho; deu certo, escolhe a opção nova e fecha o campo. */
  async function criarPeloAtalho(nomeNovo: string): Promise<string | null> {
    const r =
      atalho === "categoria" ? await aoCriarCategoria?.(nomeNovo) : atalho === "subcategoria" && categoriaId ? await aoCriarSubcategoria?.(categoriaId, nomeNovo) : undefined;
    if (!r) return null;
    if (!r.ok) return r.erro;
    if (atalho === "categoria") {
      setCategoriaId(r.id);
      setSubcategoriaId("");
      setErros((atuais) => Object.fromEntries(Object.entries(atuais).filter(([campo]) => campo !== "categoria")));
    } else {
      setSubcategoriaId(r.id);
    }
    setAtalho(null);
    return null;
  }

  function enviar(continuar: boolean) {
    if (enviando || atalho) return;
    setContinuando(continuar);
    const novos: Record<string, string> = {};
    if (!nome.trim()) novos.nome = "Informe o nome do produto.";
    if (!categoriaId) novos.categoria = "Escolha a categoria.";
    const lidoMinimo = lerQuantidade(minimo || "0", unidade, { permitirZero: true, maximoMilli: MAIOR_SALDO_MILLI });
    if (!lidoMinimo.ok) novos.minimo = lidoMinimo.erro;
    let inicialMilli: number | null = null;
    if (!produto && inicial.trim()) {
      const lido = lerQuantidade(inicial, unidade, { permitirZero: true });
      if (!lido.ok) novos.inicial = lido.erro;
      else inicialMilli = lido.milli > 0 ? lido.milli : null;
    }
    setErros(novos);
    if (Object.keys(novos).length || !lidoMinimo.ok) return;
    aoEnviar({
      dados: {
        name: nome.trim(),
        description: descricao.trim() || null,
        internalCode: codigo.trim() || null,
        categoryId: categoriaId,
        subcategoryId: subcategoriaId || null,
        purpose: finalidade,
        unit: unidade,
        minQuantityMilli: lidoMinimo.milli,
      },
      initialQuantityMilli: inicialMilli,
    }, continuar);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        enviar(false);
      }}
      noValidate
    >
      {aviso && !erro && Object.keys(erros).length === 0 && (
        <p role="status" data-testid="produto-cadastrado-continuar" className="flex items-start gap-2 rounded-[var(--radius-control)] bg-success-soft px-3 py-2 text-sm text-ink">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[color:var(--color-success)]" aria-hidden="true" />
          <span>Produto cadastrado. Você já pode cadastrar o próximo.</span>
        </p>
      )}
      {modelo && (
        <NotaInformativa destaque data-testid="aviso-copia">
          Revise os dados antes de cadastrar a cópia.
        </NotaInformativa>
      )}
      <Campo rotulo="Nome" htmlFor="produto-nome" erro={erros.nome}>
        <input id="produto-nome" ref={campoNome} className={CLASSE_CAMPO} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
      </Campo>
      <Campo rotulo="Descrição (opcional)" htmlFor="produto-descricao">
        <textarea id="produto-descricao" className={CLASSE_CAMPO} rows={2} value={descricao} maxLength={500} onChange={(e) => setDescricao(e.target.value)} />
      </Campo>
      <Campo rotulo="Código interno (opcional)" htmlFor="produto-codigo">
        <input id="produto-codigo" className={CLASSE_CAMPO} value={codigo} maxLength={40} onChange={(e) => setCodigo(e.target.value)} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Categoria" htmlFor="produto-categoria" erro={erros.categoria}>
          <select id="produto-categoria" className={CLASSE_CAMPO} value={categoriaId} onChange={(e) => trocarCategoria(e.target.value)}>
            <option value="">Escolha…</option>
            {opcoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {podeCriar && (
            <BotaoDeAtalho aoClicar={() => setAtalho("categoria")} disabled={enviando}>
              + Nova categoria
            </BotaoDeAtalho>
          )}
        </Campo>
        <Campo rotulo="Subcategoria (opcional)" htmlFor="produto-subcategoria">
          <select id="produto-subcategoria" className={CLASSE_CAMPO} value={subcategoriaId} disabled={!categoriaId || subs.length === 0} onChange={(e) => setSubcategoriaId(e.target.value)}>
            <option value="">Nenhuma</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {podeCriar && (
            <BotaoDeAtalho aoClicar={() => setAtalho("subcategoria")} disabled={enviando || !categoriaId}>
              + Nova subcategoria
            </BotaoDeAtalho>
          )}
        </Campo>
        {atalho && (
          <AtalhoDeNome
            key={atalho}
            id={`atalho-${atalho}`}
            rotulo={atalho === "categoria" ? "Nome da nova categoria" : `Nova subcategoria em ${opcoes.find((c) => c.id === categoriaId)?.name ?? ""}`}
            enviando={enviando}
            aoSalvar={criarPeloAtalho}
            aoCancelar={() => setAtalho(null)}
          />
        )}
        <Campo rotulo="Finalidade" htmlFor="produto-finalidade">
          <select id="produto-finalidade" className={CLASSE_CAMPO} value={finalidade} onChange={(e) => setFinalidade(e.target.value as FinalidadeEstoque)}>
            {FINALIDADES.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Unidade de medida" htmlFor="produto-unidade" ajuda={unidadeTravada ? "A unidade não muda depois da primeira movimentação." : "Sem conversão entre unidades."}>
          <select id="produto-unidade" className={CLASSE_CAMPO} value={unidade} disabled={unidadeTravada} onChange={(e) => setUnidade(e.target.value as UnidadeEstoque)}>
            {UNIDADES.map((u) => (
              <option key={u.valor} value={u.valor}>
                {u.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Estoque mínimo" htmlFor="produto-minimo" erro={erros.minimo} ajuda="Abaixo ou igual a isto, o produto aparece com estoque baixo. 0 desliga o aviso.">
          <input id="produto-minimo" className={CLASSE_CAMPO} inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
        </Campo>
        {!produto && (
          <Campo rotulo="Saldo inicial (opcional)" htmlFor="produto-inicial" erro={erros.inicial} ajuda="Quantidade que você já tem ao cadastrar este produto.">
            <input id="produto-inicial" className={CLASSE_CAMPO} inputMode="decimal" value={inicial} onChange={(e) => setInicial(e.target.value)} />
          </Campo>
        )}
      </div>
      <ErroDoFormulario mensagem={erro} />
      <div className="flex flex-wrap justify-end gap-2">
        <Botao type="button" variante="fantasma" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
        {!produto && (
          <Botao type="button" variante="secundaria" onClick={() => enviar(true)} disabled={enviando || !!atalho}>
            {enviando && continuando ? "Salvando…" : "Cadastrar e continuar"}
          </Botao>
        )}
        <Botao type="submit" disabled={enviando || !!atalho}>
          {enviando && !continuando ? "Salvando…" : produto ? "Salvar alterações" : "Cadastrar produto"}
        </Botao>
      </div>
    </form>
  );
}
