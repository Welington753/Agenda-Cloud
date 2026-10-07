// Proxy da API na mesma origem do frontend (ver src/lib/api/proxy.ts e
// docs/runbooks/publicacao-piloto-render.md). Route Handler, não `rewrites`
// do next.config: aqui o código decide exatamente quais cabeçalhos vão e
// voltam, exige `Origin` nas escritas e nunca repassa os cabeçalhos de IP
// enviados pelo navegador.
import { encaminharParaApi } from "@/lib/api/proxy";
import { lerConfiguracaoProxy } from "@/lib/api/proxy-config";

// `node:net` (validação de IP) e `fetch` do Node; nunca Edge.
export const runtime = "nodejs";

interface Contexto {
  params: Promise<{ caminho: string[] }>;
}

async function encaminhar(requisicao: Request, { params }: Contexto): Promise<Response> {
  // Lida a cada requisição: o destino vem só do ambiente do servidor.
  const resultado = lerConfiguracaoProxy(process.env);
  if (!resultado.ok) {
    return Response.json(
      { message: "Proxy da API sem configuração válida." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
  const { caminho } = await params;
  return encaminharParaApi(requisicao, caminho, resultado.configuracao);
}

export const GET = encaminhar;
export const POST = encaminhar;
export const PUT = encaminhar;
export const PATCH = encaminhar;
export const DELETE = encaminhar;
