// Cabeçalho `X-Robots-Tag` da página pública de um estabelecimento de teste
// (`/agendar/<slug>`), decidido em src/proxy.ts antes da resposta sair.
// O `next.config` só tem cabeçalhos fixos por caminho; a marca de teste é por
// estabelecimento e vem da API (`indexable: false` em `GET /public/:slug`).
//
// - Encontrada e de teste: `noindex, nofollow`.
// - Encontrada e real, inexistente (a página 404 já tem `noindex` no HTML) ou
//   qualquer dúvida (API lenta, fora, sem configuração): nenhum cabeçalho.
//   Um estabelecimento real nunca sai da busca porque a API estava acordando;
//   o custo é um teste poder ficar sem o cabeçalho numa resposta dessas.
import { paginaIndexavel } from "./metadados-publicos";
import type { PaginaNoServidor } from "./pagina-no-servidor";

export const CABECALHO_ROBOTS = "X-Robots-Tag";
export const VALOR_SEM_INDEXACAO = "noindex, nofollow";

export function robotsDaPaginaPublica(leitura: PaginaNoServidor): string | null {
  return leitura.tipo === "encontrada" && !paginaIndexavel(leitura.pagina) ? VALOR_SEM_INDEXACAO : null;
}

/** Slug do caminho `/agendar/<slug>` (um segmento só), ou `null`. */
export function slugDoCaminhoAgendar(caminho: string): string | null {
  const m = /^\/agendar\/([^/]+)\/?$/.exec(caminho);
  return m ? m[1] : null;
}
