// O proxy de `/agendar/<slug>` contra uma API de mentira em HTTP de verdade
// (porta local): normal, lenta (passa do prazo), 502 e fora (conexão
// recusada). Na falha, nenhuma classificação antiga é reaproveitada: 503.
// A suíte de navegador `proxy` repete o essencial com o Next.js e a API reais.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CABECALHO_CLASSIFICACAO, VALOR_SEM_INDEXACAO } from "./indexacao-da-pagina";
import { respostaDoProxyAgendar, type DependenciasDoProxy } from "./proxy-da-pagina-publica";

type Modo = "normal" | "lenta" | "fora-500";
let modo: Modo = "normal";
const marcados = new Set<string>();
const leituras: string[] = [];

const servidor = http.createServer((req, res) => {
  const slug = /^\/public\/([^/?]+)$/.exec(req.url ?? "")?.[1] ?? "";
  leituras.push(slug);
  if (modo === "lenta") {
    const t = setTimeout(() => res.end(), 2_000);
    req.on("close", () => clearTimeout(t));
    return;
  }
  if (modo === "fora-500") {
    res.writeHead(502, { "content-type": "text/html" }).end("<h1>Bad gateway</h1>");
    return;
  }
  if (slug.startsWith("inexistente")) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ statusCode: 404 }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" }).end(
    JSON.stringify({
      profile: {
        establishment: { name: `Estúdio ${slug}`, slug, timezone: "America/Sao_Paulo" },
        services: [],
        professionals: [],
        indexable: !marcados.has(slug),
      },
    }),
  );
});

let porta = 0;
let portaFechada = 0;

beforeAll(async () => {
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  porta = (servidor.address() as AddressInfo).port;
  // Porta que ninguém escuta: aberta e fechada já.
  const sobra = http.createServer();
  await new Promise<void>((ok) => sobra.listen(0, "127.0.0.1", ok));
  portaFechada = (sobra.address() as AddressInfo).port;
  await new Promise<void>((ok) => sobra.close(() => ok()));
});
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));
beforeEach(() => {
  modo = "normal";
  marcados.clear();
  leituras.length = 0;
});

function dependencias(destinoPorta = porta): DependenciasDoProxy {
  return {
    prazoMs: 300,
    ambiente: { API_PROXY_TARGET: `http://127.0.0.1:${destinoPorta}`, APP_PUBLIC_ORIGIN: "https://agenda.example.test" },
  };
}

function pedido(caminho: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(new URL(caminho, "https://agenda.example.test"), init);
}

/** O que o layout vai ler: o cabeçalho interno que o proxy repassou. */
function classificacaoRepassada(r: Response): string | null {
  return r.headers.get(`x-middleware-request-${CABECALHO_CLASSIFICACAO}`);
}

async function chamar(caminho: string, destinoPorta = porta, init = {}) {
  return respostaDoProxyAgendar(pedido(caminho, init), dependencias(destinoPorta));
}

describe("API normal", () => {
  it("teste: X-Robots-Tag e decisão 'teste' para o HTML", async () => {
    marcados.add("teste-a");
    const r = await chamar("/agendar/teste-a");
    expect(r.status).toBe(200);
    expect(r.headers.get("x-robots-tag")).toBe(VALOR_SEM_INDEXACAO);
    expect(classificacaoRepassada(r)).toBe("teste");
  });

  it("real: sem X-Robots-Tag e decisão 'indexavel'", async () => {
    const r = await chamar("/agendar/real-b");
    expect(r.status).toBe(200);
    expect(r.headers.get("x-robots-tag")).toBeNull();
    expect(classificacaoRepassada(r)).toBe("indexavel");
  });

  it("inexistente: segue sem decisão (o layout responde 404)", async () => {
    const r = await chamar("/agendar/inexistente-x");
    expect(r.status).toBe(200);
    expect(r.headers.get("x-robots-tag")).toBeNull();
    expect(classificacaoRepassada(r)).toBeNull();
  });
});

function esperar503(r: Response) {
  expect(r.status).toBe(503);
  expect(r.headers.get("retry-after")).toBe("30");
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(r.headers.get("x-robots-tag")).toBeNull();
  expect(classificacaoRepassada(r)).toBeNull();
}

describe.each([
  ["lenta", "lenta" as const, () => porta],
  ["respondendo 502 da hospedagem", "fora-500" as const, () => porta],
  ["fora (conexão recusada)", "normal" as const, () => portaFechada],
])("API %s", (_nome, modoDaFalha, destino) => {
  it("teste e real já lidos antes: 503 para os dois, sem reaproveitar a classificação antiga", async () => {
    marcados.add("teste-a");
    expect(classificacaoRepassada(await chamar("/agendar/teste-a"))).toBe("teste");
    expect(classificacaoRepassada(await chamar("/agendar/real-b"))).toBe("indexavel");
    modo = modoDaFalha;
    esperar503(await chamar("/agendar/teste-a", destino()));
    esperar503(await chamar("/agendar/real-b", destino()));
  });

  it("sem leitura anterior: 503 com Retry-After, sem cache, link de nova tentativa e sem noindex; nunca 404", async () => {
    modo = modoDaFalha;
    const r = await chamar("/agendar/novo-c", destino());
    esperar503(r);
    expect(await r.text()).toContain("Tentar de novo agora");

    const head = await chamar("/agendar/novo-c", destino(), { method: "HEAD" });
    expect(head.status).toBe(503);
    expect(await head.text()).toBe("");
  });
});

describe("troca da marca seguida de falha da API", () => {
  it("real lido, depois marcado como teste, e a API falha: 503, não o indexável antigo", async () => {
    expect(classificacaoRepassada(await chamar("/agendar/loja-d"))).toBe("indexavel");
    marcados.add("loja-d");
    modo = "fora-500";
    esperar503(await chamar("/agendar/loja-d"));
  });

  it("teste lido, depois desmarcado, e a API falha: 503, não o noindex antigo", async () => {
    marcados.add("loja-e");
    expect(classificacaoRepassada(await chamar("/agendar/loja-e"))).toBe("teste");
    marcados.delete("loja-e");
    modo = "fora-500";
    esperar503(await chamar("/agendar/loja-e"));
  });

  it("a API volta: vale a classificação atual, nos dois sentidos", async () => {
    expect(classificacaoRepassada(await chamar("/agendar/loja-d"))).toBe("indexavel");
    marcados.add("loja-d");
    modo = "fora-500";
    esperar503(await chamar("/agendar/loja-d"));
    modo = "normal";
    const marcada = await chamar("/agendar/loja-d");
    expect(marcada.status).toBe(200);
    expect(marcada.headers.get("x-robots-tag")).toBe(VALOR_SEM_INDEXACAO);
    expect(classificacaoRepassada(marcada)).toBe("teste");

    marcados.delete("loja-d");
    modo = "lenta";
    esperar503(await chamar("/agendar/loja-d"));
    modo = "normal";
    const desmarcada = await chamar("/agendar/loja-d");
    expect(desmarcada.status).toBe(200);
    expect(desmarcada.headers.get("x-robots-tag")).toBeNull();
    expect(classificacaoRepassada(desmarcada)).toBe("indexavel");
  });
});

describe("cabeçalho interno forjado pelo cliente", () => {
  it("é apagado e substituído pela decisão do proxy", async () => {
    marcados.add("teste-a");
    const r = await chamar("/agendar/teste-a", porta, { headers: { [CABECALHO_CLASSIFICACAO]: "indexavel" } });
    expect(classificacaoRepassada(r)).toBe("teste");
    expect(r.headers.get("x-robots-tag")).toBe(VALOR_SEM_INDEXACAO);
  });

  it("é apagado também quando o proxy não decide (POST, sem configuração)", async () => {
    const post = await respostaDoProxyAgendar(
      pedido("/agendar/real-b", { method: "POST", headers: { [CABECALHO_CLASSIFICACAO]: "indexavel" } }),
      dependencias(),
    );
    const semConfig = await respostaDoProxyAgendar(
      pedido("/agendar/real-b", { headers: { [CABECALHO_CLASSIFICACAO]: "indexavel" } }),
      { ...dependencias(), ambiente: {} },
    );
    for (const r of [post, semConfig]) {
      expect(classificacaoRepassada(r)).toBeNull();
      expect(r.headers.get("x-middleware-override-headers")?.split(",")).not.toContain(CABECALHO_CLASSIFICACAO);
    }
    // Sem configuração, nada é lido na API.
    expect(leituras).toEqual([]);
  });
});
