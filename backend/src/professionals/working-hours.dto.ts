// DTO Zod dos horários semanais (Lote 6D.3) — mesma disciplina de
// professional.dto.ts: `.strict()` em todo objeto, e o pipe
// (common/zod-validation.pipe.ts) nunca ecoa o valor recebido no erro.
//
// `.strict()` é a proteção contra escalonamento por payload: `id`,
// `tenantId`, `professionalId`, `active` e `unitId` NÃO existem em nenhum
// destes schemas. O profissional vem do path (e é reconferido contra o tenant
// autorizado no servidor); o tenant vem exclusivamente da Membership provada.
//
// CONTRATO DO PUT: o corpo descreve a SEMANA INTEIRA. Dia ausente da lista é
// dia sem atendimento, exatamente como dia presente com `intervals: []` —
// não existe "alterar só a terça". Isso é deliberado: com substituição total
// não há como duas gravações simultâneas deixarem meia semana de cada uma
// (ver working-hours.service.ts).
import { z } from 'zod';
import { ULTIMO_DIA_DA_SEMANA, PRIMEIRO_DIA_DA_SEMANA } from './working-hours.js';

/** `HH:MM` 24h, zero à esquerda obrigatório. O banco guarda VARCHAR sem
 * CHECK, então a precisão é imposta aqui. */
const horaSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM, entre 00:00 e 23:59.');

const intervaloSchema = z
  .object({
    start: horaSchema,
    end: horaSchema,
  })
  .strict();

const diaSchema = z
  .object({
    weekday: z.number().int().min(PRIMEIRO_DIA_DA_SEMANA).max(ULTIMO_DIA_DA_SEMANA),
    /** Lista vazia = dia sem atendimento. */
    intervals: z.array(intervaloSchema),
  })
  .strict();

/** Semana inteira. `days: []` é válido e significa "não atende em nenhum dia"
 * — nunca é confundido com "não configurado". */
export const replaceWorkingHoursSchema = z
  .object({
    days: z.array(diaSchema),
  })
  .strict();

export type ReplaceWorkingHoursDto = z.infer<typeof replaceWorkingHoursSchema>;
