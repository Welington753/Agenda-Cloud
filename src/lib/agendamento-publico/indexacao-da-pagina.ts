// Indexação da página pública (`/agendar/<slug>`) de um estabelecimento de
// teste. UMA decisão por requisição, tomada em src/proxy.ts antes da resposta,
// vale para o cabeçalho `X-Robots-Tag` e para o HTML (o layout lê a decisão
// pelo cabeçalho interno `CABECALHO_CLASSIFICACAO`, sem decidir de novo).
// Assim o cabeçalho e o HTML nunca divergem, mesmo que as duas leituras da
// API (a do proxy e a do layout) tenham resultados diferentes.
//
// Regras da decisão (`decidirIndexacao`):
// - API respondeu a página: a classificação vem dela (`indexable: false` é
//   teste; `true` ou ausente, de uma API anterior ao campo, é indexável) e
//   fica na memória do processo;
// - API confirmou que não existe (404): nada a classificar, a página 404 já
//   leva `noindex`; a memória daquele slug é apagada;
// - API lenta, fora ou ilegível: vale a última classificação lida da API
//   para AQUELE slug, se tiver no máximo `VALIDADE_DA_CLASSIFICACAO_MS`.
//   Sem ela, a resposta é 503 com `Retry-After` (`respostaIndisponivel`):
//   uma dúvida nunca vira "indexável" sozinha, e um estabelecimento real
//   também não ganha `noindex` por uma falha passageira. Nunca 404.
//
// A memória só serve na falha: toda requisição lê a API primeiro, e a leitura
// nova sempre substitui a lembrada. Uma troca da marca no portal vale na
// primeira leitura bem-sucedida depois dela; a classificação antiga só pode
// reaparecer enquanto a API estiver falhando, e por no máximo uma hora.
import { paginaIndexavel } from "./metadados-publicos";
import { slugPublicoNormalizado, type PaginaNoServidor } from "./pagina-no-servidor";

export const CABECALHO_ROBOTS = "X-Robots-Tag";
export const VALOR_SEM_INDEXACAO = "noindex, nofollow";

/** Cabeçalho INTERNO, da requisição: do proxy para o layout. O proxy o
 * apaga de toda requisição que chega, para nenhum cliente escolher a
 * decisão. */
export const CABECALHO_CLASSIFICACAO = "x-agenda-indexacao";

export type Classificacao = "indexavel" | "teste";

/** Até quando uma classificação lida da API ainda vale numa falha da API. */
export const VALIDADE_DA_CLASSIFICACAO_MS = 60 * 60 * 1000;

/** Teto de slugs lembrados por processo: só entram páginas que a API
 * confirmou (slugs inventados dão 404 e não ocupam espaço). */
export const LIMITE_DA_MEMORIA = 500;

/** `Retry-After` do 503, em segundos (a API do plano gratuito acorda em
 * menos de um minuto). */
export const ESPERA_PARA_NOVA_TENTATIVA_S = 30;

interface Lembranca {
  classificacao: Classificacao;
  lidaEm: number;
}

/** Última classificação lida da API, por slug normalizado, com validade.
 * Uma instância por processo do web (`MEMORIA_DO_PROCESSO`); nunca vai para
 * disco, cookie ou resposta. */
export class MemoriaDeClassificacao {
  private readonly itens = new Map<string, Lembranca>();

  constructor(
    private readonly validadeMs: number = VALIDADE_DA_CLASSIFICACAO_MS,
    private readonly limite: number = LIMITE_DA_MEMORIA,
  ) {}

  gravar(slug: string, classificacao: Classificacao, agora: number): void {
    this.itens.delete(slug);
    if (this.itens.size >= this.limite) {
      const maisAntiga = this.itens.keys().next().value;
      if (maisAntiga !== undefined) this.itens.delete(maisAntiga);
    }
    this.itens.set(slug, { classificacao, lidaEm: agora });
  }

  ler(slug: string, agora: number): Classificacao | null {
    const item = this.itens.get(slug);
    if (!item) return null;
    const idade = agora - item.lidaEm;
    if (idade < 0 || idade > this.validadeMs) {
      this.itens.delete(slug);
      return null;
    }
    return item.classificacao;
  }

  esquecer(slug: string): void {
    this.itens.delete(slug);
  }

  get tamanho(): number {
    return this.itens.size;
  }
}

export const MEMORIA_DO_PROCESSO = new MemoriaDeClassificacao();

export type DecisaoDeIndexacao =
  | { tipo: "classificada"; classificacao: Classificacao; origem: "api" | "memoria" }
  | { tipo: "inexistente" }
  | { tipo: "indisponivel" };

export function classificacaoDaPagina(leitura: Extract<PaginaNoServidor, { tipo: "encontrada" }>): Classificacao {
  return paginaIndexavel(leitura.pagina) ? "indexavel" : "teste";
}

export function decidirIndexacao(
  leitura: PaginaNoServidor,
  slugPedido: string,
  memoria: MemoriaDeClassificacao,
  agora: number,
): DecisaoDeIndexacao {
  const chave = slugPublicoNormalizado(slugPedido);
  if (leitura.tipo === "encontrada") {
    const classificacao = classificacaoDaPagina(leitura);
    if (chave !== null) memoria.gravar(chave, classificacao, agora);
    return { tipo: "classificada", classificacao, origem: "api" };
  }
  if (leitura.tipo === "inexistente") {
    if (chave !== null) memoria.esquecer(chave);
    return { tipo: "inexistente" };
  }
  const lembrada = chave === null ? null : memoria.ler(chave, agora);
  return lembrada === null ? { tipo: "indisponivel" } : { tipo: "classificada", classificacao: lembrada, origem: "memoria" };
}

export function robotsDaClassificacao(classificacao: Classificacao): string | null {
  return classificacao === "teste" ? VALOR_SEM_INDEXACAO : null;
}

/** Valor do cabeçalho interno, ou `null` se ausente ou estranho. */
export function classificacaoDoCabecalho(valor: string | null): Classificacao | null {
  return valor === "indexavel" || valor === "teste" ? valor : null;
}

/** Se o HTML pode ser indexado. A decisão do proxy manda; sem ela (proxy sem
 * configuração: desenvolvimento e suítes em chamada direta), só uma página
 * lida da API e não marcada como teste é indexável. Dúvida nunca é. */
export function paginaPodeSerIndexada(classificacaoDoProxy: Classificacao | null, leitura: PaginaNoServidor): boolean {
  if (classificacaoDoProxy !== null) return classificacaoDoProxy === "indexavel";
  return leitura.tipo === "encontrada" && paginaIndexavel(leitura.pagina);
}

/** Slug do caminho `/agendar/<slug>` (um segmento só), ou `null`. */
export function slugDoCaminhoAgendar(caminho: string): string | null {
  const m = /^\/agendar\/([^/]+)\/?$/.exec(caminho);
  return m ? m[1] : null;
}

/** Resposta temporária quando não há classificação confiável: 503, nunca
 * guardada em cache, com nova tentativa automática (sem JavaScript) e um
 * link para tentar na hora. Sem `noindex`: buscadores não indexam um 503 e
 * voltam depois; um `noindex` aqui poderia tirar da busca um
 * estabelecimento real por causa de uma falha passageira. */
export function respostaIndisponivel(caminho: string): { status: 503; headers: Record<string, string>; corpo: string } {
  const destino = caminho.replace(/[^a-zA-Z0-9/_.~%-]/g, "");
  const corpo = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Agenda abrindo · Agenda Cloud</title>
</head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;line-height:1.5">
<h1 style="font-size:1.25rem">Estamos abrindo esta agenda</h1>
<p>O serviço está demorando um pouco para responder. A página tenta de novo sozinha em alguns segundos.</p>
<p><a href="${destino}">Tentar de novo agora</a></p>
</body>
</html>
`;
  return {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(ESPERA_PARA_NOVA_TENTATIVA_S),
    },
    corpo,
  };
}
