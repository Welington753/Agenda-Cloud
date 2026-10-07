// Guarda de build do frontend publicado (ver next.config.ts e
// docs/runbooks/publicacao-piloto-render.md).
//
// `NEXT_PUBLIC_API_URL` é embutido no JavaScript do navegador durante o
// `next build`, nunca lido em runtime. Sem ele, `API_BASE_URL` cai no padrão
// local (`http://localhost:3001`, ver lib/config.ts) e o site publicado
// passaria a chamar a máquina de quem abre a página, sem nenhum erro de
// build. Por isso, num build da hospedagem (`RENDER=true`, variável que o
// Render define também durante o build), o valor é obrigatório.
//
// Dois modos, sempre escolhidos de propósito:
//
// 1. Mesma origem (o do piloto): o valor é exatamente o prefixo do proxy,
//    `/agenda_api`. O navegador só fala com o frontend, que encaminha à API
//    (src/lib/api/proxy.ts). O destino real fica em `API_PROXY_TARGET`, no
//    servidor, e precisa ser HTTPS na hospedagem.
//
// 2. Chamada direta: uma origem HTTPS exata. Recusa `*.onrender.com`: esse
//    domínio está na Public Suffix List, então API e frontend em subdomínios
//    dele são sites DIFERENTES para o navegador, e o cookie de sessão
//    `SameSite=Lax` nunca seria enviado nas chamadas da página à API. Nesse
//    modo os dois precisam estar em subdomínios do MESMO domínio próprio.

import { PREFIXO_PROXY_API } from "../api/proxy-config";

type Ambiente = Record<string, string | undefined>;

const SUFIXO_PUBLICO_DA_HOSPEDAGEM = ".onrender.com";

function ehOrigemHttpsExata(valor: string | undefined): boolean {
  if (!valor) return false;
  try {
    const url = new URL(valor);
    return url.protocol === "https:" && url.origin === valor;
  } catch {
    return false;
  }
}

/** Mensagem de erro (sem ecoar o valor recebido) ou `null` quando o build
 * pode seguir. Fora da hospedagem só recusa um caminho relativo diferente do
 * prefixo do proxy (que o navegador mandaria para uma rota inexistente);
 * desenvolvimento e CI continuam usando o endereço local. */
export function erroDeApiUrlDePublicacao(ambiente: Ambiente): string | null {
  const valor = ambiente.NEXT_PUBLIC_API_URL;

  if (valor?.startsWith("/") && valor !== PREFIXO_PROXY_API) {
    return `NEXT_PUBLIC_API_URL relativo só pode ser o prefixo do proxy (${PREFIXO_PROXY_API}).`;
  }

  if (ambiente.RENDER !== "true") return null;

  if (!valor) {
    return "NEXT_PUBLIC_API_URL precisa estar definido no build do frontend publicado.";
  }

  if (valor === PREFIXO_PROXY_API) {
    if (!ehOrigemHttpsExata(ambiente.API_PROXY_TARGET)) {
      return "API_PROXY_TARGET precisa ser a origem HTTPS exata da API quando NEXT_PUBLIC_API_URL usa o proxy.";
    }
    return null;
  }

  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return "NEXT_PUBLIC_API_URL precisa ser uma URL válida.";
  }
  if (url.protocol !== "https:" || url.origin !== valor) {
    return "NEXT_PUBLIC_API_URL precisa ser uma origem HTTPS exata, sem caminho nem barra final.";
  }
  if (url.hostname.endsWith(SUFIXO_PUBLICO_DA_HOSPEDAGEM)) {
    return `NEXT_PUBLIC_API_URL direto precisa usar o domínio próprio, nunca *.onrender.com (o cookie de sessão não seria enviado). Nos endereços gratuitos, use o proxy: ${PREFIXO_PROXY_API}.`;
  }
  return null;
}
