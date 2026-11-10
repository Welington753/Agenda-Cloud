// Metadados comuns do site (layout raiz e página inicial). A origem vem só do
// ambiente do servidor (origem-do-site.ts); sem ela, nenhum endereço absoluto
// é publicado.
import type { Metadata } from "next";
import { NOME_PRODUTO } from "@/lib/config";
import type { ConfiguracaoDoSite } from "./origem-do-site";

type Ambiente = Record<string, string | undefined>;

export const TITULO_DO_SITE = `${NOME_PRODUTO} — Agenda e gestão para pequenos negócios`;
export const DESCRICAO_DO_SITE =
  "Agenda e gestão simples para salões, clínicas, estúdios, pet shops, terapeutas, consultores e outros negócios com horário marcado.";

/** Partes do Open Graph repetidas em cada página que define o seu: no Next,
 * o `openGraph` de um segmento SUBSTITUI o do pai, não mescla. */
export const OPEN_GRAPH_COMUM = { siteName: NOME_PRODUTO, locale: "pt_BR", type: "website" } as const;

/** Página 404 (src/app/not-found.tsx). Também usados pelos metadados de um
 * segmento que chama `notFound()`, para o título não ficar com o do segmento. */
export const METADADOS_NAO_ENCONTRADA = {
  title: `Página não encontrada · ${NOME_PRODUTO}`,
  description: "Este endereço não existe ou a página foi desativada.",
} as const;

/** Imagem de compartilhamento do site (src/app/imagem-de-compartilhamento.png):
 * só a marca do produto. Citada só com origem confiável (caminho relativo à
 * `metadataBase`). Quem define o próprio `openGraph` precisa repetir a
 * imagem, porque o do segmento substitui o herdado. */
const ALT_IMAGEM_DE_COMPARTILHAMENTO = `${NOME_PRODUTO}: agenda online e gestão para pequenos negócios`;
export const IMAGEM_DE_COMPARTILHAMENTO = {
  url: "/imagem-de-compartilhamento.png",
  width: 1200,
  height: 630,
  alt: ALT_IMAGEM_DE_COMPARTILHAMENTO,
  type: "image/png",
} as const;

/** Código da meta tag de verificação do Google Search Console (propriedade
 * por prefixo de URL). Não é segredo — fica no HTML público —, mas é da conta
 * de quem administra o site, por isso vem do ambiente e não do repositório.
 * Só caracteres do formato que o Google gera; qualquer outra coisa é ignorada. */
export function codigoDeVerificacaoGoogle(ambiente: Ambiente): string | undefined {
  const valor = ambiente.GOOGLE_SITE_VERIFICATION?.trim();
  return valor && /^[A-Za-z0-9_-]{10,100}$/.test(valor) ? valor : undefined;
}

/** Metadados do layout raiz: valem para todas as páginas que não os trocam.
 * Sem `canonical` aqui: um canonical herdado apontaria as páginas filhas para
 * a página inicial. */
export function metadadosDaRaiz(site: ConfiguracaoDoSite, ambiente: Ambiente): Metadata {
  const verificacao = codigoDeVerificacaoGoogle(ambiente);
  return {
    metadataBase: site.origem ? new URL(site.origem) : undefined,
    title: TITULO_DO_SITE,
    description: DESCRICAO_DO_SITE,
    openGraph: {
      ...OPEN_GRAPH_COMUM,
      title: TITULO_DO_SITE,
      description: DESCRICAO_DO_SITE,
      images: site.origem ? [IMAGEM_DE_COMPARTILHAMENTO] : undefined,
    },
    twitter: { card: "summary_large_image", images: site.origem ? [IMAGEM_DE_COMPARTILHAMENTO.url] : undefined },
    robots: site.indexavel ? undefined : { index: false, follow: false },
    verification: verificacao ? { google: verificacao } : undefined,
  };
}
