"use client";

// `/<slug>` é o endereço curto do estabelecimento e ainda abriga a página
// pública da demonstração (localStorage). Slug da demonstração neste
// navegador: a demonstração, como antes. Qualquer outro vai para a página
// real (`/agendar/<slug>`), que trata estabelecimento inexistente e
// indisponível. As rotas fixas da raiz (`/login`, `/conta`...) nunca chegam
// aqui: o Next resolve a rota fixa antes da dinâmica.
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { estabelecimentoRepository, profissionalRepository, servicoRepository } from "@/lib/repositories";
import { useClientData } from "@/lib/hooks/use-client-data";
import { obterTerminologia } from "@/lib/verticals/terminologia";
import { featureHabilitada, podeReceberAgendamentoPublico } from "@/lib/access/access-control";
import { Skeleton } from "@/components/ui/skeleton";
import { ModeloClassico } from "@/components/publico/modelo-classico";
import { ModeloModerno } from "@/components/publico/modelo-moderno";
import { linkPublico } from "@/lib/agendamento-publico/agendamento-publico";

export default function PaginaPublicaEstabelecimento() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();

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

  const foraDaDemonstracao = !carregando && !dados;
  useEffect(() => {
    if (foraDaDemonstracao) router.replace(linkPublico("", slug));
  }, [foraDaDemonstracao, router, slug]);

  if (!dados) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { estabelecimento, profissionais, servicos } = dados;
  const terminologia = obterTerminologia(estabelecimento.categoria);
  const agendamentoPublicoHabilitado =
    featureHabilitada(estabelecimento.plano, estabelecimento.featuresDesativadas, "agendamentoPublico") &&
    podeReceberAgendamentoPublico(estabelecimento.status);

  const props = { slug, estabelecimento, profissionais, servicos, terminologia, agendamentoPublicoHabilitado };

  // Nenhum código separado por estabelecimento: os dois modelos recebem os
  // mesmos dados, só a apresentação (`modelo-classico.tsx`/`modelo-moderno.tsx`) muda.
  return estabelecimento.identidadeVisual.modelo === "moderno" ? <ModeloModerno {...props} /> : <ModeloClassico {...props} />;
}
