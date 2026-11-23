// Regras puras da lista agrupada, da ficha e da unificação de clientes (ver
// docs/plans/clientes-ficha-e-duplicados.md). Sem React e sem fetch: as
// redações ficam aqui, numa versão só.
//
// - Grupos e sugestões só SUGEREM revisão; nada é unificado sozinho.
// - Os números da ficha são "neste cadastro": nenhum total é somado entre
//   cadastros.
// - Datas e horas chegam no fuso do estabelecimento (`localDate`,
//   `localStart`); o relógio do navegador não decide nada.
import type {
  FalhaClientesReal,
  FichaDoCliente,
  GrupoDeClientes,
  MembroDoGrupo,
  RelacaoEntreCadastros,
  ResumoDaTransferencia,
} from "@/lib/api/consumers-api";
import type { TenantContextReal } from "@/lib/api/auth-api";
import { temArea } from "@/lib/conta/papel";
import { mensagemFalhaBusca } from "./cadastro";

export const ROTULO_RELACAO: Record<RelacaoEntreCadastros, string> = {
  MESMO_TELEFONE: "Mesmo WhatsApp",
  NUMERO_PARECIDO: "Número parecido (9º dígito ou DDD) — confira",
  MESMO_NOME: "Mesmo nome — confira",
};

/** Seções do cartão de um grupo de telefone: quem divide o mesmo WhatsApp e
 * quem tem um número parecido. Grupo de um cadastro só: sem seções. */
export function secoesDoGrupo(grupo: GrupoDeClientes): { titulo: string; membros: MembroDoGrupo[] }[] {
  if (grupo.membros.length < 2) return [];
  const mesmo = grupo.membros.filter((m) => m.relacoes.includes("MESMO_TELEFONE"));
  const parecido = grupo.membros.filter((m) => !m.relacoes.includes("MESMO_TELEFONE"));
  return [
    ...(mesmo.length > 0 ? [{ titulo: ROTULO_RELACAO.MESMO_TELEFONE, membros: mesmo }] : []),
    ...(parecido.length > 0 ? [{ titulo: ROTULO_RELACAO.NUMERO_PARECIDO, membros: parecido }] : []),
  ];
}

/** "Mesmo nome — confira" no cartão: quantos cadastros com o mesmo nome há
 * fora do grupo. */
export function avisoDeMesmoNome(mesmoNome: number): string | null {
  if (mesmoNome <= 0) return null;
  return mesmoNome === 1 ? "Mesmo nome em outro cadastro — confira" : `Mesmo nome em outros ${mesmoNome} cadastros — confira`;
}

export function textoDoTotalDeGrupos(total: number, termo: string | null): string {
  const quantidade = total === 1 ? "1 cliente ou grupo" : `${total} clientes ou grupos`;
  return termo ? `${quantidade} para “${termo}”` : quantidade;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Linhas do resumo da ficha, sempre "neste cadastro". */
export function linhasDoResumo(resumo: FichaDoCliente["resumo"]): string[] {
  return [
    plural(resumo.total, "agendamento", "agendamentos"),
    plural(resumo.concluidos, "concluído", "concluídos"),
    plural(resumo.cancelados, "cancelado", "cancelados"),
    plural(resumo.faltas, "falta", "faltas"),
  ];
}

export const AVISO_HISTORICO_COMPARTILHADO =
  "Agendamentos com nomes diferentes — o histórico pode ser de mais de uma pessoa.";

/** `"2026-11-23"` e `"14:30"` (fuso do estabelecimento) em texto. */
export function dataEHora(localDate: string, localStart: string): string {
  const [ano, mes, dia] = localDate.split("-");
  return `${dia}/${mes}/${ano} às ${localStart}`;
}

/** Editar: quem gerencia clientes (o dono, ou o gerente com a área). */
export function podeEditarClientes(contexto: Pick<TenantContextReal, "role" | "areas"> | null | undefined): boolean {
  return temArea(contexto, "CLIENTES_GERENCIAR");
}

/** Unificar: SÓ o dono, e sem restrição em clientes. O servidor confere de novo. */
export function podeUnificarClientes(contexto: Pick<TenantContextReal, "role" | "areas"> | null | undefined): boolean {
  return contexto?.role === "DONO" && temArea(contexto, "CLIENTES_GERENCIAR");
}

/** O que a prévia transfere, em frases curtas (sem valores somados). */
export function linhasDaTransferencia(t: ResumoDaTransferencia): string[] {
  const linhas = [
    `${plural(t.agendamentos, "agendamento", "agendamentos")} (${plural(t.concluidos, "concluído", "concluídos")}, ${plural(
      t.cancelados,
      "cancelado",
      "cancelados",
    )}, ${plural(t.faltas, "falta", "faltas")}${t.outros > 0 ? `, ${plural(t.outros, "a realizar ou aguardando", "a realizar ou aguardando")}` : ""})`,
  ];
  const seguem = (n: number) => (n === 1 ? "que segue o agendamento" : "que seguem os agendamentos");
  if (t.recebimentos > 0) linhas.push(`${plural(t.recebimentos, "recebimento", "recebimentos")}, ${seguem(t.recebimentos)}`);
  if (t.comissoes > 0) linhas.push(`${plural(t.comissoes, "comissão", "comissões")}, ${seguem(t.comissoes)}`);
  if (t.pedidosPublicos > 0) linhas.push(`${plural(t.pedidosPublicos, "pedido de agendamento online", "pedidos de agendamento online")}`);
  return linhas;
}

export const O_QUE_NAO_MUDA = [
  "Os nomes e telefones registrados em cada agendamento ficam como estão.",
  "Valores, recebimentos e comissões não são alterados.",
  "As preferências de mensagem continuam ligadas a cada telefone.",
  "O cadastro secundário deixa de aparecer na lista, mas não é apagado.",
];

export function mensagemFalhaFicha(falha: FalhaClientesReal): string {
  switch (falha.tipo) {
    case "sem_acesso":
      return "Cliente não encontrado neste estabelecimento.";
    case "cliente_unificado":
      return "Este cadastro foi unificado com outro. Abra o cadastro principal.";
    default:
      return mensagemFalhaBusca(falha);
  }
}

export function mensagemFalhaEdicao(falha: FalhaClientesReal): string {
  switch (falha.tipo) {
    case "duplicado":
      return "Outro cliente já usa este WhatsApp. Se for outra pessoa no mesmo número, confirme abaixo.";
    case "cliente_alterado":
      return "Este cadastro foi alterado por outra pessoa. Recarregue para ver a versão atual antes de salvar.";
    case "cliente_unificado":
      return "Este cadastro foi unificado com outro. Abra o cadastro principal.";
    case "sem_permissao":
      return "Você não tem permissão para editar clientes neste estabelecimento.";
    case "dados_invalidos":
      return falha.mensagem ?? "Alguns dados não foram aceitos. Revise os campos.";
    case "falha_comunicacao":
      return "A conexão caiu antes de o servidor confirmar. Recarregue a ficha para ver se a alteração foi salva.";
    default:
      return mensagemFalhaBusca(falha);
  }
}

export function mensagemFalhaUnificacao(falha: FalhaClientesReal): string {
  switch (falha.tipo) {
    case "previa_desatualizada":
      return "Os dados destes cadastros mudaram desde a prévia. Revise a prévia atualizada antes de confirmar.";
    case "cliente_unificado":
      return "Um destes cadastros já foi unificado. Recarregue a ficha.";
    case "sem_permissao":
      return "Só o dono do estabelecimento unifica cadastros.";
    case "conflito":
    case "dados_invalidos":
      return falha.mensagem ?? "Estes cadastros não podem ser unificados.";
    case "falha_comunicacao":
      return "A conexão caiu antes de o servidor confirmar. Recarregue a ficha para ver se a unificação foi feita; repetir é seguro.";
    default:
      return mensagemFalhaBusca(falha);
  }
}
