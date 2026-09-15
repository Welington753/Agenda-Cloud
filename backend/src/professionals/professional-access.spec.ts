import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { canManageProfessionals, canViewProfessionals } from './professional-access.js';

const DENY_VIEW = { permission: Permission.PROFISSIONAIS_VISUALIZAR, mode: PermissionMode.DENIED };
const DENY_MANAGE = { permission: Permission.PROFISSIONAIS_GERENCIAR, mode: PermissionMode.DENIED };
const GRANT_MANAGE = { permission: Permission.PROFISSIONAIS_GERENCIAR, mode: PermissionMode.GRANTED };

describe('política de acesso a profissionais (Lote 6D.2)', () => {
  it('DONO sem override nenhum pode ver e gerenciar', () => {
    expect(canViewProfessionals(EstablishmentRole.DONO)).toBe(true);
    expect(canManageProfessionals(EstablishmentRole.DONO)).toBe(true);
  });

  it.each([
    EstablishmentRole.GERENTE,
    EstablishmentRole.RECEPCIONISTA,
    EstablishmentRole.PROFISSIONAL,
  ])('%s não ganha acesso por suposição neste lote', (role) => {
    expect(canViewProfessionals(role)).toBe(false);
    expect(canManageProfessionals(role)).toBe(false);
  });

  it('DENIED em GERENCIAR tira a gestão do DONO, mantendo a leitura', () => {
    expect(canManageProfessionals(EstablishmentRole.DONO, [DENY_MANAGE])).toBe(false);
    expect(canViewProfessionals(EstablishmentRole.DONO, [DENY_MANAGE])).toBe(true);
  });

  it('DENIED em VISUALIZAR tira as duas — nunca "edita o que não pode ver"', () => {
    expect(canViewProfessionals(EstablishmentRole.DONO, [DENY_VIEW])).toBe(false);
    expect(canManageProfessionals(EstablishmentRole.DONO, [DENY_VIEW])).toBe(false);
  });

  it('GRANTED nunca amplia um papel que não tem acesso padrão neste lote', () => {
    expect(canManageProfessionals(EstablishmentRole.GERENTE, [GRANT_MANAGE])).toBe(false);
    expect(canViewProfessionals(EstablishmentRole.RECEPCIONISTA, [GRANT_MANAGE])).toBe(false);
  });

  it('override de outra permissão não interfere em profissionais', () => {
    const outra = { permission: Permission.SERVICOS_GERENCIAR, mode: PermissionMode.DENIED };
    expect(canManageProfessionals(EstablishmentRole.DONO, [outra])).toBe(true);
  });

  it('DENIED vence mesmo convivendo com um GRANTED da mesma permissão', () => {
    expect(canManageProfessionals(EstablishmentRole.DONO, [GRANT_MANAGE, DENY_MANAGE])).toBe(false);
  });
});
