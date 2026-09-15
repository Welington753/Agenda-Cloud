import { describe, expect, it } from 'vitest';
import { ServiceModality } from '../entities/enums/service-modality.enum.js';
import { createServiceSchema, updateServiceSchema } from './service.dto.js';

const MINIMO = { name: 'Corte', durationMinutes: 30 };

describe('createServiceSchema', () => {
  it('aceita o mínimo e aplica os mesmos defaults das colunas', () => {
    const resultado = createServiceSchema.parse(MINIMO);

    expect(resultado).toEqual({
      name: 'Corte',
      shortDescription: '',
      priceCents: null,
      priceVisible: true,
      durationMinutes: 30,
      bufferAfterMinutes: 0,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });
  });

  it.each(['tenantId', 'id', 'active', 'createdAt'])(
    'recusa %s no corpo — campo de propriedade/estado nunca vem do cliente',
    (campo) => {
      const resultado = createServiceSchema.safeParse({ ...MINIMO, [campo]: 'valor-forjado' });
      expect(resultado.success).toBe(false);
    },
  );

  it('recusa nome vazio ou só espaços, e apara as pontas', () => {
    expect(createServiceSchema.safeParse({ ...MINIMO, name: '   ' }).success).toBe(false);
    expect(createServiceSchema.parse({ ...MINIMO, name: '  Corte  ' }).name).toBe('Corte');
  });

  it('exige duração inteira de pelo menos 1 minuto', () => {
    expect(createServiceSchema.safeParse({ ...MINIMO, durationMinutes: 0 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...MINIMO, durationMinutes: -5 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...MINIMO, durationMinutes: 30.5 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...MINIMO, durationMinutes: '30' }).success).toBe(false);
  });

  it('aceita preço em centavos inteiros, zero e null (sob consulta), nunca decimal', () => {
    expect(createServiceSchema.parse({ ...MINIMO, priceCents: 0 }).priceCents).toBe(0);
    expect(createServiceSchema.parse({ ...MINIMO, priceCents: 8500 }).priceCents).toBe(8500);
    expect(createServiceSchema.parse({ ...MINIMO, priceCents: null }).priceCents).toBeNull();
    expect(createServiceSchema.safeParse({ ...MINIMO, priceCents: 85.5 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...MINIMO, priceCents: -1 }).success).toBe(false);
  });

  it('recusa valores acima do limite de INTEGER da coluna', () => {
    expect(createServiceSchema.safeParse({ ...MINIMO, priceCents: 2_147_483_648 }).success).toBe(
      false,
    );
    expect(
      createServiceSchema.safeParse({ ...MINIMO, durationMinutes: 2_147_483_648 }).success,
    ).toBe(false);
  });

  it('aceita só as modalidades do enum real', () => {
    expect(createServiceSchema.parse({ ...MINIMO, modality: 'REMOTE' }).modality).toBe('REMOTE');
    expect(createServiceSchema.safeParse({ ...MINIMO, modality: 'PRESENCIAL' }).success).toBe(false);
  });

  it('exige nome e duração — não há default para eles', () => {
    expect(createServiceSchema.safeParse({ durationMinutes: 30 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ name: 'Corte' }).success).toBe(false);
  });
});

describe('updateServiceSchema', () => {
  it('aceita alteração de um campo só', () => {
    expect(updateServiceSchema.parse({ name: 'Corte masculino' })).toEqual({
      name: 'Corte masculino',
    });
  });

  it('recusa corpo vazio — nunca um UPDATE sem nada a mudar', () => {
    expect(updateServiceSchema.safeParse({}).success).toBe(false);
  });

  it.each(['tenantId', 'id', 'active', 'createdAt'])('recusa %s no corpo da edição', (campo) => {
    expect(updateServiceSchema.safeParse({ name: 'Corte', [campo]: 'forjado' }).success).toBe(false);
  });

  it('permite voltar o preço para null (sob consulta) sem tocar no resto', () => {
    expect(updateServiceSchema.parse({ priceCents: null })).toEqual({ priceCents: null });
  });

  it('aplica as mesmas faixas numéricas da criação', () => {
    expect(updateServiceSchema.safeParse({ durationMinutes: 0 }).success).toBe(false);
    expect(updateServiceSchema.safeParse({ bufferAfterMinutes: -1 }).success).toBe(false);
    expect(updateServiceSchema.safeParse({ name: '  ' }).success).toBe(false);
  });
});
