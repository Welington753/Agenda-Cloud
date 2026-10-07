// Configuração do encaminhamento da API pelo próprio Next.js (rota
// `/agenda_api/...`, ver src/app/agenda_api/[...caminho]/route.ts e
// docs/runbooks/publicacao-piloto-render.md).
//
// Tudo aqui vem do ambiente do SERVIDOR do frontend, lido a cada requisição.
// Nenhuma variável é `NEXT_PUBLIC_*`: o navegador nunca vê o destino nem o
// segredo, e nada do que ele envia escolhe para onde a requisição vai.

type Ambiente = Record<string, string | undefined>;

/** Prefixo público do proxy. O sublinhado garante que ele nunca colide com o
 * slug de um estabelecimento (rota `/[slug]`): o slug só tem `[a-z0-9-]`
 * (ver backend/src/auth/slug.ts). Também não começa com `_`, que o App
 * Router trataria como pasta privada, fora das rotas. */
export const PREFIXO_PROXY_API = "/agenda_api";

/** Mesmo mínimo de `API_PROXY_SECRET` no backend
 * (backend/src/config/client-ip.ts). */
export const TAMANHO_MINIMO_SEGREDO_PROXY = 32;

const FONTES_IP_CLIENTE = ["socket", "cf-connecting-ip"] as const;
export type FonteIpCliente = (typeof FONTES_IP_CLIENTE)[number];

export interface ConfiguracaoProxy {
  /** Origem da API (`https://host[:porta]`), fixa. */
  destino: URL;
  /** Origem pública deste frontend: o `Origin` exigido em escritas. */
  origemPublica: string;
  /** Segredo compartilhado com a API. Sem ele, o IP do cliente nunca é
   * encaminhado. */
  segredo: string | undefined;
  /** De onde o frontend tira o IP do cliente para repassar à API. */
  fonteIpCliente: FonteIpCliente;
}

export type ResultadoConfiguracao =
  | { ok: true; configuracao: ConfiguracaoProxy }
  | { ok: false; campos: string[] };

/** `true` só para uma origem exata (`protocolo://host[:porta]`), sem caminho,
 * query, fragmento nem barra final. */
function ehOrigemExata(valor: string, protocolos: readonly string[]): boolean {
  try {
    const url = new URL(valor);
    return protocolos.includes(url.protocol) && url.origin === valor;
  } catch {
    return false;
  }
}

/** Na hospedagem (`RENDER=true`) tudo precisa ser HTTPS e o segredo é
 * obrigatório: a API do plano gratuito só é alcançável pela internet
 * pública, então o segredo é o que separa o proxy de qualquer outro
 * chamador. Fora dela (desenvolvimento e CI), HTTP local é aceito.
 *
 * A mensagem de erro lista só os nomes das variáveis, nunca os valores. */
export function lerConfiguracaoProxy(ambiente: Ambiente): ResultadoConfiguracao {
  const hospedado = ambiente.RENDER === "true";
  const protocolos = hospedado ? ["https:"] : ["https:", "http:"];
  const campos: string[] = [];

  const destino = ambiente.API_PROXY_TARGET;
  if (!destino || !ehOrigemExata(destino, protocolos)) campos.push("API_PROXY_TARGET");

  // `RENDER_EXTERNAL_URL` é definido pelo próprio Render em runtime
  // (`https://<servico>.onrender.com`). `APP_PUBLIC_ORIGIN` só é necessário
  // fora do Render ou com domínio próprio.
  const origemPublica = ambiente.APP_PUBLIC_ORIGIN ?? ambiente.RENDER_EXTERNAL_URL;
  if (!origemPublica || !ehOrigemExata(origemPublica, protocolos)) campos.push("APP_PUBLIC_ORIGIN");

  const segredo = ambiente.API_PROXY_SECRET;
  if (segredo !== undefined && segredo.length < TAMANHO_MINIMO_SEGREDO_PROXY) {
    campos.push("API_PROXY_SECRET");
  } else if (segredo === undefined && hospedado) {
    campos.push("API_PROXY_SECRET");
  }

  const fonte = ambiente.CLIENT_IP_SOURCE ?? "socket";
  if (!FONTES_IP_CLIENTE.includes(fonte as FonteIpCliente)) campos.push("CLIENT_IP_SOURCE");

  if (campos.length > 0) return { ok: false, campos };
  return {
    ok: true,
    configuracao: {
      destino: new URL(destino as string),
      origemPublica: origemPublica as string,
      segredo,
      fonteIpCliente: fonte as FonteIpCliente,
    },
  };
}
