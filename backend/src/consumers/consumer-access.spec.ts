// Política de acesso aos clientes (Lote 6D.5).
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { canManageConsumers, canMergeConsumers, canViewConsumers } from './consumer-access.js';

const negado = (permission: Permission) => [{ permission, mode: PermissionMode.DENIED }];
const concedido = (permission: Permission) => [{ permission, mode: PermissionMode.GRANTED }];

describe('canViewConsumers', () => {
  it('DONO busca clientes', () => {
    expect(canViewConsumers(EstablishmentRole.DONO)).toBe(true);
  });

  it.each([
    EstablishmentRole.GERENTE,
    EstablishmentRole.RECEPCIONISTA,
    EstablishmentRole.PROFISSIONAL,
  ])('%s não busca neste lote', (role) => {
    expect(canViewConsumers(role)).toBe(false);
  });

  it('DENIED em CONSUMIDORES_VISUALIZAR tira o acesso do próprio DONO', () => {
    expect(canViewConsumers(EstablishmentRole.DONO, negado(Permission.CONSUMIDORES_VISUALIZAR))).toBe(
      false,
    );
  });

  it('buscar não exige CONSUMIDORES_GERENCIAR', () => {
    expect(canViewConsumers(EstablishmentRole.DONO, negado(Permission.CONSUMIDORES_GERENCIAR))).toBe(
      true,
    );
  });
});

describe('canManageConsumers', () => {
  it('DONO cadastra', () => {
    expect(canManageConsumers(EstablishmentRole.DONO)).toBe(true);
  });

  it.each([Permission.CONSUMIDORES_VISUALIZAR, Permission.CONSUMIDORES_GERENCIAR])(
    'DENIED em %s impede cadastrar',
    (permission) => {
      expect(canManageConsumers(EstablishmentRole.DONO, negado(permission))).toBe(false);
    },
  );

  it('quem não pode gerenciar ainda pode buscar', () => {
    const overrides = negado(Permission.CONSUMIDORES_GERENCIAR);
    expect(canManageConsumers(EstablishmentRole.DONO, overrides)).toBe(false);
    expect(canViewConsumers(EstablishmentRole.DONO, overrides)).toBe(true);
  });

  it('GRANTED nunca amplia: continua sem cadastrar quem não é DONO', () => {
    expect(
      canManageConsumers(EstablishmentRole.RECEPCIONISTA, concedido(Permission.CONSUMIDORES_GERENCIAR)),
    ).toBe(false);
  });
});

describe('canMergeConsumers', () => {
  it('só o DONO unifica', () => {
    expect(canMergeConsumers(EstablishmentRole.DONO)).toBe(true);
  });

  it.each([EstablishmentRole.GERENTE, EstablishmentRole.RECEPCIONISTA, EstablishmentRole.PROFISSIONAL])(
    '%s não unifica, nem com CONSUMIDORES_GERENCIAR concedida',
    (role) => {
      expect(canMergeConsumers(role)).toBe(false);
      expect(
        canMergeConsumers(role, [
          ...concedido(Permission.CONSUMIDORES_VISUALIZAR),
          ...concedido(Permission.CONSUMIDORES_GERENCIAR),
        ]),
      ).toBe(false);
    },
  );

  it.each([Permission.CONSUMIDORES_VISUALIZAR, Permission.CONSUMIDORES_GERENCIAR])(
    'DENIED em %s tira a unificação do próprio DONO',
    (permission) => {
      expect(canMergeConsumers(EstablishmentRole.DONO, negado(permission))).toBe(false);
    },
  );
});
