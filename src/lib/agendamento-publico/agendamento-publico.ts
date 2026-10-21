// Regras puras da página pública de agendamento e da tela de solicitações —
// sem React, testadas em agendamento-publico.test.ts.
//
// FUSO: datas e horas mostradas são SEMPRE as do estabelecimento (vêm do
// servidor como `localStart`/`localDate`, ou são calculadas com o fuso que o
// servidor devolveu). O relógio do navegador só decide "que dia é hoje lá".
import type { FalhaPublica, ReciboPedido } from "@/lib/api/public-booking-api";
import { hojeNoFuso } from "@/lib/profissionais/agenda-visual";

/** Quantos dias a página oferece para escolher. */
export const DIAS_OFERECIDOS = 14;

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** `YYYY-MM-DD` + n dias, pelo calendário (sem fuso, sem horário de verão). */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1, d + dias));
  return x.toISOString().slice(0, 10);
}

/** `dd/mm/aaaa`. */
export function dataBr(data: string): string {
  return data.split("-").reverse().join("/");
}

export interface DiaOferecido {
  date: string;
  /** Ex.: "seg 08/03". */
  rotulo: string;
}

/** Os próximos dias a partir de HOJE no fuso do estabelecimento. */
export function diasOferecidos(timezone: string, agora: Date, total = DIAS_OFERECIDOS): DiaOferecido[] {
  const hoje = hojeNoFuso(timezone, agora);
  if (!hoje) return [];
  return Array.from({ length: total }, (_, i) => {
    const date = somarDias(hoje, i);
    const [a, m, d] = date.split("-").map(Number);
    const semana = DIAS_DA_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
    return { date, rotulo: `${semana} ${date.slice(8, 10)}/${date.slice(5, 7)}` };
  });
}

/** Chave do envio: gerada UMA vez por pedido montado. Repetir o envio com
 * ela devolve o mesmo pedido; um pedido novo (outro horário, outra pessoa)
 * ganha chave nova. */
export function gerarChaveDeEnvio(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export function precoTexto(priceCents: number | null, visivel: boolean): string | null {
  if (!visivel) return null;
  if (priceCents === null) return "Sob consulta";
  return (priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Frase do estado do pedido no recibo. PENDING nunca vira "confirmado". */
export function estadoDoRecibo(status: ReciboPedido["status"]): string {
  switch (status) {
    case "PENDING":
      return "Aguardando confirmação do estabelecimento";
    case "CONFIRMED":
      return "Confirmado pelo estabelecimento";
    case "CANCELED":
      return "Não confirmado pelo estabelecimento";
    default:
      return "Pedido registrado";
  }
}

export const MENSAGEM_INCERTO =
  "Não conseguimos confirmar se o seu pedido chegou ao estabelecimento. Ele pode ter sido registrado. " +
  "Use “Verificar envio” para conferir sem criar um pedido duplicado.";

/** Mensagem para quem está agendando. */
export function mensagemFalhaPublica(falha: FalhaPublica): string {
  switch (falha.tipo) {
    case "nao_encontrada":
      return "Esta página de agendamento não está disponível.";
    case "recusado":
      return falha.mensagem ?? "Não foi possível usar esta opção. Escolha outra.";
    case "conflito":
      return falha.mensagem ?? "Este horário acabou de ser ocupado. Escolha outro horário disponível.";
    case "limite":
      return falha.mensagem ?? "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
    case "falha_comunicacao":
      return "Não foi possível falar com o servidor agora. Verifique sua conexão e tente de novo.";
    case "incerto":
      return MENSAGEM_INCERTO;
  }
}

/** Lista vazia legítima (nunca confundida com falha). */
export function mensagemSemHorario(motivo: string | null): string {
  if (motivo === "sem_jornada") return "Sem atendimento neste dia. Escolha outra data.";
  if (motivo === "fora_da_janela_futura") return "Esta data ainda não está aberta para agendamento.";
  return "Todos os horários deste dia estão ocupados. Escolha outra data.";
}

/** Endereço público do estabelecimento. */
export function linkPublico(origem: string, slug: string): string {
  return `${origem.replace(/\/+$/, "")}/agendar/${encodeURIComponent(slug)}`;
}
