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
// Também recusa `*.onrender.com`: esse domínio está na Public Suffix List,
// então API e frontend em subdomínios dele são sites DIFERENTES para o
// navegador, e o cookie de sessão `SameSite=Lax` nunca seria enviado nas
// chamadas da página à API. Os dois precisam estar em subdomínios do MESMO
// domínio próprio.

type Ambiente = Record<string, string | undefined>;

const SUFIXO_PUBLICO_DA_HOSPEDAGEM = ".onrender.com";

/** Mensagem de erro (sem ecoar o valor recebido) ou `null` quando o build
 * pode seguir. Fora da hospedagem não exige nada: desenvolvimento e CI
 * continuam usando o endereço local. */
export function erroDeApiUrlDePublicacao(ambiente: Ambiente): string | null {
  if (ambiente.RENDER !== "true") return null;

  const valor = ambiente.NEXT_PUBLIC_API_URL;
  if (!valor) {
    return "NEXT_PUBLIC_API_URL precisa estar definido no build do frontend publicado.";
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
    return "NEXT_PUBLIC_API_URL precisa usar o domínio próprio, nunca *.onrender.com (o cookie de sessão não seria enviado).";
  }
  return null;
}
