"use client";

// Cadastro e edição de produto. O saldo nunca é editado aqui: na criação, o
// saldo inicial vira a primeira movimentação; depois, só movimentações mudam
// o saldo. A unidade trava depois da primeira movimentação. Trocar a
// categoria limpa a subcategoria que não é dela.
import { useMemo, useState } from "react";
import type { CategoriaEstoque, DadosDoProduto, ProdutoEstoque } from "@/lib/api/estoque-api";
import { lerQuantidade, MAIOR_SALDO_MILLI, quantidadeParaCampo, UNIDADES, type UnidadeEstoque } from "@/lib/estoque/quantidade";
import { FINALIDADES, type FinalidadeEstoque } from "@/lib/estoque/rotulos";
import { subcategoriaCompativel } from "@/lib/estoque/filtros";
import { Botao } from "@/components/ui/button";
import { Campo, CLASSE_CAMPO, ErroDoFormulario } from "@/components/estoque/comum";

export interface EnvioDoProduto {
  dados: DadosDoProduto;
  initialQuantityMilli: number | null;
}

export function FormularioProduto({
  produto,
  categorias,
  enviando,
  erro,
  aoEnviar,
  aoCancelar,
}: {
  produto: ProdutoEstoque | null;
  categorias: CategoriaEstoque[];
  enviando: boolean;
  erro: string | null;
  aoEnviar: (envio: EnvioDoProduto) => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState(produto?.name ?? "");
  const [descricao, setDescricao] = useState(produto?.description ?? "");
  const [codigo, setCodigo] = useState(produto?.internalCode ?? "");
  const [categoriaId, setCategoriaId] = useState(produto?.categoryId ?? "");
  const [subcategoriaId, setSubcategoriaId] = useState(produto?.subcategoryId ?? "");
  const [finalidade, setFinalidade] = useState<FinalidadeEstoque>(produto?.purpose ?? "AMBOS");
  const [unidade, setUnidade] = useState<UnidadeEstoque>(produto?.unit ?? "UN");
  const [minimo, setMinimo] = useState(produto ? quantidadeParaCampo(produto.minQuantityMilli) : "0");
  const [inicial, setInicial] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const unidadeTravada = !!produto && produto.balanceVersion > 0;

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
    setSubcategoriaId((atual) => subcategoriaCompativel(categorias, id || null, atual || null) ?? "");
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
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
    });
  }

  return (
    <form className="space-y-4" onSubmit={enviar} noValidate>
      <Campo rotulo="Nome" htmlFor="produto-nome" erro={erros.nome}>
        <input id="produto-nome" className={CLASSE_CAMPO} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
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
        </Campo>
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
          <Campo rotulo="Saldo inicial (opcional)" htmlFor="produto-inicial" erro={erros.inicial} ajuda="Vira a primeira movimentação do produto.">
            <input id="produto-inicial" className={CLASSE_CAMPO} inputMode="decimal" value={inicial} onChange={(e) => setInicial(e.target.value)} />
          </Campo>
        )}
      </div>
      <ErroDoFormulario mensagem={erro} />
      <div className="flex flex-wrap justify-end gap-2">
        <Botao type="button" variante="fantasma" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </Botao>
        <Botao type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : produto ? "Salvar alterações" : "Cadastrar produto"}
        </Botao>
      </div>
    </form>
  );
}
