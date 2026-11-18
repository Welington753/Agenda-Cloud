"use client";

// Categorias e subcategorias do estoque (um nível de subcategoria). Cada
// estabelecimento tem as suas; nada é apagado, só arquivado. Quem só consulta
// (gerente com "Ver estoque") vê a lista sem os botões.
import { useRef, useState } from "react";
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
import { AvisoDeFalha, CLASSE_CAMPO, ErroDoFormulario, SemEstabelecimento } from "@/components/estoque/comum";
import { CartaoCategoria, type AcoesDaCategoria } from "./cartao-categoria";

const TITULO = "Categorias";

export default function CategoriasDoEstoquePage() {
  const ctx = useContextoEstoque();
  const { estado, recarregar, substituir } = useCategorias(ctx.tenantId);
  const { notificar } = useToast();
  const [gravando, setGravando] = useState(false);
  const travado = useRef(false);
  const [nova, setNova] = useState("");
  const [erroNova, setErroNova] = useState<string | null>(null);

  if (!ctx.pronto) return null;
  if (!ctx.tenantId) return <SemEstabelecimento titulo={TITULO} />;
  const tenantId = ctx.tenantId;

  /** Uma gravação por vez; a categoria devolvida substitui a da lista. */
  async function gravar(acao: () => Promise<ResultadoEstoque<CategoriaEstoque>>): Promise<boolean> {
    if (travado.current) return false;
    travado.current = true;
    setGravando(true);
    try {
      const r = await acao();
      if (r.ok) substituir(r.dados);
      return r.ok;
    } finally {
      travado.current = false;
      setGravando(false);
    }
  }

  const acoes: AcoesDaCategoria = {
    renomear: (id, nome) => renomearCategoria(tenantId, id, nome),
    situacao: (id, acao) => situacaoDaCategoria(tenantId, id, acao),
    criarSub: (id, nome) => criarSubcategoria(tenantId, id, nome),
    renomearSub: (id, nome) => renomearSubcategoria(tenantId, id, nome),
    situacaoSub: (id, acao) => situacaoDaSubcategoria(tenantId, id, acao),
  };

  async function aoCriar(e: React.FormEvent) {
    e.preventDefault();
    setErroNova(null);
    const nome = nova.trim();
    if (!nome) return;
    const ok = await gravar(async () => {
      const r = await criarCategoria(tenantId, nome);
      if (!r.ok) setErroNova(mensagemDaFalha(r.falha));
      return r;
    });
    if (ok) {
      setNova("");
      notificar("Categoria criada.", "sucesso");
    }
  }

  return (
    <PaginaConta titulo={TITULO} descricao="Organize os produtos por categoria e, se quiser, por uma subcategoria dentro dela.">
      {ctx.podeOperar && estado.status === "carregada" && (
        <Cartao>
          <CartaoCorpo>
            <form className="flex flex-col gap-2 sm:flex-row sm:items-start" onSubmit={(e) => void aoCriar(e)}>
              <div className="flex-1">
                <label htmlFor="nova-categoria" className="sr-only">
                  Nome da nova categoria
                </label>
                <input id="nova-categoria" className={CLASSE_CAMPO} placeholder="Nova categoria (ex.: Cabelo)" value={nova} maxLength={60} onChange={(e) => setNova(e.target.value)} />
              </div>
              <Botao type="submit" disabled={gravando || !nova.trim()}>
                <Plus size={16} aria-hidden="true" /> Criar categoria
              </Botao>
            </form>
            <div className="mt-2">
              <ErroDoFormulario mensagem={erroNova} />
            </div>
          </CartaoCorpo>
        </Cartao>
      )}

      {estado.status === "carregando" && (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando categorias">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {estado.status === "falha" && <AvisoDeFalha falha={estado.falha} aoTentarDeNovo={() => void recarregar()} />}
      {estado.status === "carregada" && estado.categorias.length === 0 && (
        <EstadoVazio icone={FolderTree} titulo="Nenhuma categoria ainda" descricao="Crie a primeira categoria para começar a cadastrar produtos." />
      )}
      {estado.status === "carregada" && estado.categorias.length > 0 && (
        <div className="space-y-3">
          {estado.categorias.map((categoria) => (
            <CartaoCategoria key={categoria.id} categoria={categoria} podeOperar={ctx.podeOperar} acoes={acoes} gravando={gravando} gravar={gravar} />
          ))}
        </div>
      )}
    </PaginaConta>
  );
}
