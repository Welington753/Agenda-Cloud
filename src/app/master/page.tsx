"use client";

import { useState } from "react";
import { Building2, CalendarCheck2, DollarSign, RotateCcw, ShieldCheck, TestTube2, UsersRound } from "lucide-react";
import { useClientData } from "@/lib/hooks/use-client-data";
import { agendamentoRepository, estabelecimentoRepository } from "@/lib/repositories";
import { restaurarPlataformaCompleta } from "@/lib/repositories/restaurar";
import { EstatisticaCard } from "@/components/painel/estatistica-card";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { BadgeStatusEstabelecimento, Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ModalSuporte } from "@/components/master/modal-suporte";
import { formatarData, formatarMoeda } from "@/lib/format";
import { obterDefinicaoPlano } from "@/lib/planos";
import Link from "next/link";
import type { Estabelecimento } from "@/lib/types";

export default function MasterDashboardPage() {
  const [suporteAberto, setSuporteAberto] = useState<Estabelecimento | null>(null);

  const { dados, carregando } = useClientData(() => {
    const estabelecimentos = estabelecimentoRepository.listarTodos();
    const totalProfissionais = estabelecimentos.reduce((s, e) => s + e.quantidadeProfissionais, 0);
    const totalAgendamentos = estabelecimentos.reduce(
      (s, e) => s + agendamentoRepository.listarPorTenant(e.tenantId).length,
      0
    );
    const mrrCentavos = estabelecimentos
      .filter((e) => e.status === "ativo" || e.status === "inadimplente")
      .reduce((s, e) => s + obterDefinicaoPlano(e.plano).precoCentavos, 0);

    return {
      estabelecimentos,
      totalProfissionais,
      totalAgendamentos,
      mrrCentavos,
      ativos: estabelecimentos.filter((e) => e.status === "ativo").length,
      emTeste: estabelecimentos.filter((e) => e.status === "teste").length,
    };
  }, []);

  if (carregando || !dados) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-ink">Dashboard master</h1>
          <p className="text-sm text-ink-soft">Visão geral de todos os estabelecimentos da plataforma.</p>
        </div>
        <Link href="/master/estabelecimentos/novo">
          <Botao tamanho="sm">Novo estabelecimento</Botao>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <EstatisticaCard icone={Building2} rotulo="Estabelecimentos" valor={String(dados.estabelecimentos.length)} />
        <EstatisticaCard icone={ShieldCheck} rotulo="Ativos" valor={String(dados.ativos)} corIcone="success" />
        <EstatisticaCard icone={TestTube2} rotulo="Em teste" valor={String(dados.emTeste)} corIcone="info" />
        <EstatisticaCard icone={UsersRound} rotulo="Profissionais na plataforma" valor={String(dados.totalProfissionais)} />
        <EstatisticaCard icone={CalendarCheck2} rotulo="Agendamentos realizados" valor={String(dados.totalAgendamentos)} />
        <EstatisticaCard
          icone={DollarSign}
          rotulo="Receita recorrente simulada"
          valor={formatarMoeda(dados.mrrCentavos)}
          corIcone="accent"
        />
      </div>

      <Cartao>
        <CartaoCorpo>
          <CartaoTitulo className="mb-3">Estabelecimentos</CartaoTitulo>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-ink-soft">
                  <th className="pb-2 pr-4 font-semibold">Nome</th>
                  <th className="pb-2 pr-4 font-semibold">Status</th>
                  <th className="pb-2 pr-4 font-semibold">Plano</th>
                  <th className="pb-2 pr-4 font-semibold">Profissionais</th>
                  <th className="pb-2 pr-4 font-semibold">Criado em</th>
                  <th className="pb-2 font-semibold">Suporte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dados.estabelecimentos.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2.5 pr-4 font-medium text-ink">
                      <Link href={`/master/estabelecimentos/${e.tenantId}`} className="hover:underline">
                        {e.identidadeVisual.nome}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">
                      <BadgeStatusEstabelecimento status={e.status} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge cor="destaque">{obterDefinicaoPlano(e.plano).nome}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-ink-soft">{e.quantidadeProfissionais}</td>
                    <td className="py-2.5 pr-4 text-ink-soft">{formatarData(e.criadoEm)}</td>
                    <td className="py-2.5">
                      <button
                        type="button"
                        onClick={() => setSuporteAberto(e)}
                        className="text-xs font-semibold text-accent hover:underline"
                      >
                        Acessar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CartaoCorpo>
      </Cartao>

      <Cartao className="border-dashed">
        <CartaoCorpo className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-ink">Restaurar toda a demonstração</p>
            <p className="text-sm text-ink-soft">
              Apaga os dados simulados de TODOS os estabelecimentos e recarrega a plataforma do zero.
            </p>
          </div>
          <Botao
            variante="secundaria"
            onClick={() => {
              if (
                !window.confirm(
                  "Isso vai apagar os dados simulados de todos os estabelecimentos (Dom Navalha, Clínica Sorriso Leve e os demais) e recarregar a página. Continuar?"
                )
              ) {
                return;
              }
              restaurarPlataformaCompleta();
            }}
          >
            <RotateCcw size={16} className="mr-1.5" /> Restaurar tudo
          </Botao>
        </CartaoCorpo>
      </Cartao>

      <ModalSuporte estabelecimento={suporteAberto} aoFechar={() => setSuporteAberto(null)} />
    </div>
  );
}
