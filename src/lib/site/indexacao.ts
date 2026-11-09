// Regras do sitemap.xml e do robots.txt (src/app/sitemap.ts e robots.ts).
//
// SITEMAP: só a página inicial. As páginas de agendamento dos
// estabelecimentos (`/agendar/<slug>`) são públicas e indexáveis, com título
// e canonical próprios, mas NÃO entram aqui: não há lista pública de
// estabelecimentos (montá-la exporia a carteira de clientes), nem como
// separar no banco os estabelecimentos de teste dos reais. Cada página chega
// à busca pelo link que o próprio estabelecimento divulga. Sem `lastModified`:
// nenhuma data real de alteração é conhecida, e uma data inventada só
// atrapalha o buscador.
//
// ROBOTS: rastreamento livre, exceto o proxy da API (só JSON). As áreas
// privadas NÃO são bloqueadas aqui de propósito: bloqueado, o buscador não lê
// o `noindex` delas. Na pré-visualização de pull request, tudo bloqueado.
import type { MetadataRoute } from "next";
import { PREFIXO_PROXY_API } from "../api/proxy-config";
import { enderecoAbsoluto, type ConfiguracaoDoSite } from "./origem-do-site";

export function entradasDoSitemap(site: ConfiguracaoDoSite): MetadataRoute.Sitemap {
  const inicial = site.indexavel ? enderecoAbsoluto(site, "/") : null;
  return inicial ? [{ url: inicial }] : [];
}

export function regrasDoRobots(site: ConfiguracaoDoSite): MetadataRoute.Robots {
  if (!site.indexavel) return { rules: { userAgent: "*", disallow: "/" } };
  const sitemap = enderecoAbsoluto(site, "/sitemap.xml");
  return {
    rules: { userAgent: "*", allow: "/", disallow: `${PREFIXO_PROXY_API}/` },
    ...(sitemap ? { sitemap } : {}),
  };
}
