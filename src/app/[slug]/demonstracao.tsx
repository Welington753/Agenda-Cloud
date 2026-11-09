"use client";

// Página pública da DEMONSTRAÇÃO (localStorage, legado) no endereço curto
// `/<slug>`. O servidor (page.tsx) decide antes quem chega aqui:
// - `PaginaDaDemonstracao`: slug da semente fixa da demonstração. Se o
//   navegador apagou ou renomeou esse estabelecimento, vai para a página real,
//   como antes.
// - `DemonstracaoOuNaoEncontrada`: dentro do 404 (not-found.tsx), quando a API
//   confirmou que não há estabelecimento real com o slug. Um estabelecimento
//   criado na demonstração deste navegador ainda aparece; para qualquer outro
//   visitante (e para quem não roda JavaScript) fica a página 404 do servidor.
import { useEffect, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { estabelecimentoRepository, profissionalRepository, servicoRepository } from "@/lib/repositories";
import { useClientData } from "@/lib/hooks/use-client-data";
import { obterTerminologia } from "@/lib/verticals/terminologia";
import { featureHabilitada, podeReceberAgendamentoPublico } from "@/lib/access/access-control";
import { Skeleton } from "@/components/ui/skeleton";
import { ModeloClassico } from "@/components/publico/modelo-classico";
import { ModeloModerno } from "@/components/publico/modelo-moderno";
import { linkPublico } from "@/lib/agendamento-publico/agendamento-publico";

function useDemonstracao(slug: string) {
  return useClientData(() => {
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
}

type Dados = NonNullable<ReturnType<typeof useDemonstracao>["dados"]>;

function Vitrine({ slug, dados }: { slug: string; dados: Dados }) {
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

export function PaginaDaDemonstracao({ slug }: { slug: string }) {
  const router = useRouter();
  const { dados, carregando } = useDemonstracao(slug);

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
  return <Vitrine slug={slug} dados={dados} />;
}

export function DemonstracaoOuNaoEncontrada({ children }: { children: ReactNode }) {
  const params = useParams<{ slug: string }>();
  let slug = params.slug;
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // slug mal codificado: nenhum estabelecimento da demonstração o tem.
  }
  const { dados } = useDemonstracao(slug);
  return dados ? <Vitrine slug={slug} dados={dados} /> : children;
}
