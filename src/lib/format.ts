// Utilitários de formatação no padrão brasileiro.
import type { DiaSemana } from "./types";

const NOMES_DIA: Record<DiaSemana, string> = {
  0: "domingo",
  1: "segunda",
  2: "terça",
  3: "quarta",
  4: "quinta",
  5: "sexta",
  6: "sábado",
};

/** Descreve dias de funcionamento contíguos como "Terça a sábado"; se não forem
 * contíguos, lista os dias separados por vírgula. */
export function formatarDiasFuncionamento(dias: DiaSemana[]): string {
  if (dias.length === 0) return "Fechado";
  const ordenados = [...dias].sort((a, b) => a - b);
  const contiguo = ordenados.every((d, i) => i === 0 || d === ordenados[i - 1] + 1);
  const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (contiguo && ordenados.length > 1) {
    return `${capitalizar(NOMES_DIA[ordenados[0]])} a ${NOMES_DIA[ordenados[ordenados.length - 1]]}`;
  }
  return capitalizar(ordenados.map((d) => NOMES_DIA[d]).join(", "));
}

export function formatarMoeda(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const TEXTO_SOB_CONSULTA = "Sob consulta";

/** Preço para telas públicas: respeita tanto a política do estabelecimento
 * (`exibirPrecoPublico`) quanto a visibilidade do próprio serviço (`precoVisivel`)
 * e a ausência de preço definido. O painel administrativo NÃO deve usar esta
 * função — o dono sempre precisa ver o valor real quando ele existe. */
export function formatarPrecoPublico(
  servico: { precoCentavos?: number; precoVisivel: boolean },
  exibirPrecoPublico: boolean
): string {
  if (!exibirPrecoPublico || !servico.precoVisivel || servico.precoCentavos === undefined) {
    return TEXTO_SOB_CONSULTA;
  }
  return formatarMoeda(servico.precoCentavos);
}

export function formatarData(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatarDataLonga(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const texto = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function formatarHora(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function formatarDuracao(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${resto}min`;
}

/** Aceita dígitos livres e formata como (DD) DDDDD-DDDD, mantendo o que já foi digitado. */
export function formatarWhatsapp(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 11);
  if (digitos.length <= 2) return digitos.length ? `(${digitos}` : "";
  if (digitos.length <= 7) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}

/** Mascara o telefone para exibição em listas (LGPD/privacidade do protótipo):
 * mantém DDD, primeiro dígito e os 4 últimos, ocultando o restante. */
export function mascararWhatsapp(whatsapp: string): string {
  const digitos = whatsapp.replace(/\D/g, "");
  if (digitos.length < 8) return whatsapp;
  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  const primeiro = numero.slice(0, 1);
  const ultimos4 = numero.slice(-4);
  const meioOculto = "•".repeat(Math.max(0, numero.length - 5));
  return `(${ddd}) ${primeiro}${meioOculto}-${ultimos4}`;
}
