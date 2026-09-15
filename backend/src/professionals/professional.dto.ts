// DTOs Zod de profissionais (Lote 6D.2) — mesma disciplina de service.dto.ts:
// `.strict()` para rejeitar propriedade desconhecida, e o pipe
// (common/zod-validation.pipe.ts) nunca ecoa o valor recebido na mensagem de
// erro.
//
// `.strict()` é também a proteção contra escalonamento por payload: `id`,
// `tenantId`, `unitId`, `avatarInitials`, `avatarColor`, `active` e
// `createdAt` NÃO existem em nenhum destes schemas — mandá-los no corpo é
// 400, nunca lidos, nunca aplicados. `unitId` fica de fora de propósito:
// o entity já documenta que unidade não é filtrada nesta fase (preparação
// futura para múltiplas unidades), então não é exposta como campo editável
// aqui. `avatarInitials`/`avatarColor` são sempre calculados no servidor
// (ver avatar.ts) — nunca vindos do cliente.
import { z } from 'zod';

const nameSchema = z.string().trim().min(1);

/** Id de serviço — validação de formato só; pertencimento ao tenant e
 * elegibilidade (ativo) são conferidos no servidor contra o banco, nunca
 * aqui (ver professionals.service.ts). */
const serviceIdSchema = z.string().trim().min(1);
const serviceIdsSchema = z.array(serviceIdSchema);

export const createProfessionalSchema = z
  .object({
    name: nameSchema,
    /** Serviços vinculados na criação — opcional; cadastro sem serviço
     * nenhum é permitido (nenhuma constraint do modelo exige o contrário). */
    serviceIds: serviceIdsSchema.optional().default([]),
  })
  .strict();

export type CreateProfessionalDto = z.infer<typeof createProfessionalSchema>;

/** Edição parcial: hoje só `name` é editável por aqui. Ativação/desativação
 * são ações próprias (deactivate/reactivate), nunca por este PATCH — mesma
 * decisão de service.dto.ts. */
export const updateProfessionalSchema = z
  .object({
    name: nameSchema.optional(),
  })
  .strict()
  .refine((valor) => Object.keys(valor).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
    path: ['body'],
  });

export type UpdateProfessionalDto = z.infer<typeof updateProfessionalSchema>;

/** Conjunto final desejado de serviços vinculados — o servidor calcula o
 * diff contra o que já existe (ver professionals.service.ts, `setServices`).
 * Vazio é válido: remove todos os vínculos. */
export const setProfessionalServicesSchema = z
  .object({
    serviceIds: serviceIdsSchema,
  })
  .strict();

export type SetProfessionalServicesDto = z.infer<typeof setProfessionalServicesSchema>;
