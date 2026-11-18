"use client";

// Categorias e subcategorias do estoque (um nível de subcategoria, opcional).
// À esquerda a árvore; à direita o detalhe da categoria escolhida, com as
// subcategorias e os produtos dela. Nada é apagado, só arquivado. Quem só
// consulta (gerente com "Ver estoque") vê tudo sem os botões.
import { useEffect, useRef, useState } from "react";
import { FolderTree, Plus } from "lucide-react";
import {
  criarCategoria,
  criarSubcategoria,
  renomearCategoria,
  renomearSubcategoria,
  situacaoDaCategoria,
  situacaoDaSubcategoria,
  type CategoriaEstoque,
  type ResultadoEstoque,
  type SubcategoriaEstoque,
} from "@/lib/api/estoque-api";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { useCategorias } from "@/lib/estoque/use-categorias";
import { useContextoEstoque } from "@/lib/estoque/use-contexto-estoque";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoDeFalha, JanelaDeNome, SemEstabelecimento, trilhaDoEstoque } from "@/components/estoque/comum";
import { ArvoreDeCategorias, type Selecao } from "./arvore-categorias";
import { DetalheDaCategoria, type ErroDaCategoria } from "./detalhe-categoria";

const TITULO = "Categorias e subcategorias";

type Janela =
  | { tipo: "fechada" }
  | { tipo: "nova-categoria" }
  | { tipo: "renomear-categoria"; categoria: CategoriaEstoque }
  | { tipo: "nova-subcategoria"; categoria: CategoriaEstoque }
  | { tipo: "renomear-subcategoria"; sub: SubcategoriaEstoque };

const TEXTOS_DA_JANELA = {
  "nova-categoria": { titulo: "Nova categoria", rotulo: "Nome da nova categoria", botao: "Criar categoria" },
  "renomear-categoria": { titulo: "Editar categoria", rotulo: "Nome da categoria", botao: "Salvar" },
  "nova-subcategoria": { titulo: "Nova subcategoria", rotulo: "Nome da nova subcategoria", botao: "Salvar" },
  "renomear-subcategoria": { titulo: "Renomear subcategoria", rotulo: "Nome da subcategoria", botao: "Salvar" },
} as const;

export default function CategoriasDoEstoquePage() {
  const ctx = useContextoEstoque();
  const { estado, recarregar, substituir } = useCategorias(ctx.tenantId);
  const { notificar } = useToast();
  const [gravando, setGravando] = useState(false);
  const travado = useRef(false);
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  const [janela, setJanela] = useState<Janela>({ tipo: "fechada" });
  const [erroJanela, setErroJanela] = useState<string | null>(null);
  const [erro, setErro] = useState<ErroDaCategoria | null>(null);

  useEffect(() => {
    setSelecao(null);
    setJanela({ tipo: "fechada" });
    setErro(null);
  }, [ctx.tenantId]);

  if (!ctx.pronto) return null;
  if (!ctx.tenantId) return <SemEstabelecimento titulo={TITULO} />;
  const tenantId = ctx.tenantId;

  // Sem escolha (ou escolha que sumiu da lista visível): a primeira categoria.
  const categorias = estado.status === "carregada" ? estado.categorias : [];
  const visiveis = categorias.filter((c) => mostrarArquivadas || !c.archived);
  const escolhida = visiveis.find((c) => c.id === selecao?.categoriaId) ?? visiveis[0] ?? null;
  const subEscolhida = escolhida && selecao?.categoriaId === escolhida.id ? selecao.subcategoriaId : null;

  /** Uma gravação por vez; a categoria devolvida substitui a da lista. */
  async function gravar(acao: () => Promise<ResultadoEstoque<CategoriaEstoque>>): Promise<ResultadoEstoque<CategoriaEstoque> | null> {
    if (travado.current) return null;
    travado.current = true;
    setGravando(true);
    try {
      const r = await acao();
      if (r.ok) substituir(r.dados);
      return r;
    } finally {
      travado.current = false;
      setGravando(false);
    }
  }

  async function aoSalvarJanela(nome: string) {
    if (janela.tipo === "fechada") return;
    setErroJanela(null);
    const atual = janela;
    const r = await gravar(() => {
      switch (atual.tipo) {
        case "nova-categoria":
          return criarCategoria(tenantId, nome);
        case "renomear-categoria":
          return renomearCategoria(tenantId, atual.categoria.id, nome);
        case "nova-subcategoria":
          return criarSubcategoria(tenantId, atual.categoria.id, nome);
        case "renomear-subcategoria":
          return renomearSubcategoria(tenantId, atual.sub.id, nome);
      }
    });
    if (!r) return;
    if (!r.ok) {
      setErroJanela(mensagemDaFalha(r.falha));
      return;
    }
    setJanela({ tipo: "fechada" });
    setErro(null);
    if (atual.tipo === "nova-categoria") {
      setSelecao({ categoriaId: r.dados.id, subcategoriaId: null });
      notificar("Categoria criada.", "sucesso");
    } else if (atual.tipo === "nova-subcategoria") {
      notificar("Subcategoria criada.", "sucesso");
    } else {
      notificar("Nome atualizado.", "sucesso");
    }
  }

  async function mudarSituacao(executar: () => Promise<ResultadoEstoque<CategoriaEstoque>>, sucesso: string) {
    setErro(null);
    const r = await gravar(executar);
    if (!r) return;
    if (!r.ok) {
      const comProdutos = r.falha.tipo === "conflito" && r.falha.code === "CATEGORIA_COM_PRODUTOS";
      setErro({ mensagem: mensagemDaFalha(r.falha), comProdutos });
      return;
    }
    notificar(sucesso, "sucesso");
  }

  const abrir = (j: Janela) => {
    setErroJanela(null);
    setJanela(j);
  };
  const textos = janela.tipo === "fechada" ? null : TEXTOS_DA_JANELA[janela.tipo];
  const inicial = janela.tipo === "renomear-categoria" ? janela.categoria.name : janela.tipo === "renomear-subcategoria" ? janela.sub.name : "";

  return (
    <PaginaConta
      trilha={trilhaDoEstoque("Categorias")}
      titulo={TITULO}
      descricao="Agrupe os produtos do seu jeito. Subcategorias são opcionais."
      acoes={
        ctx.podeOperar &&
        estado.status === "carregada" && (
          <Botao onClick={() => abrir({ tipo: "nova-categoria" })} disabled={gravando}>
            <Plus size={16} aria-hidden="true" /> Nova categoria
          </Botao>
        )
      }
    >
      {estado.status === "carregando" && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]" aria-busy="true" aria-label="Carregando categorias">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {estado.status === "falha" && <AvisoDeFalha falha={estado.falha} aoTentarDeNovo={() => void recarregar()} />}
      {estado.status === "carregada" && categorias.length === 0 && (
        <Cartao>
          <CartaoCorpo>
            <EstadoVazio icone={FolderTree} titulo="Nenhuma categoria ainda" descricao="Crie a primeira categoria para começar a cadastrar produtos." />
          </CartaoCorpo>
        </Cartao>
      )}
      {estado.status === "carregada" && categorias.length > 0 && (
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <ArvoreDeCategorias
            categorias={categorias}
            selecao={escolhida ? { categoriaId: escolhida.id, subcategoriaId: subEscolhida } : null}
            mostrarArquivadas={mostrarArquivadas}
            aoMostrarArquivadas={setMostrarArquivadas}
            aoEscolher={(s) => {
              setErro(null);
              setSelecao(s);
            }}
          />
          {escolhida ? (
            <DetalheDaCategoria
              key={escolhida.id}
              tenantId={tenantId}
              categoria={escolhida}
              subcategoriaId={subEscolhida}
              podeOperar={ctx.podeOperar}
              gravando={gravando}
              erro={erro}
              aoEditar={() => abrir({ tipo: "renomear-categoria", categoria: escolhida })}
              aoMudarSituacao={() =>
                void mudarSituacao(
                  () => situacaoDaCategoria(tenantId, escolhida.id, escolhida.archived ? "reactivate" : "archive"),
                  escolhida.archived ? "Categoria reativada." : "Categoria arquivada.",
                )
              }
              aoNovaSubcategoria={() => abrir({ tipo: "nova-subcategoria", categoria: escolhida })}
              aoRenomearSubcategoria={(sub) => abrir({ tipo: "renomear-subcategoria", sub })}
              aoMudarSituacaoSub={(sub) =>
                void mudarSituacao(
                  () => situacaoDaSubcategoria(tenantId, sub.id, sub.archived ? "reactivate" : "archive"),
                  sub.archived ? "Subcategoria reativada." : "Subcategoria arquivada.",
                )
              }
              aoEscolherSubcategoria={(subId) => setSelecao({ categoriaId: escolhida.id, subcategoriaId: subId })}
            />
          ) : (
            <Cartao>
              <CartaoCorpo>
                <EstadoVazio icone={FolderTree} titulo="Todas as categorias estão arquivadas" descricao="Marque “Mostrar arquivadas” para vê-las." />
              </CartaoCorpo>
            </Cartao>
          )}
        </div>
      )}

      <JanelaDeNome
        aberta={textos !== null}
        titulo={textos?.titulo ?? ""}
        rotulo={textos?.rotulo ?? ""}
        botao={textos?.botao ?? "Salvar"}
        inicial={inicial}
        gravando={gravando}
        erro={erroJanela}
        aoSalvar={(nome) => void aoSalvarJanela(nome)}
        aoFechar={() => setJanela({ tipo: "fechada" })}
      />
    </PaginaConta>
  );
}
