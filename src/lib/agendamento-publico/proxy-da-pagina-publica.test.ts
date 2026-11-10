// O proxy de `/agendar/<slug>` contra uma API de mentira em HTTP de verdade
// (porta local): normal, lenta (passa do prazo) e fora (conexão recusada).
// A suíte de navegador `proxy` repete o essencial com o Next.js e a API reais.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CABECALHO_CLASSIFICACAO, MemoriaDeClassificacao, VALOR_SEM_INDEXACAO } from "./indexacao-da-pagina";
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
let agora = 0;
let memoria: MemoriaDeClassificacao;

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
  agora = 1_000_000;
  memoria = new MemoriaDeClassificacao();
});

function dependencias(destinoPorta = porta): DependenciasDoProxy {
  return {
    memoria,
    agora: () => agora,
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

describe.each([
  ["lenta", "lenta" as const, () => porta],
  ["respondendo 502 da hospedagem", "fora-500" as const, () => porta],
  ["fora (conexão recusada)", "normal" as const, () => portaFechada],
])("API %s", (_nome, modoDaFalha, destino) => {
  it("teste conhecido continua noindex; real conhecido continua normal; isolados", async () => {
    marcados.add("teste-a");
    await chamar("/agendar/teste-a");
    await chamar("/agendar/real-b");
    modo = modoDaFalha;
    agora += 60_000;

    const teste = await chamar("/agendar/teste-a", destino());
    expect(teste.status).toBe(200);
    expect(teste.headers.get("x-robots-tag")).toBe(VALOR_SEM_INDEXACAO);
    expect(classificacaoRepassada(teste)).toBe("teste");

    const real = await chamar("/agendar/real-b", destino());
    expect(real.status).toBe(200);
    expect(real.headers.get("x-robots-tag")).toBeNull();
    expect(classificacaoRepassada(real)).toBe("indexavel");
  });

  it("sem classificação conhecida: 503 com Retry-After, sem cache e sem noindex; nunca 404", async () => {
    modo = modoDaFalha;
    const r = await chamar("/agendar/novo-c", destino());
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("30");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-robots-tag")).toBeNull();
    expect(await r.text()).toContain("Tentar de novo agora");

    const head = await chamar("/agendar/novo-c", destino(), { method: "HEAD" });
    expect(head.status).toBe(503);
    expect(await head.text()).toBe("");
  });

  it("classificação lembrada vence depois de uma hora: volta a 503", async () => {
    marcados.add("teste-a");
    await chamar("/agendar/teste-a");
    modo = modoDaFalha;
    agora += 60 * 60 * 1000 + 1;
    expect((await chamar("/agendar/teste-a", destino())).status).toBe(503);
  });
});

describe("troca da marca", () => {
  it("desmarcar e remarcar vale na leitura seguinte e na falha depois dela", async () => {
    marcados.add("loja-d");
    expect((await chamar("/agendar/loja-d")).headers.get("x-robots-tag")).toBe(VALOR_SEM_INDEXACAO);

    marcados.delete("loja-d");
    expect((await chamar("/agendar/loja-d")).headers.get("x-robots-tag")).toBeNull();
    modo = "fora-500";
    expect((await chamar("/agendar/loja-d")).headers.get("x-robots-tag")).toBeNull();

    modo = "normal";
    marcados.add("loja-d");
    expect((await chamar("/agendar/loja-d")).headers.get("x-robots-tag")).toBe(VALOR_SEM_INDEXACAO);
    modo = "fora-500";
    expect((await chamar("/agendar/loja-d")).headers.get("x-robots-tag")).toBe(VALOR_SEM_INDEXACAO);
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
