// Regras da tela de aplicação de comissão em massa (dono). Funções puras: o
// componente só desenha. O servidor decide o resultado de cada profissional
// e confere tudo de novo; aqui só se monta o pedido e se escolhem os textos.
// Ver docs/plans/comissoes-aplicacao-em-massa.md.
import { lerValor, rotuloDaRegra, type RegraGeral } from "@/lib/api/comissoes-api";
import type {
  AlcanceEmMassa,
  ConfiguracaoGeral,
  EscolhaDeExcecoes,
  ModoEmMassa,
  PreviaEmMassa,
  ResultadoEmMassa,
} from "@/lib/api/comissoes-em-massa-api";

/** Teto do servidor por aplicação (MAXIMO_DA_APLICACAO_EM_MASSA). */
export const MAXIMO_EM_MASSA = 200;

export interface FormularioEmMassa {
  alcance: AlcanceEmMassa;
  selecionados: readonly string[];
  tipo: "PERCENTAGE" | "FIXED";
  valor: string;
  modo: ModoEmMassa;
  /** Só vale em SUBSTITUIR; em PRESERVAR as exceções sempre ficam. */
  excecoes: EscolhaDeExcecoes;
}

export interface PedidoEmMassa {
  target: AlcanceEmMassa;
  professionalIds?: string[];
  defaultRule: RegraGeral;
  mode: ModoEmMassa;
  /** Só `REMOVE`, e só em SUBSTITUIR; sem o campo, o servidor mantém. */
  exceptions?: "REMOVE";
}

export function montarPedido(f: FormularioEmMassa): { ok: true; pedido: PedidoEmMassa } | { ok: false; erro: string } {
  if (f.alcance === "SELECTED" && f.selecionados.length === 0) return { ok: false, erro: "Escolha ao menos um profissional." };
  if (f.alcance === "SELECTED" && f.selecionados.length > MAXIMO_EM_MASSA) {
    return { ok: false, erro: `Escolha no máximo ${MAXIMO_EM_MASSA} profissionais por vez.` };
  }
  const lido = lerValor(f.tipo, f.valor, "Para não pagar comissão, desligue “Recebe comissão” no profissional.");
  if (!lido.ok) return lido;
  return {
    ok: true,
    pedido: {
      target: f.alcance,
      ...(f.alcance === "SELECTED" ? { professionalIds: [...new Set(f.selecionados)] } : {}),
      defaultRule: lido.corpo,
      mode: f.modo,
      ...(f.modo === "REPLACE" && f.excecoes === "REMOVE" ? { exceptions: "REMOVE" as const } : {}),
    },
  };
}

/** Corpo da aplicação: o pedido da prévia, a impressão dela e, em
 * SUBSTITUIR, a confirmação explícita; removendo exceções, também a
 * confirmação da remoção (a tela só habilita aplicar depois das duas). */
export function corpoDaAplicacao(pedido: PedidoEmMassa, previa: Pick<PreviaEmMassa, "fingerprint">) {
  return {
    ...pedido,
    fingerprint: previa.fingerprint,
    ...(pedido.mode === "REPLACE" ? { confirmReplace: true as const } : {}),
    ...(pedido.exceptions === "REMOVE" ? { confirmRemoveExceptions: true as const } : {}),
  };
}

/** "Não recebe comissão", "Recebe · sem regra geral" ou "Recebe · 10%". */
export function rotuloDaConfiguracao(c: ConfiguracaoGeral): string {
  if (!c.receivesCommission) return "Não recebe comissão";
  return `Recebe · ${c.defaultRule ? rotuloDaRegra(c.defaultRule) : "sem regra geral"}`;
}

export const ROTULO_RESULTADO_PREVIA: Record<ResultadoEmMassa, string> = {
  CHANGE: "Será alterado",
  PRESERVE: "Preservado",
  UNCHANGED: "Sem mudança",
};

export const ROTULO_RESULTADO_APLICADO: Record<ResultadoEmMassa, string> = {
  CHANGE: "Alterado",
  PRESERVE: "Preservado",
  UNCHANGED: "Sem mudança",
};

export const ROTULO_MODO: Record<ModoEmMassa, { titulo: string; descricao: string }> = {
  PRESERVE: {
    titulo: "Preservar configurações existentes",
    descricao:
      "Só recebe a regra nova quem já recebe comissão e não tem regra geral. Quem tem outra regra geral ou está com “Recebe comissão” desligado fica como está.",
  },
  REPLACE: {
    titulo: "Substituir configurações gerais",
    descricao:
      "Todos os profissionais do alcance passam a usar esta regra geral, e “Recebe comissão” é ligado, mesmo para quem estava desligado. As exceções por serviço só saem se você escolher removê-las.",
  },
};

export const TEXTO_CONFIRMACAO_SUBSTITUIR =
  "Entendo que as configurações gerais individuais destes profissionais serão substituídas por esta regra e que “Recebe comissão” será ligado para todos eles.";

/** Texto do botão de aplicar, conforme quantos serão alterados. */
export function rotuloDoBotaoAplicar(alterados: number): string {
  if (alterados === 0) return "Nada a aplicar";
  return alterados === 1 ? "Aplicar a 1 profissional" : `Aplicar a ${alterados} profissionais`;
}

/** Recusa 409 que a tela trata pelo código. `PREVIA_DESATUALIZADA`: a tela
 * busca a prévia de novo e pede nova revisão. */
export function mensagemDoConflito(codigo: string | null | undefined, mensagemDoServidor: string): string {
  if (codigo === "PREVIA_DESATUALIZADA") {
    return "As comissões mudaram desde a prévia. A prévia abaixo foi atualizada: confira antes de aplicar.";
  }
  return mensagemDoServidor;
}
