// Apresentação das vendas: rótulos, situação e ações que a tela oferece.
// Só esconde o que voltaria recusado; o servidor decide em toda requisição.
//
// Venda e recebimento são estados SEPARADOS: a venda é ativa ou cancelada; o
// recebimento é "a receber", "recebida" ou "recebimento estornado". O valor
// vendido nunca é mostrado como dinheiro recebido.
import type { ResultadoAcao } from "@/lib/administracao/api-contas";
import { mensagemDoResultado } from "@/lib/administracao/api-contas";
import type { ClienteDaBusca, ResumoDeVenda, SituacaoDaVenda, Venda } from "@/lib/api/vendas-api";
import type { AreaDoEstabelecimento } from "@/lib/conta/papel";

export const ROTULO_SITUACAO_DA_VENDA: Record<SituacaoDaVenda, string> = {
  ATIVA: "Venda ativa",
  CANCELADA: "Venda cancelada",
};

export type SituacaoDoRecebimento = "a-receber" | "recebida" | "estornado" | "sem-recebimento";

export const ROTULO_SITUACAO_DO_RECEBIMENTO: Record<SituacaoDoRecebimento, string> = {
  "a-receber": "A receber",
  recebida: "Recebida",
  estornado: "Recebimento estornado",
  "sem-recebimento": "Sem recebimento",
};

/** Situação do dinheiro de uma venda (lista ou detalhe). */
export function situacaoDoRecebimento(venda: Pick<ResumoDeVenda, "status" | "payment">): SituacaoDoRecebimento {
  if (venda.payment && !venda.payment.refunded) return "recebida";
  if (venda.status === "CANCELADA") return venda.payment ? "estornado" : "sem-recebimento";
  return venda.payment ? "estornado" : "a-receber";
}

/** O mesmo, a partir do detalhe. */
export function situacaoDoRecebimentoNoDetalhe(venda: Pick<Venda, "status" | "payments" | "activePaymentId">): SituacaoDoRecebimento {
  if (venda.activePaymentId) return "recebida";
  if (venda.status === "CANCELADA") return venda.payments.length ? "estornado" : "sem-recebimento";
  return venda.payments.length ? "estornado" : "a-receber";
}

export function corDaSituacaoDoRecebimento(s: SituacaoDoRecebimento): "sucesso" | "aviso" | "neutro" {
  if (s === "recebida") return "sucesso";
  if (s === "a-receber") return "aviso";
  return "neutro";
}

export interface AcoesDaVenda {
  receber: boolean;
  estornar: boolean;
  cancelar: boolean;
  /** Pode cancelar, mas o recebimento ativo precisa ser estornado antes. */
  cancelarDependeDeEstorno: boolean;
}

/**
 * O que a tela oferece numa venda, pelas áreas da sessão (as mesmas
 * políticas das rotas, calculadas no servidor):
 *
 * - receber: venda ativa sem recebimento ativo, com `VENDAS_RECEBER`; venda
 *   de outra pessoa só com a consulta geral também (`VENDAS_VER_TODAS`);
 * - estornar: recebimento ativo, com `VENDAS_ESTORNAR_RECEBIMENTO`;
 * - cancelar: venda ativa sem recebimento ativo, com `VENDAS_CANCELAR`.
 */
export function acoesDaVenda(
  venda: Pick<Venda, "status" | "activePaymentId" | "recordedBy">,
  userId: string,
  tem: (area: AreaDoEstabelecimento) => boolean,
): AcoesDaVenda {
  const ativa = venda.status === "ATIVA";
  const propria = venda.recordedBy.id === userId;
  const podeCancelar = ativa && tem("VENDAS_CANCELAR");
  return {
    receber: ativa && !venda.activePaymentId && tem("VENDAS_RECEBER") && (propria || tem("VENDAS_VER_TODAS")),
    estornar: !!venda.activePaymentId && tem("VENDAS_ESTORNAR_RECEBIMENTO"),
    cancelar: podeCancelar && !venda.activePaymentId,
    cancelarDependeDeEstorno: podeCancelar && !!venda.activePaymentId,
  };
}

/** Abas de `/conta/vendas` que a sessão vê, na ordem. */
export type AbaDeVendas = "nova" | "minhas" | "todas" | "recebimentos";

export const ROTULO_ABA: Record<AbaDeVendas, string> = {
  nova: "Nova venda",
  minhas: "Minhas operações",
  todas: "Vendas",
  recebimentos: "Recebimentos de vendas",
};

export function abasDisponiveis(tem: (area: AreaDoEstabelecimento) => boolean): AbaDeVendas[] {
  const abas: AbaDeVendas[] = [];
  if (tem("VENDAS_NOVA")) abas.push("nova");
  if (tem("VENDAS_HISTORICO")) abas.push("minhas");
  if (tem("VENDAS_VER_TODAS")) abas.push("todas", "recebimentos");
  return abas;
}

/** Aba pedida pelo endereço, se a sessão a vê; senão a primeira disponível. */
export function abaInicial(pedida: string | null, disponiveis: readonly AbaDeVendas[]): AbaDeVendas | null {
  if (pedida && (disponiveis as readonly string[]).includes(pedida)) return pedida as AbaDeVendas;
  return disponiveis[0] ?? null;
}

// ------------------------------------------------------------ cliente

/** Busca limitada: 2 a 80 caracteres (a mesma regra da API). */
export function buscaDeClientePronta(q: string): boolean {
  const t = q.trim();
  return t.length >= 2 && t.length <= 80;
}

/** "Ana Souza · final 1234". Nunca mostra telefone inteiro nem e-mail. */
export function rotuloDoCliente(c: Pick<ClienteDaBusca, "name" | "phoneLast4">): string {
  return c.phoneLast4 ? `${c.name} · final ${c.phoneLast4}` : `${c.name} · sem telefone`;
}

/** Nomes que se repetem no resultado: a tela avisa para conferir o final do
 * telefone. Nenhum deles é escolhido sozinho. */
export function idsComNomeRepetido(resultados: readonly Pick<ClienteDaBusca, "id" | "name">[]): Set<string> {
  const chave = (nome: string) => nome.trim().toLocaleLowerCase("pt-BR");
  const vistos = new Map<string, number>();
  for (const r of resultados) vistos.set(chave(r.name), (vistos.get(chave(r.name)) ?? 0) + 1);
  return new Set(resultados.filter((r) => (vistos.get(chave(r.name)) ?? 0) > 1).map((r) => r.id));
}

/** O cliente escolhido é SEMPRE o resultado tocado, achado pelo ID na lista
 * que a tela mostra. Não existe escolha pelo texto digitado. */
export function clienteTocado(resultados: readonly ClienteDaBusca[], id: string): ClienteDaBusca | null {
  return resultados.find((r) => r.id === id) ?? null;
}

// ------------------------------------------------------------ recusas

/** Mensagem de uma recusa das rotas de venda. O texto do servidor serve para
 * a maioria; alguns códigos pedem uma explicação de tela. */
export function mensagemDaRecusa(r: Exclude<ResultadoAcao<unknown>, { tipo: "ok" }>): string {
  if (r.tipo === "proibido" && r.codigo === "RECURSO_NAO_CONTRATADO") {
    return "Novas vendas estão desligadas neste estabelecimento. As vendas já registradas continuam em Minhas operações.";
  }
  if (r.tipo === "proibido" && r.codigo === "PRECO_NAO_AUTORIZADO") {
    return "Sua conta não pode alterar o preço. Use o preço sugerido ou peça a quem pode alterar.";
  }
  if (r.tipo === "nao-encontrado") return "Registro não encontrado, ou fora do que sua conta pode ver.";
  if (r.tipo === "reautenticar") return "A senha não foi confirmada. Nada foi alterado.";
  return mensagemDoResultado(r);
}

// ------------------------------------------------------------ datas

/** Data local `YYYY-MM-DD` do aparelho. */
function dataDoAparelho(agora: Date): string {
  const m = String(agora.getMonth() + 1).padStart(2, "0");
  const d = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${m}-${d}`;
}

/**
 * Limite do campo de data do recebimento: hoje no fuso do estabelecimento,
 * quando a tela o conhece; senão a data do aparelho. Nunca antes da data da
 * venda. É só o limite do campo: quem recusa data no futuro ou antes da venda
 * é o servidor (`DATA_NO_FUTURO`, `DATA_ANTES_DA_VENDA`).
 */
export function hojeParaRecebimento(dataDaVenda: string, hojeNoEstabelecimento: string | null, agora: Date): string {
  const hoje = hojeNoEstabelecimento ?? dataDoAparelho(agora);
  return hoje < dataDaVenda ? dataDaVenda : hoje;
}
