import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarcadorAparelho } from "@/components/aparencia/aparencia";
import { paginaPodeSerIndexada } from "@/lib/agendamento-publico/indexacao-da-pagina";
import {
  lerClassificacaoDoProxy,
  lerPaginaDaRequisicao as lerPagina,
} from "@/lib/agendamento-publico/leitura-da-requisicao";
import {
  DESCRICAO_PAGINA_PUBLICA_GENERICA,
  TITULO_PAGINA_PUBLICA_GENERICO,
  caminhoDaPaginaPublica,
  descricaoDaPaginaPublica,
  jsonLdDaPaginaPublica,
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
// Indexação: a decisão vem de src/proxy.ts (cabeçalho interno), a mesma que
// pôs ou não o `X-Robots-Tag`; o layout não decide de novo, para o HTML e o
// cabeçalho nunca divergirem. Estabelecimento de teste: a página funciona e
// pode ser compartilhada (título e Open Graph, quando a leitura daqui deu
// certo), mas sai com `noindex, nofollow`, sem canonical e sem dados
// estruturados. Sem classificação confiável o proxy já respondeu 503 e esta
// página nem chega a renderizar. Regras: indexacao-da-pagina.ts.

export async function generateMetadata({ params }: LayoutProps<"/agendar/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const leitura = await lerPagina(slug);
  if (leitura.tipo === "inexistente") return METADADOS_NAO_ENCONTRADA;
  const indexavel = paginaPodeSerIndexada(await lerClassificacaoDoProxy(), leitura);
  const robots = indexavel ? {} : { robots: { index: false, follow: false } };
  if (leitura.tipo === "desconhecida") {
    return { title: TITULO_PAGINA_PUBLICA_GENERICO, description: DESCRICAO_PAGINA_PUBLICA_GENERICA, ...robots };
  }
  const site = lerConfiguracaoDoSite(process.env);
  const caminho = caminhoDaPaginaPublica(leitura.slug);
  const titulo = tituloDaPaginaPublica(leitura.pagina.establishment.name);
  const descricao = descricaoDaPaginaPublica(leitura.pagina);
  return {
    title: titulo,
    description: descricao,
    ...robots,
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
    leitura.tipo === "encontrada" && paginaPodeSerIndexada(await lerClassificacaoDoProxy(), leitura)
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
