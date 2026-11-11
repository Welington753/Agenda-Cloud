"use client";

// Pagamentos das assinaturas do Agenda Cloud (portal da plataforma): os
// períodos pagos registrados à mão em cada estabelecimento, do mais recente
// ao mais antigo, com os anulados por correção marcados. Só consulta: o
// registro e a correção ficam na ficha de cada estabelecimento.
//
// Filtros na URL (`de`, `ate`, `alcance`, `situacao`, `pagina`), todos
// opcionais: sem período, todo o histórico; alcance padrão Clientes; sem
// situação, recebidos e anulados juntos. Os links do relatório por período
// abrem esta lista já filtrada, pela MESMA regra do servidor. Um filtro só é
// afirmado quando a API o devolve (`from`, `to`, `scope`, `status`).
//
// Não confundir com os recebimentos dos atendimentos (dinheiro que o cliente
// do estabelecimento paga a ele), que nunca aparecem aqui.
import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { SeletorDeAlcance, TextoDeAlcance } from "@/components/administracao/alcance-do-portal";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ehListaDePagamentos, type ListaDePagamentos } from "@/lib/administracao/contratos";
import { ESCOPO_PADRAO, type EscopoDoDiretorio } from "@/lib/administracao/contratos-diretorio";
import { alcanceConfirmado, ehEscopoDoDiretorio } from "@/lib/administracao/diretorio";
import { lerPeriodoDaUrl, problemaDoPeriodo, textoDoPeriodo, type Intervalo } from "@/lib/administracao/periodo";
import { CICLOS, diaBr, FORMAS_DE_PAGAMENTO, ORIGEM_DO_VALOR, reais } from "@/lib/administracao/validade";
import { rotaFichaEstabelecimento, type SituacaoNoExtrato } from "@/lib/administracao/rotas";

const CAMPO =
  "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";
const POR_PAGINA = 30;
const SITUACAO_NA_API: Record<SituacaoNoExtrato, "RECEIVED" | "CANCELED"> = { recebidos: "RECEIVED", anulados: "CANCELED" };
const SITUACOES_DO_EXTRATO: Record<SituacaoNoExtrato, string> = {
  recebidos: "Recebidos (não anulados)",
  anulados: "Anulados",
};

interface Filtro {
  periodo: Intervalo | null;
  escopo: EscopoDoDiretorio;
  situacao: SituacaoNoExtrato | null;
  pagina: number;
}

const ehSituacao = (v: string | null): v is SituacaoNoExtrato => v === "recebidos" || v === "anulados";

function lerFiltro(params: URLSearchParams): Filtro {
  const escopo = params.get("alcance");
  const situacao = params.get("situacao");
  const pagina = Number(params.get("pagina"));
  return {
    periodo: lerPeriodoDaUrl(params, { de: "de", ate: "ate" }).intervalo,
    escopo: ehEscopoDoDiretorio(escopo) ? escopo : ESCOPO_PADRAO,
    situacao: ehSituacao(situacao) ? situacao : null,
    pagina: Number.isSafeInteger(pagina) && pagina >= 1 ? pagina : 1,
  };
}

function enderecoDo(filtro: Filtro, pathname: string): string {
  const params = new URLSearchParams();
  if (filtro.periodo) {
    params.set("de", filtro.periodo.de);
    params.set("ate", filtro.periodo.ate);
  }
  if (filtro.escopo !== ESCOPO_PADRAO) params.set("alcance", filtro.escopo);
  if (filtro.situacao) params.set("situacao", filtro.situacao);
  if (filtro.pagina > 1) params.set("pagina", String(filtro.pagina));
  const busca = params.toString();
  return busca ? `${pathname}?${busca}` : pathname;
}

/** O servidor confirmou exatamente os filtros pedidos? Uma API anterior não
 * ecoa nada: só a consulta sem filtro novo (alcance "Todos", sem período e
 * sem situação) é aceita, e aí o alcance aparece como não confirmado. */
function filtrosConfirmados(filtro: Filtro, lista: ListaDePagamentos): boolean {
  if (lista.scope === undefined) return filtro.escopo === "ALL" && !filtro.periodo && !filtro.situacao;
  return (
    lista.scope === filtro.escopo &&
    (lista.from ?? null) === (filtro.periodo?.de ?? null) &&
    (lista.to ?? null) === (filtro.periodo?.ate ?? null) &&
    (lista.status ?? null) === (filtro.situacao ? SITUACAO_NA_API[filtro.situacao] : null)
  );
}

export default function PagamentosDasAssinaturasPage() {
  return (
    <Suspense fallback={<p className="py-12 text-center text-ink-soft">Carregando o portal…</p>}>
      <PagamentosDasAssinaturas />
    </Suspense>
  );
}

function PagamentosDasAssinaturas() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const chaveDaUrl = searchParams.toString();
  const filtro = lerFiltro(new URLSearchParams(chaveDaUrl));
  const periodoInvalido = lerPeriodoDaUrl(new URLSearchParams(chaveDaUrl), { de: "de", ate: "ate" }).invalido;
  const [de, setDe] = useState(filtro.periodo?.de ?? "");
  const [ate, setAte] = useState(filtro.periodo?.ate ?? "");
  const [erroPeriodo, setErroPeriodo] = useState("");
  useEffect(() => {
    const atual = lerFiltro(new URLSearchParams(chaveDaUrl));
    setDe(atual.periodo?.de ?? "");
    setAte(atual.periodo?.ate ?? "");
  }, [chaveDaUrl]);

  const params = new URLSearchParams({ page: String(filtro.pagina), pageSize: String(POR_PAGINA) });
  if (filtro.periodo) {
    params.set("from", filtro.periodo.de);
    params.set("to", filtro.periodo.ate);
  }
  // "Todos" é o que a API faz sem `scope` (também a anterior): não vai na
  // consulta. Clientes e Internos/teste vão sempre.
  if (filtro.escopo !== "ALL") params.set("scope", filtro.escopo);
  if (filtro.situacao) params.set("status", SITUACAO_NA_API[filtro.situacao]);
  const { estado, recarregar } = useLeituraPlataforma(`/platform/subscription-payments?${params}`, ehListaDePagamentos);

  const ir = (novo: Filtro) => router.replace(enderecoDo(novo, pathname), { scroll: false });

  function aplicarPeriodo(event: FormEvent) {
    event.preventDefault();
    if (!de && !ate) {
      setErroPeriodo("");
      ir({ ...filtro, periodo: null, pagina: 1 });
      return;
    }
    const problema = problemaDoPeriodo(de, ate);
    setErroPeriodo(problema ?? "");
    if (!problema) ir({ ...filtro, periodo: { de, ate }, pagina: 1 });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pagamentos das assinaturas</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Pagamentos da assinatura do Agenda Cloud, confirmados manualmente pela administração. Os recebimentos dos
            atendimentos de cada estabelecimento são outra coisa e não aparecem aqui.
          </p>
        </div>
        <Botao variante="secundaria" onClick={recarregar} className="min-h-11">
          Atualizar
        </Botao>
      </header>
      <SeletorDeAlcance valor={filtro.escopo} aoEscolher={(escopo) => ir({ ...filtro, escopo, pagina: 1 })} />
      <form
        onSubmit={aplicarPeriodo}
        className="grid items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto]"
        data-testid="filtros-do-extrato"
      >
        <label className="min-w-0 text-sm font-medium">
          Recebido de
          <input type="date" className={CAMPO} value={de} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className="min-w-0 text-sm font-medium">
          até
          <input type="date" className={CAMPO} value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
        <label className="min-w-0 text-sm font-medium">
          Situação do registro
          <select
            className={CAMPO}
            value={filtro.situacao ?? ""}
            onChange={(e) => ir({ ...filtro, situacao: ehSituacao(e.target.value) ? e.target.value : null, pagina: 1 })}
          >
            <option value="">Recebidos e anulados</option>
            {(Object.keys(SITUACOES_DO_EXTRATO) as SituacaoNoExtrato[]).map((s) => (
              <option key={s} value={s}>
                {SITUACOES_DO_EXTRATO[s]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Botao type="submit" className="min-h-11">
            Aplicar período
          </Botao>
          <Botao
            type="button"
            variante="fantasma"
            className="min-h-11"
            onClick={() => {
              setErroPeriodo("");
              ir({ periodo: null, escopo: ESCOPO_PADRAO, situacao: null, pagina: 1 });
            }}
          >
            Limpar filtros
          </Botao>
        </div>
      </form>
      {periodoInvalido && (
        <p role="alert" className="text-sm text-danger" data-testid="periodo-invalido-na-url">
          O período do endereço é inválido e foi ignorado: a lista abaixo não está filtrada por data.
        </p>
      )}
      {erroPeriodo && (
        <p role="alert" className="text-sm text-danger">
          {erroPeriodo}
        </p>
      )}
      {estado.status !== "pronto" ? (
        <EstadoLeitura
          estado={estado}
          recarregar={recarregar}
          mensagens={{
            recusado:
              "Este servidor ainda não aceita estes filtros no extrato. Nenhuma lista foi mostrada. Para ver o extrato completo, escolha Todos e limpe o período e a situação.",
          }}
        />
      ) : !filtrosConfirmados(filtro, estado.dados) ? (
        <p role="alert" className="rounded-xl border border-border bg-card p-6 text-sm" data-testid="filtro-nao-confirmado">
          O servidor não confirmou os filtros pedidos. A lista não foi mostrada para não parecer filtrada sem estar.
        </p>
      ) : (
        <Extrato filtro={filtro} lista={estado.dados} ir={ir} />
      )}
    </div>
  );
}

function Extrato({ filtro, lista, ir }: { filtro: Filtro; lista: ListaDePagamentos; ir: (f: Filtro) => void }) {
  const paginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));
  return (
    <>
      <div className="space-y-1">
        <p role="status" className="text-sm text-ink-soft" data-testid="total-do-extrato">
          {lista.total} registro(s)
          {filtro.periodo ? ` recebidos em ${textoDoPeriodo(filtro.periodo)} (data de recebimento, horário de Brasília)` : " em todo o histórico"}
          {filtro.situacao === "recebidos" && " · somente não anulados"}
          {filtro.situacao === "anulados" && " · somente anulados"}
        </p>
        <TextoDeAlcance confirmado={alcanceConfirmado(filtro.escopo, lista.scope)} />
      </div>
      {lista.items.length === 0 ? (
        <Cartao>
          <CartaoCorpo>
            <p className="text-sm text-ink-soft">
              {filtro.periodo || filtro.situacao
                ? "Nenhum pagamento de assinatura com estes filtros."
                : "Nenhum pagamento de assinatura registrado."}
            </p>
          </CartaoCorpo>
        </Cartao>
      ) : (
        <ul className="space-y-3" data-testid="lista-pagamentos-assinaturas">
          {lista.items.map((p) => (
            <li key={p.id}>
              <Cartao>
                <CartaoCorpo className="space-y-1 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={rotaFichaEstabelecimento(p.tenant.id)} className="font-semibold text-accent hover:underline">
                      {p.tenant.name}
                    </Link>
                    <span className="font-semibold">{reais(p.amountCents)}</span>
                  </div>
                  <p>
                    {p.planName} · {CICLOS[p.cycle]} · {FORMAS_DE_PAGAMENTO[p.paymentMethod] ?? p.paymentMethod} · recebido em{" "}
                    {diaBr(p.receivedOn)}
                    {p.amountSource ? ` · ${ORIGEM_DO_VALOR[p.amountSource]}` : ""}
                  </p>
                  <p className="text-xs text-ink-soft">
                    Registrado por {p.recordedBy}
                    {p.reference ? ` · referência ${p.reference}` : ""}
                  </p>
                  {p.canceled && (
                    <Badge cor="aviso">Anulado por correção{p.canceled.reason ? `: ${p.canceled.reason}` : ""}</Badge>
                  )}
                </CartaoCorpo>
              </Cartao>
            </li>
          ))}
        </ul>
      )}
      {paginas > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Botao
            variante="secundaria"
            className="min-h-11"
            disabled={filtro.pagina <= 1}
            onClick={() => ir({ ...filtro, pagina: filtro.pagina - 1 })}
          >
            Anterior
          </Botao>
          <span className="text-sm">
            Página {lista.page} de {paginas}
          </span>
          <Botao
            variante="secundaria"
            className="min-h-11"
            disabled={filtro.pagina >= paginas}
            onClick={() => ir({ ...filtro, pagina: filtro.pagina + 1 })}
          >
            Próxima
          </Botao>
        </div>
      )}
      <p className="text-xs text-ink-soft">
        Anular um registro corrige o registro; não comprova devolução de dinheiro, que acontece fora do Agenda Cloud. Os valores
        são os gravados em cada pagamento, nunca recalculados pelo catálogo. O alcance usa a classificação interno/teste atual.
      </p>
    </>
  );
}
