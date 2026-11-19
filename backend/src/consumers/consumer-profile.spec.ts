// O que o histórico da ficha mostra para cada papel (regra pura). O SQL da
// ficha, do histórico e da lista agrupada: test/consumers-identity-postgres.db-e2e-spec.ts.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { oQueOHistoricoMostra } from './consumer-profile.service.js';

// Permissões de gerente pelo nome do catálogo (common/manager-permissions.ts).
const concedido = (...permissions: string[]) =>
  permissions.map((permission) => ({ permission: permission as Permission, mode: PermissionMode.GRANTED }));
const negado = (permission: Permission) => [{ permission, mode: PermissionMode.DENIED }];

describe('oQueOHistoricoMostra', () => {
  it('dono vê preço e recebimento quando o recurso está contratado', () => {
    expect(oQueOHistoricoMostra({ role: EstablishmentRole.DONO }, true)).toEqual({ veDinheiro: true, veRecebimentos: true });
  });

  it('sem o recurso de pagamentos, ninguém vê recebimento (o preço continua para o dono)', () => {
    expect(oQueOHistoricoMostra({ role: EstablishmentRole.DONO }, false)).toEqual({ veDinheiro: true, veRecebimentos: false });
  });

  it('dono com a agenda negada não vê recebimento (mesma política dos recebimentos)', () => {
    expect(oQueOHistoricoMostra({ role: EstablishmentRole.DONO, overrides: negado(Permission.AGENDA_VISUALIZAR) }, true)).toEqual({
      veDinheiro: true,
      veRecebimentos: false,
    });
  });

  it('gerente só com clientes não vê preço nem recebimento', () => {
    expect(oQueOHistoricoMostra({ role: EstablishmentRole.GERENTE, overrides: concedido('CONSUMIDORES_VISUALIZAR') }, true)).toEqual({
      veDinheiro: false,
      veRecebimentos: false,
    });
  });

  it('gerente com a consulta de recebimentos vê preço e recebimento', () => {
    const overrides = concedido(
      'CONSUMIDORES_VISUALIZAR',
      'RECEBIMENTOS_VISUALIZAR',
      'AGENDA_VISUALIZAR',
      'PROFISSIONAIS_VISUALIZAR',
    );
    expect(oQueOHistoricoMostra({ role: EstablishmentRole.GERENTE, overrides }, true)).toEqual({ veDinheiro: true, veRecebimentos: true });
  });

  it('profissional nunca vê dinheiro de recebimento', () => {
    expect(oQueOHistoricoMostra({ role: EstablishmentRole.PROFISSIONAL }, true).veRecebimentos).toBe(false);
  });
});
