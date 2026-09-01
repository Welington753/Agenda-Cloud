"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Store } from "lucide-react";
import { estabelecimentoRepository, profissionalRepository, servicoRepository } from "@/lib/repositories";
import { useClientData } from "@/lib/hooks/use-client-data";
import { obterTerminologia } from "@/lib/verticals/terminologia";
import { featureHabilitada } from "@/lib/access/access-control";
import { Botao } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ModeloClassico } from "@/components/publico/modelo-classico";
import { ModeloModerno } from "@/components/publico/modelo-moderno";

export default function PaginaPublicaEstabelecimento() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const { dados, carregando } = useClientData(() => {
    const estabelecimento = estabelecimentoRepository.obterPorSlug(slug);
    if (!estabelecimento) return null;
    const profissionais = profissionalRepository
      .listarPorTenant(estabelecimento.tenantId)
      .filter((p) => p.ativo && p.agendamentoOnlineAtivo);
    const servicos = servicoRepository
      .listarPorTenant(estabelecimento.tenantId)
      .filter((s) => s.ativoNoAgendamentoPublico);
    return { estabelecimento, profissionais, servicos };
  }, [slug]);

  if (carregando) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!dados) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
        <EstadoVazio
          icone={Store}
          titulo="Estabelecimento não encontrado"
          descricao={`Não existe nenhum estabelecimento com o endereço "/${slug}" nesta demonstração.`}
          acao={
            <Link href="/">
              <Botao variante="secundaria" tamanho="sm">
                Voltar para a apresentação
              </Botao>
            </Link>
          }
        />
      </div>
    );
  }

  const { estabelecimento, profissionais, servicos } = dados;
  const terminologia = obterTerminologia(estabelecimento.categoria);
  const agendamentoPublicoHabilitado = featureHabilitada(
    estabelecimento.plano,
    estabelecimento.featuresDesativadas,
    "agendamentoPublico"
  );

  const props = { slug, estabelecimento, profissionais, servicos, terminologia, agendamentoPublicoHabilitado };

  // Nenhum código separado por estabelecimento: os dois modelos recebem os
  // mesmos dados, só a apresentação (`modelo-classico.tsx`/`modelo-moderno.tsx`) muda.
  return estabelecimento.identidadeVisual.modelo === "moderno" ? <ModeloModerno {...props} /> : <ModeloClassico {...props} />;
}
