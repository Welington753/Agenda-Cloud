// Contato pelo WhatsApp a partir da área real — regras puras, sem React.
//
// O QUE ISTO É: um link oficial `https://wa.me/<telefone>?text=<mensagem>`
// que abre o WhatsApp do RESPONSÁVEL com a conversa e o texto prontos. Quem
// revisa e envia é a pessoa, no WhatsApp dela.
//
// O QUE ISTO NÃO É: notificação automática. Gerar ou abrir o link não grava
// nada, não marca mensagem como enviada e não confirma, cancela, remarca nem
// muda status de reserva nenhuma. A remarcação continua pelo fluxo da agenda,
// depois do acordo com o cliente.
//
// Telefone: a mesma regra de `normalizePhone` do backend
// (backend/src/auth/phone-normalizer.ts) — 10 a 13 dígitos, Brasil (+55)
// quando o código do país não vem explícito. Fora disso, não há link: um
// número inventado abriria a conversa com outra pessoa.

const TELEFONE_MIN_DIGITOS = 10;
const TELEFONE_MAX_DIGITOS = 13;

/** Telefone no formato internacional que o wa.me espera (só dígitos, com o
 * código do país), ou `null` quando não é um telefone válido. */
export function telefoneParaWhatsapp(telefone: string | null | undefined): string | null {
  if (!telefone) return null;
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < TELEFONE_MIN_DIGITOS || digitos.length > TELEFONE_MAX_DIGITOS) return null;

  const jaTemCodigoDoPais =
    telefone.trim().startsWith("+55") || (digitos.startsWith("55") && digitos.length > 11);
  return jaTemCodigoDoPais ? digitos : `55${digitos}`;
}

/** Link oficial do WhatsApp; `texto` vai codificado. `null` sem telefone válido. */
export function linkWhatsapp(telefone: string | null | undefined, texto?: string): string | null {
  const numero = telefoneParaWhatsapp(telefone);
  if (!numero) return null;
  const base = `https://wa.me/${numero}`;
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}

/**
 * Data de calendário (`dd/mm/aaaa`) de um instante, no fuso do
 * ESTABELECIMENTO — nunca no do navegador. Fuso inválido devolve `null`.
 */
export function dataNoFuso(instante: string, timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(instante));
  } catch {
    return null;
  }
}

export interface DadosCombinarHorario {
  nomeCliente: string;
  estabelecimento: string;
  /** Instante de início da reserva (ISO). */
  startAt: string;
  /** Hora local de início devolvida pelo backend (`localStart`, `HH:MM`). */
  horaLocal: string;
  /** Fuso do estabelecimento devolvido com a reserva. */
  timezone: string;
}

/**
 * Mensagem neutra para combinar outro horário. Leva só o primeiro nome, o
 * estabelecimento, a data e a hora — de propósito, nenhum dado do serviço
 * (pode ser sensível: consulta, procedimento, terapia...).
 */
export function mensagemCombinarOutroHorario(dados: DadosCombinarHorario): string | null {
  const data = dataNoFuso(dados.startAt, dados.timezone);
  if (!data) return null;
  const primeiroNome = dados.nomeCliente.trim().split(/\s+/)[0] ?? "";
  const saudacao = primeiroNome ? `Olá, ${primeiroNome}.` : "Olá.";
  return (
    `${saudacao} Aqui é do ${dados.estabelecimento.trim()}. ` +
    `Sobre seu agendamento em ${data} às ${dados.horaLocal}, ` +
    "precisamos combinar outro horário. Podemos conversar?"
  );
}
