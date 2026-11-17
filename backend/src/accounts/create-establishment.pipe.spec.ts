import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateEstablishmentPipe, OUTDATED_SCREEN_CODE } from './create-establishment.pipe.js';

const novo = {
  requestKey: 'chave-de-teste-123',
  businessName: 'Barbearia Aurora',
  category: 'BARBERSHOP',
  addons: ['INDICADORES'],
  teamUserLimit: 3,
  owner: { name: 'Dona', email: 'dona@example.test' },
};

const resposta = (fn: () => unknown, tipo: typeof BadRequestException | typeof ConflictException = BadRequestException) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(tipo);
    return (e as BadRequestException).getResponse() as { code?: string; message: string };
  }
  throw new Error('era esperado um erro');
};

describe('CreateEstablishmentPipe', () => {
  const pipe = new CreateEstablishmentPipe();

  it('aceita o corpo novo, com limite explícito', () => {
    expect(pipe.transform(novo)).toMatchObject({ teamUserLimit: 3, addons: ['INDICADORES'], timezone: 'America/Sao_Paulo' });
  });

  it('corpo do web anterior (plano, ciclo, valor) recebe TELA_DESATUALIZADA, nunca cria sem limite', () => {
    const anterior = {
      requestKey: 'chave-de-teste-123',
      businessName: 'Barbearia Aurora',
      category: 'BARBERSHOP',
      planId: 'plan_equipe',
      billingCycle: 'MONTHLY',
      contractAmountCents: 3990,
      owner: { name: 'Dona', email: 'dona@example.test' },
    };
    // 409: o web anterior só exibe a mensagem do servidor em conflito.
    const r = resposta(() => pipe.transform(anterior), ConflictException);
    expect(r.code).toBe(OUTDATED_SCREEN_CODE);
    expect(r.message).toMatch(/Recarregue a página/);
    expect(resposta(() => pipe.transform({ ...novo, planId: 'plan_equipe' }), ConflictException).code).toBe(OUTDATED_SCREEN_CODE);
  });

  it('sem limite no corpo novo: recusa de validação comum', () => {
    const { teamUserLimit: _semLimite, ...semLimite } = novo;
    const r = resposta(() => pipe.transform(semLimite));
    expect(r.code).toBeUndefined();
    expect(r.message).toMatch(/teamUserLimit/);
  });

  it('limite negativo ou fracionário é recusado; zero é aceito', () => {
    expect(() => pipe.transform({ ...novo, teamUserLimit: -1 })).toThrow(BadRequestException);
    expect(() => pipe.transform({ ...novo, teamUserLimit: 1.5 })).toThrow(BadRequestException);
    expect(pipe.transform({ ...novo, teamUserLimit: 0 }).teamUserLimit).toBe(0);
  });
});
