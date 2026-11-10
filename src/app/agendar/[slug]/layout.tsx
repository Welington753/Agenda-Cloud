import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarcadorAparelho } from "@/components/aparencia/aparencia";
import { lerPaginaDaRequisicao as lerPagina } from "@/lib/agendamento-publico/leitura-da-requisicao";
import {
  DESCRICAO_PAGINA_PUBLICA_GENERICA,
  TITULO_PAGINA_PUBLICA_GENERICO,
  caminhoDaPaginaPublica,
  descricaoDaPaginaPublica,
  jsonLdDaPaginaPublica,
  paginaIndexavel,
  tituloDaPaginaPublica,
} from "@/lib/agendamento-publico/metadados-publicos";
import { serializarJsonLd } from "@/lib/site/dados-estruturados";
import { IMAGEM_DE_COMPARTILHAMENTO, METADADOS_NAO_ENCONTRADA, OPEN_GRAPH_COMUM } from "@/lib/site/metadados-do-site";
import { enderecoAbsoluto, lerConfiguracaoDoSite } from "@/lib/site/origem-do-site";

// Agendamento público: segue SEMPRE a aparência do aparelho do cliente,
// mesmo que o dono tenha escolhido um tema na área privada deste navegador.
//
// Layout de SERVIDOR: lê a página pública uma vez por requisição (a mesma
// leitura serve o layout e os metadados, ver leitura-da-requisicao.ts) para
// dar título, descrição, endereço canônico e dados estruturados do
// estabelecimento certo, e para responder 404 de verdade quando a API
// confirma que ele não existe ou que a página está desligada. A tela continua
// no navegador (page.tsx), sem mudança.
// Regras da leitura: lib/agendamento-publico/pagina-no-servidor.ts.
//
// Estabelecimento de teste (`indexable: false` na leitura): a página
// funciona e pode ser compartilhada (título e Open Graph continuam), mas sai
// com `noindex, nofollow`, sem canonical e sem dados estruturados. O mesmo
// `noindex` vai no cabeçalho `X-Robots-Tag` (src/proxy.ts), para valer
// também para quem lê só os cabeçalhos. Na dúvida (API lenta), nada muda:
// um estabelecimento real nunca sai da busca porque a API estava acordando.

export async function generateMetadata({ params }: LayoutProps<"/agendar/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const leitura = await lerPagina(slug);
  if (leitura.tipo === "inexistente") return METADADOS_NAO_ENCONTRADA;
  if (leitura.tipo === "desconhecida") {
    return { title: TITULO_PAGINA_PUBLICA_GENERICO, description: DESCRICAO_PAGINA_PUBLICA_GENERICA };
  }
  const site = lerConfiguracaoDoSite(process.env);
  const caminho = caminhoDaPaginaPublica(leitura.slug);
  const titulo = tituloDaPaginaPublica(leitura.pagina.establishment.name);
  const descricao = descricaoDaPaginaPublica(leitura.pagina);
  const indexavel = paginaIndexavel(leitura.pagina);
  return {
    title: titulo,
    description: descricao,
    ...(indexavel ? {} : { robots: { index: false, follow: false } }),
    alternates: indexavel && site.indexavel && site.origem ? { canonical: caminho } : undefined,
    openGraph: {
      ...OPEN_GRAPH_COMUM,
      url: site.origem ? caminho : undefined,
      title: titulo,
      description: descricao,
      images: site.origem ? [IMAGEM_DE_COMPARTILHAMENTO] : undefined,
    },
    twitter: { card: "summary_large_image", images: site.origem ? [IMAGEM_DE_COMPARTILHAMENTO.url] : undefined },
  };
}

export default async function AgendarLayout({ children, params }: LayoutProps<"/agendar/[slug]">) {
  const { slug } = await params;
  const leitura = await lerPagina(slug);
  if (leitura.tipo === "inexistente") notFound();

  const url =
    leitura.tipo === "encontrada" && paginaIndexavel(leitura.pagina)
      ? enderecoAbsoluto(lerConfiguracaoDoSite(process.env), caminhoDaPaginaPublica(leitura.slug))
      : null;

  return (
    <>
      {leitura.tipo === "encontrada" && url && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializarJsonLd(jsonLdDaPaginaPublica(leitura.pagina, url)) }}
        />
      )}
      <MarcadorAparelho />
      {children}
    </>
  );
}
