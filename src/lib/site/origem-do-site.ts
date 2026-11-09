// Origem pública do site para endereços canônicos, sitemap, robots.txt e
// Open Graph. Vem só do ambiente do servidor (a mesma variável que o proxy
// usa, ver src/lib/api/proxy-config.ts), nunca de `Host`, `X-Forwarded-Host`
// ou outro cabeçalho que o visitante controla.
//
// Lida no BUILD pelas páginas estáticas (página inicial, sitemap, robots):
// o Render define `RENDER_EXTERNAL_URL` também no build, e `APP_PUBLIC_ORIGIN`
// (domínio próprio) precisa estar no ambiente antes do build que deve usá-lo.
import { valorDaOrigemPublica } from "../api/proxy-config";

type Ambiente = Record<string, string | undefined>;

export interface ConfiguracaoDoSite {
  /** Origem HTTPS exata (`https://host[:porta]`), ou `null` quando ausente ou
   * inválida: nesse caso nenhum endereço absoluto é publicado. */
  origem: string | null;
  /** `false` em ambiente de pré-visualização (pull request no Render): o
   * robots.txt bloqueia tudo e as páginas levam `noindex`. Sem origem, o site
   * continua indexável, só sem endereços absolutos (canonical e sitemap). */
  indexavel: boolean;
}

function origemHttpsExata(valor: string | undefined): string | null {
  if (!valor) return null;
  try {
    const url = new URL(valor);
    return url.protocol === "https:" && url.origin === valor ? valor : null;
  } catch {
    return null;
  }
}

export function lerConfiguracaoDoSite(ambiente: Ambiente): ConfiguracaoDoSite {
  // Render define IS_PULL_REQUEST=true nas pré-visualizações de pull request.
  const previa = ambiente.IS_PULL_REQUEST === "true";
  const origem = origemHttpsExata(valorDaOrigemPublica(ambiente));
  return { origem, indexavel: !previa };
}

/** Endereço absoluto de um caminho do site, ou `null` sem origem confiável.
 * O resultado nunca sai da origem (um `//host` seria outro site). */
export function enderecoAbsoluto(configuracao: ConfiguracaoDoSite, caminho: string): string | null {
  if (configuracao.origem === null || !caminho.startsWith("/") || caminho.startsWith("//")) return null;
  const url = new URL(caminho, configuracao.origem);
  return url.origin === configuracao.origem ? url.toString() : null;
}
