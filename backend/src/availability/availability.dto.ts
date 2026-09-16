// Contrato da consulta de disponibilidade (Lote 6D.4) — mesma disciplina dos
// outros DTOs: `.strict()` recusa propriedade desconhecida e o pipe nunca
// ecoa o valor recebido na mensagem de erro.
//
// É uma CONSULTA: só `serviceId` e `date` entram. Não existe aqui (nem em
// lugar nenhum deste lote) campo de cliente, de confirmação ou de reserva.
// `tenantId` e `professionalId` vêm do caminho, e o tenant só é aceito depois
// de provado pela autorização — nunca do corpo ou da query.
import { z } from 'zod';

/** `varchar(30)` das colunas de id — o limite da coluna, não um de negócio. */
const ID_MAXIMO = 30;

const idSchema = z.string().trim().min(1).max(ID_MAXIMO);

/**
 * `YYYY-MM-DD` de uma data que EXISTE no calendário. O formato sozinho não
 * basta: `2026-02-30` casa com o regex e não é dia nenhum. A conferência é
 * feita remontando a data e comparando — nunca aceitando o "rolo" do
 * construtor `Date` (que transformaria 30/02 em 02/03 em silêncio).
 *
 * Esta é uma data de CALENDÁRIO, sem hora e sem fuso: o fuso em que ela é
 * interpretada é o do estabelecimento, decidido no servidor.
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

export const availabilityQuerySchema = z
  .object({
    serviceId: idSchema,
    date: dateSchema,
  })
  .strict();

export type AvailabilityQueryDto = z.infer<typeof availabilityQuerySchema>;
