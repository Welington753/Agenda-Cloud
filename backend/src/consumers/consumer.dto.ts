// DTOs Zod de clientes (Lote 6D.5) — mesma disciplina de service.dto.ts e
// professional.dto.ts: `.strict()` recusa propriedade desconhecida e o pipe
// nunca ecoa o valor recebido na mensagem de erro.
//
// ESCOPO MÍNIMO DELIBERADO: só o necessário para conseguir agendar pela
// primeira vez (buscar um cliente e cadastrar um novo). Nada de editar,
// desativar, importar ou listar histórico — isso é outro lote.
//
// Um cliente NÃO é um usuário: `consumers` não tem senha, e-mail de login,
// credencial nem Membership (ver consumer.entity.ts). Cadastrar aqui nunca
// cria acesso ao sistema para ninguém.
import { z } from 'zod';
import { normalizePhone } from '../auth/phone-normalizer.js';

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

export const createConsumerSchema = z
  .object({
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
  })
  .strict()
  .superRefine((valor, ctx) => {
    try {
      normalizePhone(valor.whatsapp);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['whatsapp'],
        message: 'Informe um telefone válido com DDD.',
      });
    }
  });

export type CreateConsumerDto = z.infer<typeof createConsumerSchema>;

export const consumerIdSchema = z.string().trim().min(1).max(ID_MAXIMO);
