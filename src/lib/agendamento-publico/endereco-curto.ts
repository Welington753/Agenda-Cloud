// Endereço curto do estabelecimento (`/<slug>`, src/app/[slug]/page.tsx):
// decide no SERVIDOR o que responder, para que o encaminhamento e o 404 não
// dependam de JavaScript.
//
// - Slug da demonstração (semente fixa do código): a página da demonstração,
//   sem chamar a API. Decidido antes desta função, porque não depende da API.
// - API confirmou o estabelecimento: 308 para `/agendar/<slug da API>`.
//   Permanente porque o destino é função só do slug (o mesmo para qualquer
//   estado do estabelecimento), então um cache do redirecionamento nunca
//   aponta para o lugar errado.
// - API respondeu 404 (inexistente, página desligada ou estabelecimento
//   inativo) ou slug fora do formato: 404 aqui mesmo.
// - Qualquer dúvida (API hibernada, lenta, erro): 307 para a página real, que
//   tem a própria recuperação. Temporário de propósito: lentidão nunca vira
//   "inexistente", e a resposta da dúvida não deve ficar em cache.
import { caminhoDaPaginaPublica } from "./metadados-publicos";
import { slugPublicoNormalizado, type PaginaNoServidor } from "./pagina-no-servidor";

export type DestinoDoEnderecoCurto =
  | { tipo: "redirecionar"; caminho: string; permanente: boolean }
  | { tipo: "inexistente" };

/** O slug como foi pedido, decodificado e sem normalizar: a demonstração
 * compara slugs exatos (src/lib/repositories, `obterPorSlug`). */
export function slugPedido(slug: string): string | null {
  try {
    return decodeURIComponent(slug);
  } catch {
    return null;
  }
}

export function destinoDoEnderecoCurto(slug: string, leitura: PaginaNoServidor): DestinoDoEnderecoCurto {
  if (leitura.tipo === "encontrada") {
    return { tipo: "redirecionar", caminho: caminhoDaPaginaPublica(leitura.slug), permanente: true };
  }
  if (leitura.tipo === "inexistente") return { tipo: "inexistente" };
  const normalizado = slugPublicoNormalizado(slug);
  return normalizado === null
    ? { tipo: "inexistente" }
    : { tipo: "redirecionar", caminho: caminhoDaPaginaPublica(normalizado), permanente: false };
}
