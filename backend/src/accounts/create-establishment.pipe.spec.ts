import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateEstablishmentPipe, isOutdatedCreateBody } from './create-establishment.pipe.js';

const novo = {
  requestKey: 'chave-de-teste-123',
  businessName: 'Barbearia Aurora',
  category: 'BARBERSHOP',
  addons: ['INDICADORES'],
  teamUserLimit: 3,
  owner: { name: 'Dona', email: 'dona@example.test' },
};

describe('CreateEstablishmentPipe', () => {
  const pipe = new CreateEstablishmentPipe();

  it('aceita o corpo novo, com limite explícito', () => {
    const dto = pipe.transform(novo);
    expect(isOutdatedCreateBody(dto)).toBe(false);
    expect(dto).toMatchObject({ teamUserLimit: 3, addons: ['INDICADORES'], timezone: 'America/Sao_Paulo' });
  });

  it('corpo do web anterior (plano, ciclo, valor) vira marcador: nunca cria sem limite', () => {
    const anterior = {
      requestKey: 'chave-de-teste-123',
      businessName: 'Barbearia Aurora',
      category: 'BARBERSHOP',
      planId: 'plan_equipe',
      billingCycle: 'MONTHLY',
      contractAmountCents: 3990,
      owner: { name: 'Dona', email: 'dona@example.test' },
    };
    expect(isOutdatedCreateBody(pipe.transform(anterior))).toBe(true);
    expect(isOutdatedCreateBody(pipe.transform({ ...novo, planId: 'plan_equipe' }))).toBe(true);
  });

  it('sem limite no corpo novo: recusa de validação comum', () => {
    const { teamUserLimit: _semLimite, ...semLimite } = novo;
    expect(() => pipe.transform(semLimite)).toThrow(BadRequestException);
  });

  it('limite negativo ou fracionário é recusado; zero é aceito', () => {
    expect(() => pipe.transform({ ...novo, teamUserLimit: -1 })).toThrow(BadRequestException);
    expect(() => pipe.transform({ ...novo, teamUserLimit: 1.5 })).toThrow(BadRequestException);
    expect(pipe.transform({ ...novo, teamUserLimit: 0 })).toMatchObject({ teamUserLimit: 0 });
  });
});
