// Conferência de TeamManagerAccess no piloto, sem banco: os nomes e formatos
// duplicados batem com a migration, e as falhas antes/depois saem dos estados
// certos. A leitura real roda contra PostgreSQL descartável em
// test/pilot-team-manager-check.db-e2e-spec.ts.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LOGIN_USERNAME_MAX,
  LOGIN_USERNAME_MIN,
  LOGIN_USERNAME_PATTERN,
  MANAGER_NEW_PERMISSIONS,
  TeamManagerAccess1793145600000,
} from '../../src/migrations/1793145600000-TeamManagerAccess.js';
import { USERNAME_PATTERN } from '../../src/migrations/1792972800000-StaffLogin.js';
import {
  COLUNAS_GERENTE,
  FORMATO_ANTERIOR_DO_LOGIN,
  FORMATO_NOVO_DO_LOGIN,
  MIGRATIONS_ATE_PAGAMENTOS,
  MIGRATION_GERENTE,
  TOTAL_OBJETOS_GERENTE,
  VALORES_GERENTE,
  classificarFormato,
  falhasAntesDeGerente,
  falhasDepoisDeGerente,
  objetosGerentePresentes,
  type EstadoGerente,
} from './gerente-acessos-schema.js';

const GATILHO =
  'CREATE TRIGGER trg_users_login_identifier BEFORE INSERT OR UPDATE OF email, username ON public.users FOR EACH ROW EXECUTE FUNCTION users_login_identifier_guard()';

const antes: EstadoGerente = {
  migrationNames: [...MIGRATIONS_ATE_PAGAMENTOS],
  colunas: [],
  valores: [],
  funcao: false,
  gatilho: { existe: false, habilitado: false, definicao: '' },
  formatoDoLogin: 'anterior',
  preRequisitosAusentes: [],
  colisoesCruzadas: 0,
};

const depois: EstadoGerente = {
  ...antes,
  migrationNames: [...MIGRATIONS_ATE_PAGAMENTOS, MIGRATION_GERENTE],
  colunas: COLUNAS_GERENTE.map(([t, c]) => `${t}.${c}`),
  valores: [...VALORES_GERENTE],
  funcao: true,
  gatilho: { existe: true, habilitado: true, definicao: GATILHO },
  formatoDoLogin: 'novo',
};

describe('nomes e formatos derivados da migration', () => {
  it('migration, valores novos de permission e formatos do login', () => {
    expect(MIGRATION_GERENTE).toBe(new TeamManagerAccess1793145600000().name);
    expect(VALORES_GERENTE).toEqual(MANAGER_NEW_PERMISSIONS.map((p) => `permission.${p}`));
    expect(FORMATO_NOVO_DO_LOGIN).toBe(LOGIN_USERNAME_PATTERN);
    expect(FORMATO_ANTERIOR_DO_LOGIN).toBe(USERNAME_PATTERN);
    expect([LOGIN_USERNAME_MIN, LOGIN_USERNAME_MAX]).toEqual([3, 80]);
  });

  it('o histórico anterior é exatamente o das migrations que existem antes da nova, na ordem', () => {
    const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/migrations');
    const arquivos = readdirSync(pasta)
      .filter((n) => /^\d+-[A-Za-z]+\.ts$/.test(n))
      .sort();
    const nomes = arquivos.map((n) => {
      const [, carimbo, nome] = /^(\d+)-([A-Za-z]+)\.ts$/.exec(n)!;
      return `${nome}${carimbo}`;
    });
    // Migrations posteriores (CommercialAccess em diante) não entram na
    // conferência do gerente: o corte é a própria TeamManagerAccess.
    const ate = nomes.slice(0, nomes.indexOf(MIGRATION_GERENTE) + 1);
    expect(ate.at(-1)).toBe(MIGRATION_GERENTE);
    expect(ate.slice(0, -1)).toEqual([...MIGRATIONS_ATE_PAGAMENTOS]);
  });

  it('a constraint do formato é reconhecida pelo texto que o PostgreSQL devolve', () => {
    const anterior = `CHECK (((username IS NULL) OR ((username)::text ~ '${USERNAME_PATTERN}'::text)))`;
    const novo = `CHECK (((username IS NULL) OR (((username)::text ~ '${LOGIN_USERNAME_PATTERN}'::text) AND ((char_length((username)::text) >= 3) AND (char_length((username)::text) <= 80)))))`;
    expect(classificarFormato(anterior)).toBe('anterior');
    expect(classificarFormato(novo)).toBe('novo');
    expect(classificarFormato(undefined)).toBe('ausente');
    expect(classificarFormato("CHECK ((username)::text ~ '^.*$'::text)")).toBe('outro');
  });
});

describe('falhas antes e depois', () => {
  it('antes: dez migrations exatas, nada novo, formato anterior e nenhuma colisão', () => {
    expect(falhasAntesDeGerente(antes)).toEqual([]);
    expect(objetosGerentePresentes(antes)).toBe(0);
    expect(falhasAntesDeGerente({ ...antes, colisoesCruzadas: 1 })).toEqual(['login_identifier_collisions']);
    expect(falhasAntesDeGerente({ ...antes, migrationNames: antes.migrationNames.slice(0, -1) })).toContain('migration_history');
    expect(falhasAntesDeGerente({ ...antes, preRequisitosAusentes: ['uq_users_username'] })).toContain('uq_users_username');
    expect(falhasAntesDeGerente(depois)).toEqual(
      expect.arrayContaining([
        'migration_history',
        'new_columns_already_exist',
        'new_enum_values_already_exist',
        'login_guard_function_already_exists',
        'login_guard_trigger_already_exists',
        'username_format_novo',
      ]),
    );
  });

  it('depois: onze migrations, tudo presente, gatilho habilitado e na definição certa', () => {
    expect(falhasDepoisDeGerente(depois)).toEqual([]);
    expect(objetosGerentePresentes(depois)).toBe(TOTAL_OBJETOS_GERENTE);
    expect(falhasDepoisDeGerente({ ...depois, gatilho: { ...depois.gatilho, habilitado: false } })).toEqual([
      'login_guard_trigger_disabled',
    ]);
    expect(
      falhasDepoisDeGerente({ ...depois, gatilho: { ...depois.gatilho, definicao: GATILHO.replace('UPDATE OF email, username', 'UPDATE OF email') } }),
    ).toEqual(['login_guard_trigger_definition']);
    expect(falhasDepoisDeGerente({ ...depois, formatoDoLogin: 'anterior' })).toEqual(['username_format_anterior']);
    expect(falhasDepoisDeGerente({ ...depois, colisoesCruzadas: 3 })).toEqual(['login_identifier_collisions']);
    expect(falhasDepoisDeGerente(antes)).toEqual(
      expect.arrayContaining([
        'migration_history',
        'column_memberships_permissions_confirmed_at',
        'users_login_identifier_guard',
        'trg_users_login_identifier',
        'username_format_anterior',
      ]),
    );
  });
});
