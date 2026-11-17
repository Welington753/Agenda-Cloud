"use client";

// Peças de "Contas e acessos" (src/app/portal/(area)/usuarios/page.tsx)
// comuns às duas abas: busca, totais, paginação e a tabela que vira cartões
// no celular. Só desenham; as regras ficam em lib/administracao/contas-e-acessos.
import { useState, type FormEvent, type ReactNode } from "react";
import clsx from "clsx";
import { Ban, Mail, RefreshCw, Search, UserCheck, Users } from "lucide-react";
import { Botao, LinkBotao } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge-base";
import { EstatisticaCard } from "@/components/ui/estatistica-card";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import {
  FILTRO_VAZIO,
  SITUACOES_NA_LISTA,
  buscaDaLista,
  erroDaBusca,
  rotuloDaAcao,
  type AbaContas,
  type FiltroContas,
  type ListaContas,
  type ResumoContas,
} from "@/lib/administracao/contas-e-acessos";
import { corConta, type SituacaoConta } from "@/lib/administracao/rotulos";
import { rotaFichaUsuario } from "@/lib/administracao/rotas";

const CAMPO = "mt-1 min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm";

/** Busca, situação, páginas e totais de uma aba, lidos no servidor. */
export function useListaDaAba<T>(aba: AbaContas, validar: (v: unknown) => v is ListaContas<T>) {
  const [form, setForm] = useState<FiltroContas>(FILTRO_VAZIO);
  const [filtro, setFiltro] = useState<FiltroContas>(FILTRO_VAZIO);
  const [erroBusca, setErroBusca] = useState("");
  const leitura = useLeituraPlataforma(buscaDaLista(aba, filtro), validar);
  function pesquisar(evento: FormEvent) {
    evento.preventDefault();
    const erro = erroDaBusca(form.q);
    setErroBusca(erro);
    if (!erro) setFiltro({ ...form, q: form.q.trim(), page: 1 });
  }
  return { form, setForm, filtro, setFiltro, erroBusca, pesquisar, ...leitura };
}

interface ControleBusca {
  form: FiltroContas;
  setForm: (f: (anterior: FiltroContas) => FiltroContas) => void;
  filtro: FiltroContas;
  setFiltro: (f: (anterior: FiltroContas) => FiltroContas) => void;
  erroBusca: string;
  pesquisar: (evento: FormEvent) => void;
}

export function ResumoDasContas({ resumo, rotuloTotal }: { resumo: ResumoContas; rotuloTotal: string }) {
  return (
    <section aria-label="Resumo das contas" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <EstatisticaCard icone={Users} rotulo={rotuloTotal} valor={String(resumo.total)} testId="total-contas" />
      <EstatisticaCard icone={UserCheck} rotulo="Ativas" valor={String(resumo.active)} corIcone="success" />
      <EstatisticaCard icone={Mail} rotulo="Convite pendente" valor={String(resumo.invited)} corIcone="warning" />
      <EstatisticaCard icone={Ban} rotulo="Bloqueadas" valor={String(resumo.suspended)} corIcone="danger" />
    </section>
  );
}

export function FiltrosDasContas({ lista, rotuloBusca }: { lista: ControleBusca; rotuloBusca: string }) {
  const { form, setForm } = lista;
  return (
    <>
      <form
        onSubmit={lista.pesquisar}
        className="grid items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[2fr_1fr_auto]"
      >
        <label className="min-w-0 text-sm font-medium">
          {rotuloBusca}
          <span className="relative block">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 text-ink-soft" />
            <input
              className={clsx(CAMPO, "pl-9")}
              maxLength={120}
              value={form.q}
              onChange={(e) => {
                const q = e.target.value;
                setForm((f) => ({ ...f, q }));
              }}
            />
          </span>
        </label>
        <label className="min-w-0 text-sm font-medium">
          Situação
          <select
            className={CAMPO}
            value={form.status}
            onChange={(e) => {
              const status = e.target.value as FiltroContas["status"];
              setForm((f) => ({ ...f, status }));
            }}
          >
            <option value="">Todas</option>
            {Object.entries(SITUACOES_NA_LISTA).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <Botao type="submit" className="min-h-11">
          <Search size={17} aria-hidden="true" />
          Pesquisar
        </Botao>
      </form>
      {lista.erroBusca && (
        <p role="alert" className="text-sm text-danger">
          {lista.erroBusca}
        </p>
      )}
    </>
  );
}

export function PaginacaoDasContas({ lista, total, pageSize }: { lista: ControleBusca; total: number; pageSize: number }) {
  const { filtro, setFiltro } = lista;
  if (total <= pageSize && filtro.page === 1) return null;
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-2">
      <Botao variante="secundaria" disabled={filtro.page === 1} onClick={() => setFiltro((f) => ({ ...f, page: f.page - 1 }))} className="min-h-11">
        Anterior
      </Botao>
      <span className="text-sm text-ink-soft">
        Página {filtro.page} de {Math.max(1, Math.ceil(total / pageSize))}
      </span>
      <Botao
        variante="secundaria"
        disabled={filtro.page * pageSize >= total}
        onClick={() => setFiltro((f) => ({ ...f, page: f.page + 1 }))}
        className="min-h-11"
      >
        Próxima
      </Botao>
    </nav>
  );
}

export function AtualizarContas({ recarregar }: { recarregar: () => void }) {
  return (
    <Botao variante="secundaria" onClick={recarregar} className="min-h-11">
      <RefreshCw size={16} aria-hidden="true" />
      Atualizar
    </Botao>
  );
}

// Tabela no computador; no celular cada linha vira um cartão (o cabeçalho
// some e cada célula mostra o próprio rótulo). Uma marcação só: links
// duplicados confundiriam leitor de tela.
export const LINHA = "block border-b border-border p-4 last:border-b-0 md:table-row md:p-0";
export const CELULA = "block py-1 md:table-cell md:px-4 md:py-3 md:align-middle";
export const ROTULO_CELULA = "mr-1 text-xs font-medium text-ink-soft md:hidden";

export function TabelaDeContas({ testId, colunas, children }: { testId: string; colunas: string[]; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full text-left text-sm" data-testid={testId}>
        <thead className="hidden bg-paper-muted text-xs font-semibold text-ink-soft md:table-header-group">
          <tr>
            {colunas.map((c) => (
              <th key={c} scope="col" className="px-4 py-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block md:table-row-group">{children}</tbody>
      </table>
    </div>
  );
}

export function SituacaoDaConta({ status }: { status: SituacaoConta }) {
  return (
    <td className={CELULA}>
      <span className={ROTULO_CELULA}>Situação:</span>
      <Badge cor={corConta(status)}>{SITUACOES_NA_LISTA[status]}</Badge>
    </td>
  );
}

export function AcaoDaConta({ conta }: { conta: { id: string; name: string; status: SituacaoConta } }) {
  const rotulo = rotuloDaAcao(conta.status);
  return (
    <td className={clsx(CELULA, "pt-3")}>
      <LinkBotao href={rotaFichaUsuario(conta.id)} variante="secundaria" className="min-h-11 whitespace-nowrap" aria-label={`${rotulo}: ${conta.name}`}>
        {rotulo}
      </LinkBotao>
    </td>
  );
}

export function SemContas() {
  return <p className="rounded-xl border border-border bg-card p-8 text-center text-ink-soft">Nenhuma conta encontrada.</p>;
}
