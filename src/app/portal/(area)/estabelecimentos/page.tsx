"use client";

// Lista dos estabelecimentos no portal da plataforma, com plano, condição
// contratada, situação do cadastro, modalidade e validade do acesso, sem
// abrir cada ficha. Os filtros moram na URL (`alcance`, `q`, `situacao`,
// `plano`, `filtro`, `cadastroDe`/`cadastroAte`, `pagina`): os links da
// Visão geral e do relatório por período abrem a lista já filtrada e
// voltar no navegador desfaz a busca. Tudo é calculado no servidor sobre o
// conjunto completo; a página só mostra a fatia pedida. O alcance (clientes,
// internos/teste, todos) só é afirmado quando o servidor o devolve.
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { SITUACOES } from "@/lib/administracao/contratos";
import {
  ehListaDoDiretorio,
  ESCOPO_PADRAO,
  FILTROS_DO_DIRETORIO,
  type EscopoDoDiretorio,
} from "@/lib/administracao/contratos-diretorio";
import {
  alcanceConfirmado,
  ehEscopoDoDiretorio,
  ehFiltroDoDiretorio,
  ehSituacaoDoFiltro,
  FILTROS,
} from "@/lib/administracao/diretorio";
import { SeletorDeAlcance, TextoDeAlcance } from "@/components/administracao/alcance-do-portal";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { ListaEstabelecimentos } from "@/components/administracao/lista-estabelecimentos";
import { Botao, LinkBotao } from "@/components/ui/button";
import { useCapacidades } from "@/lib/administracao/use-acesso-plataforma";
import { ROTA_NOVO_ESTABELECIMENTO } from "@/lib/administracao/rotas";
import { lerPeriodoDaUrl, textoDoPeriodo, type Intervalo } from "@/lib/administracao/periodo";

const NOMES_DO_CADASTRO = { de: "cadastroDe", ate: "cadastroAte" };

const CAMPO =
  "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";
const POR_PAGINA = 20;
const ID_PLANO = /^[a-zA-Z0-9_-]{1,30}$/;

interface Filtro {
  escopo: EscopoDoDiretorio;
  q: string;
  situacao: string;
  plano: string;
  filtro: string;
  /** Data de cadastro (as duas inclusas, horário de Brasília); `null`: sem
   * restrição. Só chega pelo link do relatório e sai por "Remover período". */
  cadastro: Intervalo | null;
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
  const escopo = params.get("alcance");
  return {
    escopo: ehEscopoDoDiretorio(escopo) ? escopo : ESCOPO_PADRAO,
    q: q.length >= 2 ? q : "",
    situacao: ehSituacaoDoFiltro(situacao) ? situacao : "",
    plano: ID_PLANO.test(plano) ? plano : "",
    filtro: ehFiltroDoDiretorio(filtro) ? filtro : "",
    cadastro: lerPeriodoDaUrl(params, NOMES_DO_CADASTRO).intervalo,
    pagina: Number.isSafeInteger(pagina) && pagina >= 1 ? pagina : 1,
  };
}

function enderecoDo(filtro: Filtro, pathname: string): string {
  const params = new URLSearchParams();
  if (filtro.escopo !== ESCOPO_PADRAO) params.set("alcance", filtro.escopo);
  if (filtro.q) params.set("q", filtro.q);
  if (filtro.situacao) params.set("situacao", filtro.situacao);
  if (filtro.plano) params.set("plano", filtro.plano);
  if (filtro.filtro) params.set("filtro", filtro.filtro);
  if (filtro.cadastro) {
    params.set("cadastroDe", filtro.cadastro.de);
    params.set("cadastroAte", filtro.cadastro.ate);
  }
  if (filtro.pagina > 1) params.set("pagina", String(filtro.pagina));
  const busca = params.toString();
  return busca ? `${pathname}?${busca}` : pathname;
}

/** O servidor aplicou exatamente o período de cadastro pedido? Sem pedido,
 * nada a confirmar. */
function cadastroConfirmado(pedido: Intervalo | null, recebido: { from: string; to: string } | null | undefined): boolean {
  if (!pedido) return true;
  return !!recebido && recebido.from === pedido.de && recebido.to === pedido.ate;
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
  if (filtro.cadastro) {
    params.set("createdFrom", filtro.cadastro.de);
    params.set("createdTo", filtro.cadastro.ate);
  }
  // O padrão (clientes) não vai na consulta: o servidor já o aplica e
  // devolve `scope`; sem ele, a tela não afirma o recorte.
  if (filtro.escopo !== ESCOPO_PADRAO) params.set("scope", filtro.escopo);
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
    ir({ escopo: ESCOPO_PADRAO, q: "", situacao: "", plano: "", filtro: "", cadastro: null, pagina: 1 });
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
      <SeletorDeAlcance
        valor={filtro.escopo}
        aoEscolher={(escopo) => ir({ ...filtro, escopo, pagina: 1 })}
      />
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
      {filtro.cadastro && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="filtro-cadastro">
          <span>
            <span className="font-semibold">Cadastros registrados em {textoDoPeriodo(filtro.cadastro)}</span>
            <span className="text-ink-soft"> (data de criação do cadastro, horário de Brasília)</span>
          </span>
          <Botao variante="fantasma" className="min-h-11" onClick={() => ir({ ...filtro, cadastro: null, pagina: 1 })}>
            Remover período
          </Botao>
        </div>
      )}
      {erroBusca && (
        <p role="alert" className="text-sm text-danger">
          {erroBusca}
        </p>
      )}
      {estado.status !== "pronto" ? (
        <EstadoLeitura
          estado={estado}
          recarregar={recarregar}
          mensagens={{
            recusado: "Este servidor ainda não aceita este filtro. Nenhuma lista foi mostrada. Remova o período de cadastro.",
          }}
        />
      ) : !cadastroConfirmado(filtro.cadastro, estado.dados.created) ? (
        <p role="alert" className="rounded-xl border border-border bg-card p-6 text-sm" data-testid="filtro-nao-confirmado">
          O servidor não confirmou o período de cadastro. A lista não foi mostrada para não parecer filtrada sem estar.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-ink-soft" data-testid="total-da-lista">
              {estado.dados.total} estabelecimento(s) encontrado(s)
            </p>
            <Botao variante="fantasma" onClick={limpar} className="min-h-11">
              Limpar filtros
            </Botao>
          </div>
          <TextoDeAlcance confirmado={alcanceConfirmado(filtro.escopo, estado.dados.scope)} />
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
