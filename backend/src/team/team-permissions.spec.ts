// Concessões que o dono pode deixar num acesso de equipe, com foco no perfil
// Recepcionista (docs/plans/vendas-v1.md, seção 3): só as três concessões de
// vendas da lista dela, cada uma explícita, sem profissional ligado.
import { describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { validarConcessoes } from './team-permissions.js';
import { MANAGER_PERMISSIONS, RECEPTIONIST_PERMISSIONS, type ManagerPermission } from '../common/manager-permissions.js';
import { grantableManagerPermissions } from './staff-access.js';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import type { TeamPermission } from './team.dto.js';
import { staffAccessChangeSchema, staffAccountSchema } from './team.dto.js';

const DONO_COMPLETO = {
  grantable: ['ATENDIMENTO_PROPRIO_INICIAR' as const],
  grantableManager: grantableManagerPermissions(EstablishmentRole.DONO, []),
  managerWithoutFeature: [] as ManagerPermission[],
};

const codigo = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(ConflictException);
    return ((e as ConflictException).getResponse() as { code: string }).code;
  }
};

const recepcionista = { role: 'RECEPCIONISTA' as const, withProfessional: false };

describe('concessões da recepcionista', () => {
  it('o dono sem restrição pode conceder as seis de vendas (o catálogo as inclui)', () => {
    for (const p of ['VENDAS_REGISTRAR', 'VENDAS_RECEBER', 'VENDAS_ALTERAR_PRECO', 'VENDAS_VISUALIZAR', 'VENDAS_CANCELAR', 'VENDAS_ESTORNAR_RECEBIMENTO']) {
      expect(DONO_COMPLETO.grantableManager).toContain(p);
    }
  });

  it('aceita cada concessão da lista dela, separada, com as dependências junto', () => {
    expect(codigo(() => validarConcessoes(DONO_COMPLETO, recepcionista, ['VENDAS_REGISTRAR']))).toBeNull();
    expect(codigo(() => validarConcessoes(DONO_COMPLETO, recepcionista, ['VENDAS_REGISTRAR', 'VENDAS_RECEBER']))).toBeNull();
    expect(codigo(() => validarConcessoes(DONO_COMPLETO, recepcionista, ['VENDAS_REGISTRAR', 'VENDAS_ALTERAR_PRECO']))).toBeNull();
    expect(codigo(() => validarConcessoes(DONO_COMPLETO, recepcionista, [...RECEPTIONIST_PERMISSIONS]))).toBeNull();
    expect(codigo(() => validarConcessoes(DONO_COMPLETO, recepcionista, []))).toBeNull();
  });

  it('dependência que falta: PERMISSOES_INCOMPLETAS (receber ou preço sem registrar)', () => {
    expect(codigo(() => validarConcessoes(DONO_COMPLETO, recepcionista, ['VENDAS_RECEBER']))).toBe('PERMISSOES_INCOMPLETAS');
    expect(codigo(() => validarConcessoes(DONO_COMPLETO, recepcionista, ['VENDAS_ALTERAR_PRECO']))).toBe('PERMISSOES_INCOMPLETAS');
  });

  it.each(
    MANAGER_PERMISSIONS.filter((p) => !(RECEPTIONIST_PERMISSIONS as readonly string[]).includes(p)).map((p) => [p]),
  )('recusa %s para a recepcionista (PERMISSAO_NAO_SE_APLICA)', (p) => {
    expect(codigo(() => validarConcessoes(DONO_COMPLETO, recepcionista, ['VENDAS_REGISTRAR', p as TeamPermission]))).toBe(
      'PERMISSAO_NAO_SE_APLICA',
    );
  });

  it('recusa as ações próprias (não há profissional ligado)', () => {
    expect(codigo(() => validarConcessoes(DONO_COMPLETO, recepcionista, ['ATENDIMENTO_PROPRIO_INICIAR']))).toBe(
      'PERMISSAO_NAO_SE_APLICA',
    );
  });

  it('sem o adicional Vendas, a concessão nova é recusada (RECURSO_NAO_CONTRATADO); retirar continua possível', () => {
    const semVendas = { ...DONO_COMPLETO, managerWithoutFeature: [...RECEPTIONIST_PERMISSIONS] as ManagerPermission[] };
    expect(codigo(() => validarConcessoes(semVendas, recepcionista, ['VENDAS_REGISTRAR']))).toBe('RECURSO_NAO_CONTRATADO');
    expect(codigo(() => validarConcessoes(semVendas, recepcionista, ['VENDAS_REGISTRAR'], []))).toBeNull();
  });

  it('o dono só concede o que ele mesmo pode (DENIED no dono): PERMISSAO_NAO_DISPONIVEL', () => {
    const restrito = {
      ...DONO_COMPLETO,
      grantableManager: DONO_COMPLETO.grantableManager.filter((p) => p !== 'VENDAS_ALTERAR_PRECO'),
    };
    expect(codigo(() => validarConcessoes(restrito, recepcionista, ['VENDAS_REGISTRAR', 'VENDAS_ALTERAR_PRECO']))).toBe(
      'PERMISSAO_NAO_DISPONIVEL',
    );
  });

  it('profissional continua sem áreas; gerente recebe as seis de vendas', () => {
    expect(
      codigo(() => validarConcessoes(DONO_COMPLETO, { role: 'PROFISSIONAL', withProfessional: true }, ['VENDAS_REGISTRAR'])),
    ).toBe('PERMISSAO_NAO_SE_APLICA');
    expect(
      codigo(() =>
        validarConcessoes(DONO_COMPLETO, { role: 'GERENTE', withProfessional: false }, [
          'VENDAS_REGISTRAR',
          'VENDAS_RECEBER',
          'VENDAS_VISUALIZAR',
          'VENDAS_CANCELAR',
        ]),
      ),
    ).toBeNull();
  });
});

describe('corpo das rotas de equipe com o perfil Recepcionista', () => {
  const base = { requestKey: 'chave-recepcao-0001', name: 'Rita Recepção', username: 'rita.recepcao', permissions: [] };

  it('cria recepcionista sem profissional; recusa profissional ligado', () => {
    expect(staffAccountSchema.safeParse({ ...base, role: 'RECEPCIONISTA' }).success).toBe(true);
    const comProfissional = staffAccountSchema.safeParse({ ...base, role: 'RECEPCIONISTA', professionalId: 'prof_0000000000000000000001' });
    expect(comProfissional.success).toBe(false);
  });

  it('profissional continua exigindo o profissional ligado; gerente pode ter ou não', () => {
    expect(staffAccountSchema.safeParse({ ...base, role: 'PROFISSIONAL' }).success).toBe(false);
    expect(staffAccountSchema.safeParse({ ...base, role: 'GERENTE' }).success).toBe(true);
  });

  it('troca de perfil para Recepcionista exige sem profissional', () => {
    const expected = { role: 'PROFISSIONAL', professionalId: 'prof_0000000000000000000001', granted: [] };
    expect(staffAccessChangeSchema.safeParse({ expected, role: 'RECEPCIONISTA', professionalId: null, granted: ['VENDAS_REGISTRAR'] }).success).toBe(true);
    expect(
      staffAccessChangeSchema.safeParse({ expected, role: 'RECEPCIONISTA', professionalId: 'prof_0000000000000000000001', granted: [] }).success,
    ).toBe(false);
  });
});
