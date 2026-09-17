// Contrato de busca e cadastro de clientes (Lote 6D.5).
import { describe, expect, it } from 'vitest';
import { consumerSearchSchema, createConsumerSchema } from './consumer.dto.js';

describe('consumerSearchSchema', () => {
  it('aceita um termo de busca', () => {
    expect(consumerSearchSchema.safeParse({ q: 'Maria' }).success).toBe(true);
  });

  it.each(['', ' ', 'a'])('recusa termo curto demais (%s) — busca não é listagem', (q) => {
    expect(consumerSearchSchema.safeParse({ q }).success).toBe(false);
  });

  it('exige o termo — nunca existe "liste todos"', () => {
    expect(consumerSearchSchema.safeParse({}).success).toBe(false);
  });

  it('recusa propriedade desconhecida', () => {
    expect(consumerSearchSchema.safeParse({ q: 'Maria', tenantId: 'outro' }).success).toBe(false);
  });
});

describe('createConsumerSchema', () => {
  const VALIDO = { name: 'Maria Souza', whatsapp: '(11) 90000-0000' };

  it('aceita nome e whatsapp', () => {
    expect(createConsumerSchema.safeParse(VALIDO).success).toBe(true);
  });

  it('aceita e-mail opcional', () => {
    expect(createConsumerSchema.safeParse({ ...VALIDO, email: 'maria@example.test' }).success).toBe(
      true,
    );
  });

  it('e-mail vazio vira ausência, nunca string em branco gravada', () => {
    expect(createConsumerSchema.parse({ ...VALIDO, email: '' }).email).toBeUndefined();
  });

  it('recusa e-mail inválido quando informado', () => {
    expect(createConsumerSchema.safeParse({ ...VALIDO, email: 'não-é-email' }).success).toBe(false);
  });

  it.each(['123', 'abc', '', '1'])('recusa telefone inválido: %s', (whatsapp) => {
    expect(createConsumerSchema.safeParse({ ...VALIDO, whatsapp }).success).toBe(false);
  });

  it('recusa nome vazio', () => {
    expect(createConsumerSchema.safeParse({ ...VALIDO, name: '' }).success).toBe(false);
  });

  it.each([
    ['senha', { password: 'segredo' }],
    ['papel', { role: 'DONO' }],
    ['tenant', { tenantId: 'outro' }],
    ['id', { id: 'consumer_forjado' }],
  ])('recusa %s — cliente nunca vira usuário nem escolhe o próprio id', (_rotulo, extra) => {
    expect(createConsumerSchema.safeParse({ ...VALIDO, ...extra }).success).toBe(false);
  });
});
