"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { useClientData } from "@/lib/hooks/use-client-data";
import { estabelecimentoRepository } from "@/lib/repositories";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Badge, BadgeStatusEstabelecimento } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ModalSuporte } from "@/components/master/modal-suporte";
import { formatarData } from "@/lib/format";
import { obterDefinicaoPlano } from "@/lib/planos";
import { CATEGORIAS_NEGOCIO } from "@/lib/verticals/terminologia";
import type { CodigoPlano, Estabelecimento, StatusEstabelecimento } from "@/lib/types";

const ROTULO_CATEGORIA = new Map(CATEGORIAS_NEGOCIO.map((c) => [c.valor, c.rotulo]));

export default function MasterEstabelecimentosPage() {
  const [suporteAberto, setSuporteAberto] = useState<Estabelecimento | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusEstabelecimento | "todos">("todos");
  const [filtroPlano, setFiltroPlano] = useState<CodigoPlano | "todos">("todos");
  const { dados, carregando } = useClientData(() => estabelecimentoRepository.listarTodos(), []);

  const filtrados = useMemo(() => {
    if (!dados) return [];
    const termo = busca.trim().toLowerCase();
    return dados.filter((e) => {
      const bateBusca =
        !termo || e.identidadeVisual.nome.toLowerCase().includes(termo) || e.slug.toLowerCase().includes(termo);
      const bateStatus = filtroStatus === "todos" || e.status === filtroStatus;
      const batePlano = filtroPlano === "todos" || e.plano === filtroPlano;
      return bateBusca && bateStatus && batePlano;
    });
  }, [dados, busca, filtroStatus, filtroPlano]);

  if (carregando || !dados) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-ink">Estabelecimentos</h1>
          <p className="text-sm text-ink-soft">Todos os estabelecimentos cadastrados na plataforma (simulado).</p>
        </div>
        <Link href="/master/estabelecimentos/novo">
          <Botao tamanho="sm">
            <Plus size={16} className="mr-1.5" /> Novo estabelecimento
          </Botao>
        </Link>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou slug..."
            className="w-full rounded-[var(--radius-control)] border border-border bg-card py-2 pl-9 pr-3 text-sm text-ink"
          />
        </div>
        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value as StatusEstabelecimento | "todos")}
          className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
        >
          <option value="todos">Todos os status</option>
          <option value="ativo">Ativo</option>
          <option value="teste">Em teste</option>
          <option value="suspenso">Suspenso</option>
          <option value="inadimplente">Inadimplente</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <select
          value={filtroPlano}
          onChange={(e) => setFiltroPlano(e.target.value as CodigoPlano | "todos")}
          className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
        >
          <option value="todos">Todos os planos</option>
          <option value="essencial">Essencial</option>
          <option value="equipe">Equipe</option>
          <option value="pro">Pro</option>
        </select>
      </div>

      {filtrados.length === 0 ? (
        <EstadoVazio icone={Search} titulo="Nenhum estabelecimento encontrado" descricao="Ajuste a busca ou os filtros." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((e) => (
            <Cartao key={e.id}>
              <CartaoCorpo className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/master/estabelecimentos/${e.tenantId}`} className="flex items-center gap-2.5">
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                      style={{ backgroundColor: e.identidadeVisual.corDestaque }}
                    >
                      {e.identidadeVisual.logoIniciais}
                    </div>
                    <div>
                      <p className="font-semibold text-ink hover:underline">{e.identidadeVisual.nome}</p>
                      <p className="text-xs text-ink-soft">/{e.slug}</p>
                    </div>
                  </Link>
                  <BadgeStatusEstabelecimento status={e.status} />
                </div>
                <p className="text-xs text-ink-soft">{e.identidadeVisual.endereco}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                  <Badge cor="destaque">{obterDefinicaoPlano(e.plano).nome}</Badge>
                  <Badge cor="info">{ROTULO_CATEGORIA.get(e.categoria) ?? "Outro"}</Badge>
                  <span>{e.quantidadeProfissionais} profissional(is)</span>
                  <span>desde {formatarData(e.criadoEm)}</span>
                </div>
                <div className="flex gap-3">
                  <Link href={`/master/estabelecimentos/${e.tenantId}`} className="text-xs font-semibold text-accent hover:underline">
                    Gerenciar
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSuporteAberto(e)}
                    className="text-xs font-semibold text-ink-soft hover:underline"
                  >
                    Acessar como suporte
                  </button>
                </div>
              </CartaoCorpo>
            </Cartao>
          ))}
        </div>
      )}

      <ModalSuporte estabelecimento={suporteAberto} aoFechar={() => setSuporteAberto(null)} />
    </div>
  );
}
