// Textos das mensagens automáticas. Neutros de propósito: primeiro nome do
// cliente, estabelecimento, data e hora no fuso do estabelecimento — NUNCA o
// serviço (consulta, procedimento, terapia podem ser dados sensíveis), preço,
// profissional ou observações.
import { dataLocalDe, horaLocalDe } from '../availability/time-zone.js';
import type { TipoDeNotificacao } from './notification-policy.js';

export interface DadosDaMensagem {
  nomeDoCliente: string;
  estabelecimento: string;
  inicio: Date;
  timezone: string;
}

function dataBr(inicio: Date, timezone: string): string {
  const [ano, mes, dia] = dataLocalDe(inicio, timezone).split('-');
  return `${dia}/${mes}/${ano}`;
}

export function montarMensagem(
  tipo: TipoDeNotificacao,
  dados: DadosDaMensagem,
): { parametros: string[]; texto: string } {
  const nome = dados.nomeDoCliente.trim().split(/\s+/)[0] || 'tudo bem';
  const estabelecimento = dados.estabelecimento.trim();
  const data = dataBr(dados.inicio, dados.timezone);
  const hora = horaLocalDe(dados.inicio, dados.timezone);
  const parametros = [nome, estabelecimento, data, hora];

  switch (tipo) {
    case 'CONFIRMATION':
      return {
        parametros,
        texto: `Olá, ${nome}. Seu agendamento no ${estabelecimento} está confirmado para ${data} às ${hora}. Se precisar mudar, responda esta mensagem.`,
      };
    case 'REMINDER_DAY_BEFORE':
      return {
        parametros,
        texto: `Olá, ${nome}. Lembrete: seu agendamento no ${estabelecimento} é amanhã, ${data}, às ${hora}.`,
      };
    case 'REMINDER_2H':
      return {
        parametros,
        texto: `Olá, ${nome}. Lembrete: seu agendamento no ${estabelecimento} é hoje, às ${hora}.`,
      };
  }
}

/**
 * Telefone para o provedor: mesma regra de `normalizePhone`
 * (auth/phone-normalizer.ts) aplicada ao valor já normalizado do banco
 * (`+55...`). `null` quando não é um telefone utilizável.
 */
export function telefoneInternacional(normalizado: string | null | undefined): string | null {
  if (!normalizado) return null;
  const digitos = normalizado.replace(/\D/g, '');
  return digitos.length >= 12 && digitos.length <= 13 ? digitos : null;
}
