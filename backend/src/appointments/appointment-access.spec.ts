// Política de acesso aos agendamentos (Lote 6D.5).
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import {
  canCancelAppointments,
  canCreateAppointments,
  canRescheduleAppointments,
  canViewAppointments,
} from './appointment-access.js';

const negado = (permission: Permission) => [{ permission, mode: PermissionMode.DENIED }];
const concedido = (permission: Permission) => [{ permission, mode: PermissionMode.GRANTED }];

const OUTROS_PAPEIS = [
  EstablishmentRole.GERENTE,
  EstablishmentRole.RECEPCIONISTA,
  EstablishmentRole.PROFISSIONAL,
];

describe('canViewAppointments', () => {
  it('DONO vê a agenda', () => {
    expect(canViewAppointments(EstablishmentRole.DONO)).toBe(true);
  });

  it.each(OUTROS_PAPEIS)('%s não vê neste lote', (role) => {
    expect(canViewAppointments(role)).toBe(false);
  });

  it('DENIED em AGENDA_VISUALIZAR tira o acesso do próprio DONO', () => {
    expect(canViewAppointments(EstablishmentRole.DONO, negado(Permission.AGENDA_VISUALIZAR))).toBe(
      false,
    );
  });

  it('ver não exige AGENDAMENTO_CRIAR — quem só consulta continua consultando', () => {
    expect(canViewAppointments(EstablishmentRole.DONO, negado(Permission.AGENDAMENTO_CRIAR))).toBe(
      true,
    );
  });

  it('DENIED em permissão de outra área não interfere', () => {
    expect(
      canViewAppointments(EstablishmentRole.DONO, negado(Permission.COMISSOES_VISUALIZAR)),
    ).toBe(true);
  });
});

describe('canCreateAppointments', () => {
  it('DONO cria', () => {
    expect(canCreateAppointments(EstablishmentRole.DONO)).toBe(true);
  });

  it.each(OUTROS_PAPEIS)('%s não cria neste lote', (role) => {
    expect(canCreateAppointments(role)).toBe(false);
  });

  it.each([
    Permission.AGENDA_VISUALIZAR,
    Permission.AGENDAMENTO_CRIAR,
    Permission.PROFISSIONAIS_VISUALIZAR,
    Permission.SERVICOS_VISUALIZAR,
    Permission.CONSUMIDORES_VISUALIZAR,
  ])('DENIED em %s impede a criação', (permission) => {
    expect(canCreateAppointments(EstablishmentRole.DONO, negado(permission))).toBe(false);
  });

  it('DENIED só em AGENDAMENTO_CRIAR bloqueia criar mas não bloqueia ver', () => {
    const overrides = negado(Permission.AGENDAMENTO_CRIAR);
    expect(canCreateAppointments(EstablishmentRole.DONO, overrides)).toBe(false);
    expect(canViewAppointments(EstablishmentRole.DONO, overrides)).toBe(true);
  });

  it('GRANTED nunca amplia: continua sem criar quem não é DONO', () => {
    expect(
      canCreateAppointments(EstablishmentRole.RECEPCIONISTA, concedido(Permission.AGENDAMENTO_CRIAR)),
    ).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Lote 6D.6 — cancelar e remarcar.
describe('canCancelAppointments', () => {
  it('DONO sem override pode cancelar', () => {
    expect(canCancelAppointments(EstablishmentRole.DONO)).toBe(true);
  });

  it.each([
    EstablishmentRole.GERENTE,
    EstablishmentRole.RECEPCIONISTA,
    EstablishmentRole.PROFISSIONAL,
  ])('%s não pode cancelar — ampliar é decisão de um lote de papéis', (role) => {
    expect(canCancelAppointments(role)).toBe(false);
  });

  it.each([Permission.AGENDA_VISUALIZAR, Permission.AGENDAMENTO_CANCELAR])(
    'DENIED em %s impede cancelar',
    (permission) => {
      expect(canCancelAppointments(EstablishmentRole.DONO, negado(permission))).toBe(false);
    },
  );

  it.each([
    Permission.SERVICOS_VISUALIZAR,
    Permission.PROFISSIONAIS_VISUALIZAR,
    Permission.CONSUMIDORES_VISUALIZAR,
    Permission.AGENDAMENTO_CRIAR,
  ])('DENIED em %s NÃO impede cancelar', (permission) => {
    // Cancelar não escolhe serviço, profissional nem cliente — e precisa
    // funcionar mesmo com o serviço/profissional já desativado.
    expect(canCancelAppointments(EstablishmentRole.DONO, negado(permission))).toBe(true);
  });

  it('GRANTED nunca amplia: continua sem cancelar quem não é DONO', () => {
    expect(
      canCancelAppointments(
        EstablishmentRole.RECEPCIONISTA,
        concedido(Permission.AGENDAMENTO_CANCELAR),
      ),
    ).toBe(false);
  });
});

describe('canRescheduleAppointments', () => {
  it('DONO sem override pode remarcar', () => {
    expect(canRescheduleAppointments(EstablishmentRole.DONO)).toBe(true);
  });

  it.each([
    EstablishmentRole.GERENTE,
    EstablishmentRole.RECEPCIONISTA,
    EstablishmentRole.PROFISSIONAL,
  ])('%s não pode remarcar', (role) => {
    expect(canRescheduleAppointments(role)).toBe(false);
  });

  it.each([
    Permission.AGENDA_VISUALIZAR,
    Permission.AGENDAMENTO_EDITAR,
    Permission.PROFISSIONAIS_VISUALIZAR,
    Permission.SERVICOS_VISUALIZAR,
  ])('DENIED em %s impede remarcar', (permission) => {
    expect(canRescheduleAppointments(EstablishmentRole.DONO, negado(permission))).toBe(false);
  });

  it('DENIED em CONSUMIDORES_VISUALIZAR NÃO impede remarcar', () => {
    // O cliente da reserva é preservado, nunca reescolhido.
    expect(
      canRescheduleAppointments(
        EstablishmentRole.DONO,
        negado(Permission.CONSUMIDORES_VISUALIZAR),
      ),
    ).toBe(true);
  });

  it('cancelar e remarcar são independentes entre si', () => {
    const semEditar = negado(Permission.AGENDAMENTO_EDITAR);
    expect(canRescheduleAppointments(EstablishmentRole.DONO, semEditar)).toBe(false);
    expect(canCancelAppointments(EstablishmentRole.DONO, semEditar)).toBe(true);

    const semCancelar = negado(Permission.AGENDAMENTO_CANCELAR);
    expect(canCancelAppointments(EstablishmentRole.DONO, semCancelar)).toBe(false);
    expect(canRescheduleAppointments(EstablishmentRole.DONO, semCancelar)).toBe(true);
  });
});
