import { describe, expect, it } from 'vitest';
import {
  createProfessionalSchema,
  setProfessionalServicesSchema,
  updateProfessionalSchema,
} from './professional.dto.js';

describe('createProfessionalSchema', () => {
  it('aceita o mínimo e aplica default de serviços vazio', () => {
    expect(createProfessionalSchema.parse({ name: 'Ana Souza' })).toEqual({
      name: 'Ana Souza',
      serviceIds: [],
    });
  });

  it('aceita serviços iniciais', () => {
    const resultado = createProfessionalSchema.parse({
      name: 'Ana Souza',
      serviceIds: ['service_1', 'service_2'],
    });
    expect(resultado.serviceIds).toEqual(['service_1', 'service_2']);
  });

  it('recusa nome vazio ou só espaços, e apara as pontas', () => {
    expect(createProfessionalSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createProfessionalSchema.parse({ name: '  Ana  ' }).name).toBe('Ana');
  });

  it('exige nome — não há default', () => {
    expect(createProfessionalSchema.safeParse({}).success).toBe(false);
  });

  it.each(['tenantId', 'id', 'unitId', 'avatarInitials', 'avatarColor', 'active', 'createdAt'])(
    'recusa %s no corpo — campo de propriedade/estado nunca vem do cliente',
    (campo) => {
      const resultado = createProfessionalSchema.safeParse({
        name: 'Ana Souza',
        [campo]: 'valor-forjado',
      });
      expect(resultado.success).toBe(false);
    },
  );
});

describe('updateProfessionalSchema', () => {
  it('aceita alteração de nome', () => {
    expect(updateProfessionalSchema.parse({ name: 'Ana Souza Costa' })).toEqual({
      name: 'Ana Souza Costa',
    });
  });

  it('recusa corpo vazio — nunca um UPDATE sem nada a mudar', () => {
    expect(updateProfessionalSchema.safeParse({}).success).toBe(false);
  });

  it.each(['tenantId', 'id', 'unitId', 'avatarInitials', 'avatarColor', 'active', 'createdAt', 'serviceIds'])(
    'recusa %s no corpo da edição',
    (campo) => {
      expect(
        updateProfessionalSchema.safeParse({ name: 'Ana', [campo]: 'forjado' }).success,
      ).toBe(false);
    },
  );
});

describe('setProfessionalServicesSchema', () => {
  it('aceita lista vazia — remove todos os vínculos', () => {
    expect(setProfessionalServicesSchema.parse({ serviceIds: [] })).toEqual({ serviceIds: [] });
  });

  it('aceita lista de ids', () => {
    expect(
      setProfessionalServicesSchema.parse({ serviceIds: ['service_1', 'service_2'] }),
    ).toEqual({ serviceIds: ['service_1', 'service_2'] });
  });

  it('exige o campo serviceIds', () => {
    expect(setProfessionalServicesSchema.safeParse({}).success).toBe(false);
  });

  it('recusa campo extra no corpo', () => {
    expect(
      setProfessionalServicesSchema.safeParse({ serviceIds: [], tenantId: 'forjado' }).success,
    ).toBe(false);
  });
});
