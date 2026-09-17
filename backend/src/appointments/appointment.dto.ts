// Contrato dos agendamentos (Lote 6D.5) — mesma disciplina dos outros DTOs:
// `.strict()` recusa propriedade desconhecida e o pipe nunca ecoa o valor
// recebido na mensagem de erro.
//
// O QUE O CLIENTE MANDA: só escolhas e o instante desejado. O QUE ELE NÃO
// MANDA (e seria ignorado, porque o campo nem existe aqui): preço, duração,
// fim, status, unidade, tenant, snapshots. Tudo isso é decidido no servidor
// a partir das linhas reais — aceitar qualquer um deles do navegador seria
// deixar o preço e a ocupação da agenda nas mãos de quem abre o DevTools.
//
// `startAt` é um INSTANTE (ISO 8601 com fuso), não "09:00": a hora local
// sozinha é ambígua no dia em que o relógio volta, quando a mesma hora
// acontece duas vezes com deslocamentos diferentes. O servidor revalida esse
// instante contra a grade real do fuso do estabelecimento — vir da interface
// não é motivo para aceitar.
import { z } from 'zod';
import { createConsumerSchema } from '../consumers/consumer.dto.js';

/** `varchar(30)` das colunas de id — limite da coluna, não de negócio. */
const ID_MAXIMO = 30;

const idSchema = z.string().trim().min(1).max(ID_MAXIMO);

/** Instante absoluto, aceito só com fuso explícito (`Z` ou `±HH:MM`). Uma
 * string sem fuso (`2026-09-20T09:00:00`) é recusada de propósito: seria
 * interpretada pelo relógio do servidor, que não é o do estabelecimento. */
const instanteSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/,
    'Informe o início como instante ISO 8601 com fuso (ex.: 2026-09-20T12:00:00.000Z).',
  )
  .refine((valor) => !Number.isNaN(new Date(valor).getTime()), 'Instante inválido.')
  // A data do calendário é conferida separadamente: `new Date` aceita
  // `2026-02-30` e "rola" para 2 de março em silêncio, o que faria o
  // servidor agendar num dia que o cliente nunca pediu.
  .refine((valor) => {
    const [ano, mes, dia] = valor.slice(0, 10).split('-').map(Number);
    if (mes < 1 || mes > 12 || dia < 1) return false;
    const remontada = new Date(Date.UTC(ano, mes - 1, dia));
    return (
      remontada.getUTCFullYear() === ano &&
      remontada.getUTCMonth() === mes - 1 &&
      remontada.getUTCDate() === dia
    );
  }, 'Data inexistente no calendário.');

/** Cliente: ou um já existente, ou os dados de um novo — nunca os dois, nunca
 * nenhum. União discriminada em vez de campos opcionais soltos, para não
 * existir o estado "mandou id E dados" sem resposta definida. */
const consumerSchema = z.union([
  z.object({ mode: z.literal('existing'), consumerId: idSchema }).strict(),
  z.object({ mode: z.literal('new'), data: createConsumerSchema }).strict(),
]);

export const createAppointmentSchema = z
  .object({
    professionalId: idSchema,
    serviceId: idSchema,
    startAt: instanteSchema,
    consumer: consumerSchema,
    // Observação interna do estabelecimento. Opcional; string vazia vira
    // ausência, nunca uma observação em branco gravada.
    // `.transform` ANTES de `.optional()`: `.optional()` sozinho aceitaria a
    // string vazia como valor válido e gravaria uma observação em branco.
    notes: z
      .string()
      .trim()
      .max(500)
      .transform((valor) => (valor === '' ? undefined : valor))
      .optional(),
  })
  .strict();

export type CreateAppointmentDto = z.infer<typeof createAppointmentSchema>;

/**
 * Listagem: sempre de UM dia, no fuso do estabelecimento. Não existe "liste
 * tudo" — sem recorte a rota viraria um dump da agenda inteira.
 *
 * Mesma validação de data de `availability.dto.ts`: o formato sozinho não
 * basta (`2026-02-30` casa com o regex e não é dia nenhum), então a data é
 * remontada e conferida, nunca aceitando o "rolo" do construtor `Date`.
 */
const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use uma data no formato YYYY-MM-DD.')
  .refine((valor) => {
    const [ano, mes, dia] = valor.split('-').map(Number);
    if (mes < 1 || mes > 12 || dia < 1) return false;
    const remontada = new Date(Date.UTC(ano, mes - 1, dia));
    return (
      remontada.getUTCFullYear() === ano &&
      remontada.getUTCMonth() === mes - 1 &&
      remontada.getUTCDate() === dia
    );
  }, 'Data inexistente no calendário.');

export const listAppointmentsSchema = z
  .object({
    date: dateSchema,
    /** Filtro opcional por profissional — o padrão é o dia inteiro do
     * estabelecimento. */
    professionalId: idSchema.optional(),
  })
  .strict();

export type ListAppointmentsDto = z.infer<typeof listAppointmentsSchema>;
