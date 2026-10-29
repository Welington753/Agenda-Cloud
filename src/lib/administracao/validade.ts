// Textos e conversões da validade do acesso (assinatura do Agenda Cloud) na
// administração. Funções puras.

export const FORMAS_DE_PAGAMENTO: Record<string, string> = {
  PIX: "Pix",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  CARTAO_CREDITO: "Cartão de crédito",
  CARTAO_DEBITO: "Cartão de débito",
  DINHEIRO: "Dinheiro",
  OUTRO: "Outro",
};

export const CICLOS = { MONTHLY: "Mensal", QUARTERLY: "Trimestral" } as const;

/** `"2027-02-28"` -> `"28/02/2027"`, sem fuso (é data de calendário). */
export const diaBr = (iso: string) => iso.split("-").reverse().join("/");

export const reais = (centavos: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);

/** `"89,90"`, `"89.90"` ou `"R$ 89,9"` -> centavos; `null` se não for um
 * valor positivo com no máximo duas casas. Nunca passa por número decimal. */
export function centavosDe(texto: string): number | null {
  const limpo = texto.trim().replace(/\s|R\$/g, "");
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(limpo)) return null;
  const [inteiro, fracao = ""] = limpo.replace(",", ".").split(".");
  const valor = Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
  return valor > 0 ? valor : null;
}

/** Data de hoje (`YYYY-MM-DD`) no fuso do estabelecimento. */
export const hojeLocal = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

const ROTULO_DO_ESTADO: Record<string, string> = { TRIAL: "teste gratuito", PAID: "período pago", COURTESY: "cortesia" };

/** Uma situação da validade em uma linha, para o impacto da correção:
 * `"período pago até 27/02/2027"`, `"vencido: acesso pausado"`. */
export function validadeDepoisDaCorrecao(
  situacao: { state: string; blocked: boolean; validUntil: string | null },
  timeZone: string,
): string {
  if (situacao.state === "UNTRACKED") return "validade ainda não definida (opera como antes)";
  if (situacao.state === "MISSING") return "sem validade registrada: acesso pausado";
  if (situacao.blocked || !situacao.validUntil) return "vencido: acesso pausado";
  const ultimo = new Intl.DateTimeFormat("pt-BR", { timeZone }).format(new Date(Date.parse(situacao.validUntil) - 1));
  return `${ROTULO_DO_ESTADO[situacao.state] ?? "válido"} até ${ultimo}`;
}
