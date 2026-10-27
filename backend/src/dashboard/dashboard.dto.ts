// Período dos indicadores do Início, em datas LOCAIS do estabelecimento
// (`from` e `to` inclusivos). Sem os dois, o servidor usa o mês corrente no
// fuso do estabelecimento. Um só dos dois é recusado: a tela sempre manda o
// par, e adivinhar o outro lado esconderia um erro de chamada.
import { z } from 'zod';
import { dateSchema } from '../appointments/appointment.dto.js';

/** Maior período personalizado: um ano. */
export const MAIOR_PERIODO_DO_PAINEL_EM_DIAS = 366;

function diaUtc(data: string): number {
  const [ano, mes, dia] = data.split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia) / 86_400_000;
}

export const dashboardQuerySchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .strict()
  .superRefine((valor, ctx) => {
    if (!valor.from && !valor.to) return;
    if (!valor.from || !valor.to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'Informe o início e o fim do período.' });
      return;
    }
    const dias = diaUtc(valor.to) - diaUtc(valor.from) + 1;
    if (dias < 1) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'O fim do período vem antes do início.' });
    } else if (dias > MAIOR_PERIODO_DO_PAINEL_EM_DIAS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `O período pode ter no máximo ${MAIOR_PERIODO_DO_PAINEL_EM_DIAS} dias.`,
      });
    }
  });

export type DashboardQueryDto = z.infer<typeof dashboardQuerySchema>;
