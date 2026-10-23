"use client";

import { useState, type FormEvent } from "react";
import {
  Building2,
  CircleCheck,
  Clock3,
  ShieldAlert,
  Search,
} from "lucide-react";
import {
  ehListaEstabelecimentos,
  SITUACOES,
} from "@/lib/administracao/contratos";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { EstadoLeitura } from "@/components/administracao/estado-leitura";
import { ListaEstabelecimentos } from "@/components/administracao/lista-estabelecimentos";
import { EstatisticaCard } from "@/components/ui/estatistica-card";
import { Botao } from "@/components/ui/button";

const CAMPO =
  "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm";

export default function EstabelecimentosPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [planId, setPlanId] = useState("");
  const [erroBusca, setErroBusca] = useState("");
  const [filtro, setFiltro] = useState({
    q: "",
    status: "",
    planId: "",
    page: 1,
  });
  const params = new URLSearchParams({
    page: String(filtro.page),
    pageSize: "20",
  });
  if (filtro.q) params.set("q", filtro.q);
  if (filtro.status) params.set("status", filtro.status);
  if (filtro.planId) params.set("planId", filtro.planId);
  const { estado, recarregar } = useLeituraPlataforma(
    `/platform/establishments?${params}`,
    ehListaEstabelecimentos,
  );
  function pesquisar(event: FormEvent) {
    event.preventDefault();
    if (q.trim().length === 1) {
      setErroBusca("Digite ao menos 2 caracteres ou deixe a busca vazia.");
      return;
    }
    setErroBusca("");
    setFiltro({ q: q.trim(), status, planId, page: 1 });
  }
  function limpar() {
    setQ("");
    setStatus("");
    setPlanId("");
    setErroBusca("");
    setFiltro({ q: "", status: "", planId: "", page: 1 });
  }
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            Seus clientes na plataforma
          </p>
          <h1 className="mt-1 text-2xl font-bold">Estabelecimentos</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-soft">
            Acompanhe os negócios cadastrados, seus responsáveis e planos.
          </p>
        </div>
        <Botao
          variante="secundaria"
          onClick={recarregar}
          disabled={estado.status === "carregando"}
          className="min-h-11"
        >
          Atualizar
        </Botao>
      </header>
      {estado.status === "pronto" && (
        <section
          aria-label="Resumo de todos os estabelecimentos"
          className="grid grid-cols-2 gap-3 xl:grid-cols-4"
        >
          <EstatisticaCard
            icone={Building2}
            rotulo="Total cadastrado"
            valor={String(estado.dados.summary.total)}
          />
          <EstatisticaCard
            icone={CircleCheck}
            rotulo="Ativos"
            valor={String(estado.dados.summary.active)}
            corIcone="success"
          />
          <EstatisticaCard
            icone={Clock3}
            rotulo="Em teste"
            valor={String(estado.dados.summary.trial)}
            corIcone="info"
          />
          <EstatisticaCard
            icone={ShieldAlert}
            rotulo="Com acesso restrito"
            valor={String(estado.dados.summary.restricted)}
            corIcone="warning"
          />
        </section>
      )}
      <form
        onSubmit={pesquisar}
        className="grid items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_auto]"
      >
        <label className="min-w-0 text-sm font-medium">
          Buscar estabelecimento ou responsável
          <input
            className={CAMPO}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={120}
            placeholder="Nome, e-mail, telefone ou identificação"
          />
        </label>
        <label className="min-w-0 text-sm font-medium">
          Situação do acesso
          <select
            className={CAMPO}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
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
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            disabled={estado.status !== "pronto"}
          >
            <option value="">Todos os planos</option>
            {planId && estado.status !== "pronto" && (
              <option value={planId}>Plano selecionado</option>
            )}
            {estado.status === "pronto" &&
              estado.dados.plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
          </select>
        </label>
        <Botao type="submit" className="min-h-11">
          <Search size={17} aria-hidden="true" />
          Pesquisar
        </Botao>
      </form>
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
          <nav
            aria-label="Paginação"
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <Botao
              variante="secundaria"
              disabled={filtro.page === 1}
              onClick={() => setFiltro((f) => ({ ...f, page: f.page - 1 }))}
              className="min-h-11"
            >
              Anterior
            </Botao>
            <span className="text-sm text-ink-soft">
              Página {filtro.page} de{" "}
              {Math.max(
                1,
                Math.ceil(estado.dados.total / estado.dados.pageSize),
              )}
            </span>
            <Botao
              variante="secundaria"
              disabled={
                filtro.page * estado.dados.pageSize >= estado.dados.total
              }
              onClick={() => setFiltro((f) => ({ ...f, page: f.page + 1 }))}
              className="min-h-11"
            >
              Próxima
            </Botao>
          </nav>
          <p className="text-xs text-ink-soft">
            O preço exibido é o do catálogo. Mensalidades contratadas e
            pagamentos recebidos ainda não são registrados nesta área.
          </p>
        </>
      )}
    </div>
  );
}
