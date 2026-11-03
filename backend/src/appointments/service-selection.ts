// Escolha de serviços de UM agendamento (ver
// docs/plans/agendamento-multiplos-servicos.md). O cliente manda só os ids,
// na ordem em que quer ser atendido; preço, duração, profissional compatível
// e ocupação são decididos no servidor a partir das linhas reais.
//
// Compatibilidade: `serviceId` (um serviço, como sempre) continua aceito; o
// web novo manda `serviceIds`. Os dois juntos são recusados, para não existir
// "mandou um e a lista" sem resposta definida.
import { z } from 'zod';

/** Teto de itens num agendamento: o suficiente para combinações reais
 * (corte, barba, sobrancelha...) sem virar uma reserva do dia inteiro. */
export const MAX_SERVICOS_POR_AGENDAMENTO = 6;

const idSchema = z.string().trim().min(1).max(30);

export const serviceIdsSchema = z
  .array(idSchema)
  .min(1, 'Escolha pelo menos um serviço.')
  .max(MAX_SERVICOS_POR_AGENDAMENTO, `Escolha no máximo ${MAX_SERVICOS_POR_AGENDAMENTO} serviços.`)
  .refine((lista) => new Set(lista).size === lista.length, 'O mesmo serviço foi escolhido mais de uma vez.');

/** Na query string: `serviceIds=a,b,c`. */
export const serviceIdsQuerySchema = z
  .string()
  .trim()
  .transform((valor) => valor.split(',').map((id) => id.trim()))
  .pipe(serviceIdsSchema);

export const serviceSelectionShape = {
  serviceId: idSchema.optional(),
  serviceIds: serviceIdsSchema.optional(),
};

/** Exatamente uma das duas formas. */
export function conferirEscolha(
  valor: { serviceId?: string; serviceIds?: string[] },
  ctx: z.RefinementCtx,
): void {
  const formas = (valor.serviceId !== undefined ? 1 : 0) + (valor.serviceIds !== undefined ? 1 : 0);
  if (formas !== 1) {
    ctx.addIssue({ code: 'custom', path: ['serviceIds'], message: 'Escolha os serviços do agendamento.' });
  }
}

/** Os ids escolhidos, na ordem do atendimento. */
export function servicosDaEscolha(valor: { serviceId?: string; serviceIds?: readonly string[] }): string[] {
  return valor.serviceIds ? [...valor.serviceIds] : [valor.serviceId!];
}
