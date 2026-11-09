// Cabeçalhos HTTP do frontend, aplicados pelo next.config.ts (fonte única;
// testados em cabecalhos.test.ts).
//
// 1. Segurança, em todas as respostas. A CSP é deliberadamente moderada:
//    sem nonce (exigiria renderizar toda página por requisição), então
//    scripts e estilos inline continuam permitidos — o script de aparência
//    do <head> e os scripts de hidratação do Next.js precisam disso. O ganho
//    está no resto: só conexões com a própria origem e com a API configurada,
//    nenhum plugin, nenhuma página de outro site enquadrando esta, `<base>` e
//    formulários presos à própria origem.
// 2. `X-Robots-Tag: noindex` nas áreas que nunca devem aparecer em busca
//    (conta, portal, login, convite, senha, demonstração). Elas continuam
//    rastreáveis no robots.txt de propósito: um endereço bloqueado ali não
//    tem o `noindex` lido e pode ser indexado só pelo link.

type Cabecalho = { key: string; value: string };
type Regra = { source: string; headers: Cabecalho[] };

export interface EntradaCabecalhos {
  /** `API_BASE_URL` do build: uma origem (chamada direta) ou `/agenda_api`. */
  apiBaseUrl: string;
  /** `API_PROXY_TARGET`, se definido no build: o navegador pede a partida da
   * API hibernada direto nessa origem (src/lib/api/acordar-api.ts). */
  destinoProxy: string | undefined;
  /** `next dev` precisa de `eval` (React em desenvolvimento). */
  desenvolvimento: boolean;
}

/** Áreas fora da busca. Padrões do next.config (`:path*` inclui a raiz). */
export const ROTAS_SEM_INDEXACAO = [
  "/conta/:path*",
  "/portal/:path*",
  "/login/:path*",
  "/cadastro/:path*",
  "/convite/:path*",
  "/redefinir-senha/:path*",
  "/agenda_api/:path*",
  "/403/:path*",
  // Demonstração local (localStorage), legado.
  "/painel/:path*",
  "/master/:path*",
  "/profissional/:path*",
  "/onboarding/:path*",
  "/:slug/agendar/:path*",
  "/:slug/agendamento/:path*",
] as const;

function origemDe(valor: string | undefined): string | null {
  if (!valor || valor.startsWith("/")) return null;
  try {
    const url = new URL(valor);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function politicaDeConteudo(entrada: EntradaCabecalhos): string {
  const conexoes = new Set(["'self'"]);
  for (const origem of [origemDe(entrada.apiBaseUrl), origemDe(entrada.destinoProxy)]) {
    if (origem) conexoes.add(origem);
  }
  const diretivas = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${entrada.desenvolvimento ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // `https:`: fotos e logos da demonstração vêm de endereços externos.
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src ${[...conexoes].join(" ")}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return diretivas.join("; ");
}

export function cabecalhosDeSeguranca(entrada: EntradaCabecalhos): Cabecalho[] {
  return [
    { key: "Content-Security-Policy", value: politicaDeConteudo(entrada) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Nenhuma tela usa câmera, microfone, localização ou pagamento pelo
    // navegador. Notificações e push não são controlados por este cabeçalho.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
    // Sem `includeSubDomains` nem `preload`: o domínio próprio ainda não
    // existe, e as duas opções valeriam para subdomínios que este serviço não
    // controla (decisão a tomar com o domínio, ver docs/runbooks).
    // Navegadores ignoram este cabeçalho em HTTP (desenvolvimento local).
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
  ];
}

/** Regras do `headers()` do next.config, na ordem de aplicação: quando duas
 * regras definem a mesma chave, vale a última (por isso o service worker,
 * com CSP própria e mais estrita, vem depois da regra geral). */
export function regrasDeCabecalhos(entrada: EntradaCabecalhos): Regra[] {
  return [
    { source: "/:path*", headers: cabecalhosDeSeguranca(entrada) },
    ...ROTAS_SEM_INDEXACAO.map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    })),
    // Service worker das notificações (public/sw.js): sempre a versão nova,
    // nunca de cache, e só scripts da própria origem. Ele mesmo não guarda
    // página, sessão nem resposta da API (não há manipulador de fetch).
    {
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
      ],
    },
  ];
}
