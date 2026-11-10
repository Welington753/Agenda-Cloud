// `/<slug>`: endereço curto do estabelecimento, que ainda abriga a página
// pública da demonstração (legado). Decidido no SERVIDOR, sem depender de
// JavaScript (regras em src/lib/agendamento-publico/endereco-curto.ts):
// - slug da semente da demonstração: a demonstração, como antes, com noindex;
// - estabelecimento real confirmado pela API: 308 para `/agendar/<slug>`;
// - API confirmou que não existe (ou página desligada): 404 (not-found.tsx);
// - API lenta, fora ou não configurada: 307 para a página real.
// As rotas fixas da raiz (`/login`, `/conta`...) nunca chegam aqui: o Next
// resolve a rota fixa antes da dinâmica.
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { gerarEstabelecimentosSeed } from "@/lib/seed/estabelecimentos";
import { destinoDoEnderecoCurto, slugPedido } from "@/lib/agendamento-publico/endereco-curto";
import { lerPaginaDaRequisicao } from "@/lib/agendamento-publico/leitura-da-requisicao";
import { METADADOS_NAO_ENCONTRADA } from "@/lib/site/metadados-do-site";
import { PaginaDaDemonstracao } from "./demonstracao";

/** Slugs fixos da demonstração. Um estabelecimento real com o mesmo slug só
 * é alcançado por `/agendar/<slug>` (colisão do achado R6). */
const SLUGS_DA_DEMONSTRACAO: ReadonlySet<string> = new Set(gerarEstabelecimentosSeed().map((e) => e.slug));

function ehDaDemonstracao(slug: string): boolean {
  const pedido = slugPedido(slug);
  return pedido !== null && SLUGS_DA_DEMONSTRACAO.has(pedido);
}

export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  // Estabelecimentos fictícios: nunca na busca.
  if (ehDaDemonstracao(slug)) return { robots: { index: false, follow: false } };
  // Mesma leitura da página (uma por requisição). No 404, o título da página
  // 404; nos redirecionamentos, nada é desenhado.
  const destino = destinoDoEnderecoCurto(slug, await lerPaginaDaRequisicao(slug));
  return destino.tipo === "inexistente" ? METADADOS_NAO_ENCONTRADA : {};
}

export default async function EnderecoCurto({ params }: PageProps<"/[slug]">) {
  const { slug } = await params;
  if (ehDaDemonstracao(slug)) return <PaginaDaDemonstracao slug={slugPedido(slug) ?? slug} />;

  const destino = destinoDoEnderecoCurto(slug, await lerPaginaDaRequisicao(slug));
  if (destino.tipo === "inexistente") notFound();
  if (destino.permanente) permanentRedirect(destino.caminho);
  redirect(destino.caminho);
}
