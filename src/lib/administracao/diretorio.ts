// Textos da Visão geral e da listagem comercial do portal. Funções puras: as
// regras (acesso efetivo, janela de 7 dias, condição contratada) são do
// servidor; aqui só a apresentação, sem inventar data, ciclo ou valor.
import { SITUACOES, type SituacaoEstabelecimento } from "./contratos";
import type { EstadoComercial, TipoDePeriodo } from "./contratos-validade";
import type { AcessoEfetivo, CondicaoComercial, EscopoDoDiretorio, FiltroDoDiretorio } from "./contratos-diretorio";
import { CICLOS, diaBr, reais } from "./validade";

/** Situação do estabelecimento (cadastro), separada da validade: TRIAL e
 * ACTIVE estão em operação; o teste gratuito é modalidade do acesso. */
export function textoSituacao(status: SituacaoEstabelecimento, operacional: "ACTIVE" | "INACTIVE"): string {
  return operacional === "ACTIVE" ? "Em operação" : SITUACOES[status];
}

const TIPO: Record<TipoDePeriodo, string> = { TRIAL: "teste gratuito", PAID: "período pago", COURTESY: "cortesia" };

/** Modalidade do acesso (assinatura do TimVix). */
export function textoModalidade(state: EstadoComercial, expiredKind: TipoDePeriodo | null = null): string {
  switch (state) {
    case "TRIAL":
      return "Teste gratuito";
    case "PAID":
      return "Período pago";
    case "COURTESY":
      return "Cortesia";
    case "NO_EXPIRY":
      return "Sem vencimento";
    case "UNTRACKED":
      return "Validade ainda não definida";
    case "MISSING":
      return "Sem validade registrada";
    case "EXPIRED":
      return expiredKind ? `Vencido (último: ${TIPO[expiredKind]})` : "Vencido";
  }
}


export function textoDiasRestantes(dias: number): string {
  if (dias <= 0) return "termina hoje";
  if (dias === 1) return "termina amanhã";
  return `faltam ${dias} dias`;
}

/**
 * Validade em uma linha. Só mostra data quando existe uma: "sem vencimento" e
 * "validade ainda não definida" têm texto próprio, nunca uma data inventada.
 * Vencido: o último dia coberto, no fuso do estabelecimento.
 */
export function textoValidade(
  acesso: { state: EstadoComercial; lastDay: string | null; daysLeft: number | null; expiredAt: string | null },
  timeZone: string,
): string {
  if (acesso.state === "NO_EXPIRY") return "Não vence enquanto a concessão estiver em vigor";
  if (acesso.state === "UNTRACKED") return "Opera como antes até a regularização";
  if (acesso.state === "MISSING") return "Sem período registrado: acesso pausado";
  if (acesso.state === "EXPIRED") {
    if (!acesso.expiredAt) return "Acesso pausado";
    const ultimo = new Intl.DateTimeFormat("pt-BR", { timeZone }).format(new Date(Date.parse(acesso.expiredAt) - 1));
    return `Acesso até ${ultimo}: pausado`;
  }
  if (!acesso.lastDay) return "Validade não informada";
  return `Até ${diaBr(acesso.lastDay)}${acesso.daysLeft === null ? "" : ` · ${textoDiasRestantes(acesso.daysLeft)}`}`;
}

export const ACESSO_EFETIVO: Record<AcessoEfetivo, string> = {
  ALLOWED: "Acesso liberado",
  BLOCKED_STATUS: "Bloqueado pela situação",
  BLOCKED_VALIDITY: "Bloqueado pela validade",
};

/** Valores contratados de cada ciclo, um por linha. Os dois ciclos aparecem
 * quando existem; o trimestral é o total de três meses. Vazio: pendente. */
export function linhasContratadas(condicao: CondicaoComercial): string[] {
  return condicao.cycles
    .filter((c) => c.contractCents !== null)
    .map((c) => `${CICLOS[c.cycle]}: ${reais(c.contractCents!)}${c.cycle === "QUARTERLY" ? " (total de 3 meses)" : ""}`);
}

/** Preço do catálogo do plano atual, separado do contrato. Sem preço:
 * pendente, nunca zero nem gratuito. */
export function linhaCatalogo(condicao: CondicaoComercial): string {
  const partes = condicao.cycles.map(
    (c) =>
      `${CICLOS[c.cycle].toLowerCase()} ${
        c.catalogCents === null ? "pendente" : `${reais(c.catalogCents)}${c.cycle === "QUARTERLY" ? " por 3 meses" : ""}`
      }`,
  );
  return `Catálogo: ${partes.join(" · ")}`;
}

/** Filtros da listagem, com o significado exato mostrado na tela. */
export const FILTROS: Record<FiltroDoDiretorio, { rotulo: string; descricao: string }> = {
  ACCESS_ALLOWED: {
    rotulo: "Acesso liberado",
    descricao:
      "Em operação e com validade em vigor: teste, período pago, cortesia, sem vencimento ou validade ainda não definida.",
  },
  ACCESS_BLOCKED: {
    rotulo: "Acesso bloqueado",
    descricao: "Suspensos, arquivados ou cancelados, e os em operação cuja validade venceu ou não foi registrada.",
  },
  EXPIRING_SOON: {
    rotulo: "Validade termina em até 7 dias",
    descricao:
      "Teste, período pago ou cortesia cujo último dia coberto, contando as renovações já registradas, é hoje ou um dos 6 dias seguintes (fuso do estabelecimento). Inclui suspensos.",
  },
  VALIDITY_BLOCKED: {
    rotulo: "Validade vencida ou ausente",
    descricao:
      "Nenhum período cobre hoje, ou não há período nem marca de anterior ao controle. Qualquer situação. Acesso vencido não comprova dívida.",
  },
  CONTRACT_PENDING: {
    rotulo: "Condição contratada pendente",
    descricao:
      "Nenhum valor contratado específico no plano atual, em nenhum ciclo. Seguir o preço do catálogo não conta como contrato.",
  },
};

export function ehFiltroDoDiretorio(valor: string | null): valor is FiltroDoDiretorio {
  return !!valor && Object.hasOwn(FILTROS, valor);
}

/** Alcance da lista e dos indicadores, pela marca "Interno/teste". */
export const ESCOPOS: Record<EscopoDoDiretorio, { rotulo: string; descricao: string }> = {
  CLIENTS: {
    rotulo: "Clientes",
    descricao:
      "Somente clientes: estabelecimentos que usam o TimVix, sem os marcados como interno/teste. Um cadastro antigo conta aqui até alguém marcá-lo: estar nesta lista não comprova que ele foi conferido como cliente.",
  },
  INTERNAL: {
    rotulo: "Internos/teste",
    descricao: "Somente os marcados como interno/teste: contas da equipe e de teste, fora dos números de clientes.",
  },
  ALL: {
    rotulo: "Todos",
    descricao: "Todos os cadastrados: clientes e internos/teste juntos.",
  },
};

export function ehEscopoDoDiretorio(valor: string | null): valor is EscopoDoDiretorio {
  return !!valor && Object.hasOwn(ESCOPOS, valor);
}

/**
 * Alcance que a tela pode afirmar: só o que o servidor devolveu e que bate
 * com o pedido. Resposta sem `scope` (API anterior) ou diferente do pedido:
 * `null`, e a tela não diz que os números são só de clientes. Nunca se
 * recorta a página recebida no navegador.
 */
export function alcanceConfirmado(
  pedido: EscopoDoDiretorio,
  recebido: EscopoDoDiretorio | undefined,
): EscopoDoDiretorio | null {
  return recebido === pedido ? recebido : null;
}

export const ALCANCE_NAO_CONFIRMADO =
  "Alcance não confirmado pelo servidor: os números podem incluir estabelecimentos internos e de teste e não indicam que todos são clientes.";

export function textoAlcance(confirmado: EscopoDoDiretorio | null): string {
  return confirmado ? ESCOPOS[confirmado].descricao : ALCANCE_NAO_CONFIRMADO;
}

export function ehSituacaoDoFiltro(valor: string | null): valor is SituacaoEstabelecimento {
  return !!valor && Object.hasOwn(SITUACOES, valor);
}

/** `"2027-03"` -> `"março de 2027"`. */
export function textoMes(mes: string): string {
  const [ano, numero] = mes.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(ano, numero - 1, 1)),
  );
}

