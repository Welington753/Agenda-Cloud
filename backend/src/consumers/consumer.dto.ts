// DTOs Zod de clientes (Lote 6D.5) — mesma disciplina de service.dto.ts e
// professional.dto.ts: `.strict()` recusa propriedade desconhecida e o pipe
// nunca ecoa o valor recebido na mensagem de erro.
//
// Busca, cadastro (com chave de pedido opcional), lista agrupada, ficha,
// histórico e edição (docs/plans/clientes-ficha-e-duplicados.md). Esta
// versão NÃO aceita `outraPessoa`: cadastrar outra pessoa no mesmo telefone
// só existe depois da migration ConsumerSharedPhone (o `.strict()` recusa o
// campo com 400).
//
// Um cliente NÃO é um usuário: `consumers` não tem senha, e-mail de login,
// credencial nem Membership (ver consumer.entity.ts). Cadastrar aqui nunca
// cria acesso ao sistema para ninguém.
import { z } from 'zod';
import { normalizePhone } from '../auth/phone-normalizer.js';
import { idSchema, requestKeySchema } from '../accounts/accounts.dto.js';

/** `varchar(30)` das colunas de id — limite da coluna, não de negócio. */
const ID_MAXIMO = 30;

export const consumerSearchSchema = z
  .object({
    // Termo livre: nome ou telefone. Mínimo 2 para a busca não virar
    // "devolva todo mundo" por um caractere digitado sem querer.
    q: z.string().trim().min(2).max(120),
  })
  .strict();

export type ConsumerSearchDto = z.infer<typeof consumerSearchSchema>;

/** Maior página da listagem: a tela pede a próxima quando a pessoa quer. */
export const MAIOR_PAGINA_DE_CLIENTES = 50;

/**
 * Listagem paginada (tela de Clientes). Sem `q`, a primeira página de todos
 * os clientes do estabelecimento; com `q`, a mesma regra da busca. `cursor` é
 * opaco: vem da resposta anterior, nunca é montado pelo navegador.
 */
export const consumerPageSchema = z
  .object({
    // Vazio é "sem filtro"; um caractere só ainda não filtra (mesma regra da
    // busca: 2 no mínimo).
    q: z
      .union([z.literal(''), z.string().trim().min(2).max(120)])
      .transform((valor) => (valor === '' ? undefined : valor))
      .optional(),
    cursor: z.string().trim().min(1).max(400).optional(),
    limit: z.coerce.number().int().min(1).max(MAIOR_PAGINA_DE_CLIENTES).default(20),
  })
  .strict();

export type ConsumerPageDto = z.infer<typeof consumerPageSchema>;

/** Telefone válido para o normalizador (o mesmo do cadastro do
 * estabelecimento), com a mensagem que a tela mostra. */
function conferirTelefone(whatsapp: string | undefined, ctx: z.RefinementCtx): void {
  if (whatsapp === undefined) return;
  try {
    normalizePhone(whatsapp);
  } catch {
    ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Informe um telefone válido com DDD.' });
  }
}

const camposDoCliente = {
  name: z.string().trim().min(1).max(120),
  // O telefone entra como a pessoa digita e é normalizado AQUI, com a mesma
  // função do cadastro de estabelecimento — nunca duas convenções de
  // telefone no mesmo banco.
  whatsapp: z.string().trim().min(1).max(30),
  // Opcional de verdade: string vazia vira ausência, nunca um e-mail "".
  // A string vazia é tratada ANTES da validação de e-mail — `.optional()`
  // sozinho aceitaria "" como valor presente.
  email: z
    .union([z.literal(''), z.string().trim().max(160).email()])
    .transform((valor) => (valor === '' ? undefined : valor))
    .optional(),
};

/** Dados de um cliente novo criado junto com o agendamento (agenda,
 * `mode: 'new'`): o reenvio ali é barrado pela própria reserva. */
export const consumerDataSchema = z
  .object(camposDoCliente)
  .strict()
  .superRefine((valor, ctx) => conferirTelefone(valor.whatsapp, ctx));

export const createConsumerSchema = z
  .object({
    ...camposDoCliente,
    // Chave de pedido gerada pela tela a cada formulário aberto. Com ela, o
    // reenvio (rede caiu) devolve o cadastro já criado em vez de outro.
    // Opcional: o web anterior não manda.
    requestKey: requestKeySchema.optional(),
  })
  .strict()
  .superRefine((valor, ctx) => conferirTelefone(valor.whatsapp, ctx));

export type CreateConsumerDto = z.infer<typeof createConsumerSchema>;

export const consumerIdSchema = z.string().trim().min(1).max(ID_MAXIMO);

/** Id de cliente no caminho da rota (mesma forma dos ids gerados). */
export const consumerIdParamSchema = idSchema;

/** Lista agrupada (`GET .../consumers/groups`): mesma busca da listagem. */
export const consumerGroupsSchema = consumerPageSchema;
export type ConsumerGroupsDto = ConsumerPageDto;

/** Histórico da ficha (`GET .../consumers/:id/appointments`). */
export const MAIOR_PAGINA_DE_HISTORICO = 50;
export const consumerHistorySchema = z
  .object({
    cursor: z.string().trim().min(1).max(400).optional(),
    limit: z.coerce.number().int().min(1).max(MAIOR_PAGINA_DE_HISTORICO).default(20),
  })
  .strict();
export type ConsumerHistoryDto = z.infer<typeof consumerHistorySchema>;

/**
 * Edição do cadastro. `expectedUpdatedAt` é o `updatedAt` que a tela leu:
 * se outra pessoa salvou depois, 409 `CLIENTE_ALTERADO`. E-mail vazio
 * apaga o e-mail. Pelo menos um campo além da versão.
 */
export const updateConsumerSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    whatsapp: z.string().trim().min(1).max(30).optional(),
    email: z
      .union([z.literal(''), z.string().trim().max(160).email()])
      .transform((valor) => (valor === '' ? null : valor))
      .optional(),
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((valor, ctx) => {
    conferirTelefone(valor.whatsapp, ctx);
    if (valor.name === undefined && valor.whatsapp === undefined && valor.email === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Nada para alterar.' });
    }
  });
export type UpdateConsumerDto = z.infer<typeof updateConsumerSchema>;
