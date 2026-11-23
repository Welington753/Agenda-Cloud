// Contrato de busca e cadastro de clientes (Lote 6D.5).
import { describe, expect, it } from 'vitest';
import { consumerDataSchema, consumerSearchSchema, createConsumerSchema, updateConsumerSchema } from './consumer.dto.js';

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

describe('createConsumerSchema — chave de pedido e outra pessoa', () => {
  const VALIDO = { name: 'Maria Souza', whatsapp: '(11) 90000-0000' };

  it('aceita requestKey no formato das outras chaves de pedido', () => {
    expect(createConsumerSchema.safeParse({ ...VALIDO, requestKey: 'k_0123456789abcdef' }).success).toBe(true);
  });

  it.each(['curta', 'tem espaço no meio 1234', 'x'.repeat(65)])('recusa requestKey inválida: %s', (requestKey) => {
    expect(createConsumerSchema.safeParse({ ...VALIDO, requestKey }).success).toBe(false);
  });

  it('esta versão recusa outraPessoa (só existe depois da ConsumerSharedPhone)', () => {
    expect(createConsumerSchema.safeParse({ ...VALIDO, requestKey: 'k_0123456789abcdef', outraPessoa: true }).success).toBe(false);
  });

  it('o cliente novo da agenda não aceita requestKey (o reenvio ali é barrado pela reserva)', () => {
    expect(consumerDataSchema.safeParse({ ...VALIDO, requestKey: 'k_0123456789abcdef' }).success).toBe(false);
    expect(consumerDataSchema.safeParse(VALIDO).success).toBe(true);
  });
});

describe('updateConsumerSchema', () => {
  const VERSAO = { expectedUpdatedAt: '2026-11-19T12:00:00.000Z' };

  it('aceita um campo com a versão lida', () => {
    expect(updateConsumerSchema.safeParse({ ...VERSAO, name: 'Maria' }).success).toBe(true);
  });

  it('exige a versão lida', () => {
    expect(updateConsumerSchema.safeParse({ name: 'Maria' }).success).toBe(false);
  });

  it('recusa sem nenhum campo para alterar', () => {
    expect(updateConsumerSchema.safeParse(VERSAO).success).toBe(false);
  });

  it('e-mail vazio apaga (vira null)', () => {
    expect(updateConsumerSchema.parse({ ...VERSAO, email: '' }).email).toBeNull();
  });

  it('recusa telefone inválido, outraPessoa e campos desconhecidos', () => {
    expect(updateConsumerSchema.safeParse({ ...VERSAO, whatsapp: '123' }).success).toBe(false);
    expect(updateConsumerSchema.safeParse({ ...VERSAO, name: 'M', outraPessoa: true }).success).toBe(false);
    expect(updateConsumerSchema.safeParse({ ...VERSAO, name: 'M', tenantId: 'outro' }).success).toBe(false);
  });
});
