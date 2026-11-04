"use client";

// Lista dos estabelecimentos no portal da plataforma, com plano, condição
// contratada, situação do cadastro, modalidade e validade do acesso, sem
// abrir cada ficha. Os filtros moram na URL (`q`, `situacao`, `plano`,
// `filtro`, `pagina`): os links da Visão geral abrem a lista já filtrada e
// voltar no navegador desfaz a busca. Tudo é calculado no servidor sobre o
// conjunto completo; a página só mostra a fatia pedida.
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { SITUACOES } from "@/lib/administracao/contratos";
import { ehListaDoDiretorio, FILTROS_DO_DIRETORIO } from "@/lib/administracao/contratos-diretorio";
import { ehFiltroDoDiretorio, ehSituacaoDoFiltro, FILTROS } from "@/lib/administracao/diretorio";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { ListaEstabelecimentos } from "@/components/administracao/lista-estabelecimentos";
import { Botao, LinkBotao } from "@/components/ui/button";
import { useCapacidades } from "@/lib/administracao/use-acesso-plataforma";
import { ROTA_NOVO_ESTABELECIMENTO } from "@/lib/administracao/rotas";

const CAMPO =
  "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";
const POR_PAGINA = 20;
const ID_PLANO = /^[a-zA-Z0-9_-]{1,30}$/;

interface Filtro {
  q: string;
  situacao: string;
  plano: string;
  filtro: string;
  pagina: number;
}

/** A URL vem de fora (link colado, histórico): só valores conhecidos viram
 * consulta; o resto é ignorado. */
function lerFiltro(params: URLSearchParams): Filtro {
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const situacao = params.get("situacao");
  const plano = params.get("plano") ?? "";
  const filtro = params.get("filtro");
  const pagina = Number(params.get("pagina"));
  return {
    q: q.length >= 2 ? q : "",
    situacao: ehSituacaoDoFiltro(situacao) ? situacao : "",
    plano: ID_PLANO.test(plano) ? plano : "",
    filtro: ehFiltroDoDiretorio(filtro) ? filtro : "",
    pagina: Number.isSafeInteger(pagina) && pagina >= 1 ? pagina : 1,
  };
}

function enderecoDo(filtro: Filtro, pathname: string): string {
  const params = new URLSearchParams();
  if (filtro.q) params.set("q", filtro.q);
  if (filtro.situacao) params.set("situacao", filtro.situacao);
  if (filtro.plano) params.set("plano", filtro.plano);
  if (filtro.filtro) params.set("filtro", filtro.filtro);
  if (filtro.pagina > 1) params.set("pagina", String(filtro.pagina));
  const busca = params.toString();
  return busca ? `${pathname}?${busca}` : pathname;
}

export default function EstabelecimentosPage() {
  return (
    <Suspense fallback={<p className="py-12 text-center text-ink-soft">Carregando o portal…</p>}>
      <Estabelecimentos />
    </Suspense>
  );
}

function Estabelecimentos() {
  const capacidades = useCapacidades();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const chaveDaUrl = searchParams.toString();
  const filtro = lerFiltro(new URLSearchParams(chaveDaUrl));
  const [rascunho, setRascunho] = useState(filtro);
  const [erroBusca, setErroBusca] = useState("");
  // Um link novo (da Visão geral, do histórico) recarrega os campos.
  useEffect(() => setRascunho(lerFiltro(new URLSearchParams(chaveDaUrl))), [chaveDaUrl]);

  const params = new URLSearchParams({ page: String(filtro.pagina), pageSize: String(POR_PAGINA) });
  if (filtro.q) params.set("q", filtro.q);
  if (filtro.situacao) params.set("status", filtro.situacao);
  if (filtro.plano) params.set("planId", filtro.plano);
  if (filtro.filtro) params.set("filter", filtro.filtro);
  const { estado, recarregar } = useLeituraPlataforma(`/platform/establishments?${params}`, ehListaDoDiretorio);

  const ir = (novo: Filtro) => router.replace(enderecoDo(novo, pathname), { scroll: false });

  function pesquisar(event: FormEvent) {
    event.preventDefault();
    const q = rascunho.q.trim();
    if (q.length === 1) {
      setErroBusca("Digite ao menos 2 caracteres ou deixe a busca vazia.");
      return;
    }
    setErroBusca("");
    ir({ ...rascunho, q, pagina: 1 });
  }
  function limpar() {
    setErroBusca("");
    ir({ q: "", situacao: "", plano: "", filtro: "", pagina: 1 });
  }
  const campo = (nome: keyof Filtro) => (valor: string) => setRascunho((r) => ({ ...r, [nome]: valor }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Cadastrados na plataforma</p>
          <h1 className="mt-1 text-2xl font-bold">Estabelecimentos</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-soft">
            Plano, condição contratada, situação e validade do acesso de cada estabelecimento.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {capacidades.manageEstablishments && (
            <LinkBotao href={ROTA_NOVO_ESTABELECIMENTO} className="min-h-11">
              Novo estabelecimento
            </LinkBotao>
          )}
          <Botao variante="secundaria" onClick={recarregar} disabled={estado.status === "carregando"} className="min-h-11">
            Atualizar
          </Botao>
        </div>
      </header>
      <form
        onSubmit={pesquisar}
        className="grid items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1.4fr_auto]"
      >
        <label className="min-w-0 text-sm font-medium">
          Buscar estabelecimento ou responsável
          <input
            className={CAMPO}
            value={rascunho.q}
            onChange={(e) => campo("q")(e.target.value)}
            maxLength={120}
            placeholder="Nome, e-mail, telefone ou identificação"
          />
        </label>
        <label className="min-w-0 text-sm font-medium">
          Situação do estabelecimento
          <select className={CAMPO} value={rascunho.situacao} onChange={(e) => campo("situacao")(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(SITUACOES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Plano
          <select
            className={CAMPO}
            value={rascunho.plano}
            onChange={(e) => campo("plano")(e.target.value)}
            disabled={estado.status !== "pronto"}
          >
            <option value="">Todos os planos</option>
            {rascunho.plano && estado.status !== "pronto" && <option value={rascunho.plano}>Plano selecionado</option>}
            {estado.status === "pronto" &&
              estado.dados.plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
          </select>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Acesso e condição
          <select className={CAMPO} value={rascunho.filtro} onChange={(e) => campo("filtro")(e.target.value)}>
            <option value="">Sem filtro</option>
            {FILTROS_DO_DIRETORIO.map((f) => (
              <option key={f} value={f}>
                {FILTROS[f].rotulo}
              </option>
            ))}
          </select>
        </label>
        <Botao type="submit" className="min-h-11">
          <Search size={17} aria-hidden="true" />
          Pesquisar
        </Botao>
      </form>
      {ehFiltroDoDiretorio(filtro.filtro) && (
        <p className="text-sm text-ink-soft" data-testid="filtro-aplicado">
          <span className="font-semibold text-ink">{FILTROS[filtro.filtro].rotulo}:</span> {FILTROS[filtro.filtro].descricao}
        </p>
      )}
      {erroBusca && (
        <p role="alert" className="text-sm text-danger">
          {erroBusca}
        </p>
      )}
      {estado.status !== "pronto" ? (
        <EstadoLeitura estado={estado} recarregar={recarregar} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-ink-soft">
              {estado.dados.total} estabelecimento(s) encontrado(s)
            </p>
            <Botao variante="fantasma" onClick={limpar} className="min-h-11">
              Limpar filtros
            </Botao>
          </div>
          <ListaEstabelecimentos items={estado.dados.items} />
          <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-2">
            <Botao
              variante="secundaria"
              disabled={filtro.pagina === 1}
              onClick={() => ir({ ...filtro, pagina: filtro.pagina - 1 })}
              className="min-h-11"
            >
              Anterior
            </Botao>
            <span className="text-sm text-ink-soft">
              Página {filtro.pagina} de {Math.max(1, Math.ceil(estado.dados.total / estado.dados.pageSize))}
            </span>
            <Botao
              variante="secundaria"
              disabled={filtro.pagina * estado.dados.pageSize >= estado.dados.total}
              onClick={() => ir({ ...filtro, pagina: filtro.pagina + 1 })}
              className="min-h-11"
            >
              Próxima
            </Botao>
          </nav>
          <p className="text-xs text-ink-soft">
            Condição contratada: valor combinado com o cliente para o plano atual (o trimestral é o total de três meses).
            Catálogo: preço de tabela do plano, que não é contrato. Pendente: sem valor definido, nunca zero nem gratuito.
            O último pagamento registrado não muda a condição contratada.
          </p>
        </>
      )}
    </div>
  );
}
