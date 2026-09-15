import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { canManageServices, canViewServices } from './service-access.js';

const DENY_VIEW = { permission: Permission.SERVICOS_VISUALIZAR, mode: PermissionMode.DENIED };
const DENY_MANAGE = { permission: Permission.SERVICOS_GERENCIAR, mode: PermissionMode.DENIED };
const GRANT_MANAGE = { permission: Permission.SERVICOS_GERENCIAR, mode: PermissionMode.GRANTED };

describe('política de acesso a serviços (Lote 6D.1)', () => {
  it('DONO sem override nenhum pode ver e gerenciar', () => {
    expect(canViewServices(EstablishmentRole.DONO)).toBe(true);
    expect(canManageServices(EstablishmentRole.DONO)).toBe(true);
  });

  it.each([
    EstablishmentRole.GERENTE,
    EstablishmentRole.RECEPCIONISTA,
    EstablishmentRole.PROFISSIONAL,
  ])('%s não ganha acesso por suposição neste lote', (role) => {
    expect(canViewServices(role)).toBe(false);
    expect(canManageServices(role)).toBe(false);
  });

  it('DENIED em GERENCIAR tira a gestão do DONO, mantendo a leitura', () => {
    expect(canManageServices(EstablishmentRole.DONO, [DENY_MANAGE])).toBe(false);
    expect(canViewServices(EstablishmentRole.DONO, [DENY_MANAGE])).toBe(true);
  });

  it('DENIED em VISUALIZAR tira as duas — nunca "edita o que não pode ver"', () => {
    expect(canViewServices(EstablishmentRole.DONO, [DENY_VIEW])).toBe(false);
    expect(canManageServices(EstablishmentRole.DONO, [DENY_VIEW])).toBe(false);
  });

  it('GRANTED nunca amplia um papel que não tem acesso padrão neste lote', () => {
    expect(canManageServices(EstablishmentRole.GERENTE, [GRANT_MANAGE])).toBe(false);
    expect(canViewServices(EstablishmentRole.RECEPCIONISTA, [GRANT_MANAGE])).toBe(false);
  });

  it('override de outra permissão não interfere em serviços', () => {
    const outra = { permission: Permission.AGENDA_GERENCIAR, mode: PermissionMode.DENIED };
    expect(canManageServices(EstablishmentRole.DONO, [outra])).toBe(true);
  });

  it('DENIED vence mesmo convivendo com um GRANTED da mesma permissão', () => {
    expect(canManageServices(EstablishmentRole.DONO, [GRANT_MANAGE, DENY_MANAGE])).toBe(false);
  });
});
