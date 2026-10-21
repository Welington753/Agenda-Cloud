import { describe, expect, it, vi } from 'vitest';
import type { PgClientLike, PgQueryResult } from './pg-client.js';
import {
  COLUNAS_ESPERADAS,
  CONSTRAINTS_ESPERADAS,
  descreverFalhasAntes,
  descreverFalhasDepois,
  type EstadoNotificacoesAgendamentoPublico,
  INDICES_ESPERADOS,
  lerEstadoNotificacoesAgendamentoPublico,
  MIGRATIONS_INICIAIS,
  MIGRATIONS_NOTIFICACOES_AGENDAMENTO_PUBLICO,
  TABELAS_NOVAS,
  TOTAL_OBJETOS_ESPERADOS,
} from './notificacoes-agendamento-publico-schema.js';

function colunasEsperadas(): EstadoNotificacoesAgendamentoPublico['colunas'] {
  return Object.entries(COLUNAS_ESPERADAS).flatMap(([tabela, colunas]) =>
    Object.entries(colunas).map(([coluna, [tipo, nulo, padrao, tamanho]]) => ({
      table_name: tabela,
      column_name: coluna,
      data_type: tipo,
      is_nullable: nulo,
      column_default: padrao,
      // O driver devolve números do catálogo como texto.
      tamanho: tamanho === null ? null : String(tamanho),
    })),
  );
}

/** Índices que o Postgres cria sozinho para PKs e UNIQUEs. */
const INDICES_DE_CONSTRAINT = Object.keys(CONSTRAINTS_ESPERADAS)
  .filter((nome) => nome.startsWith('pk_') || nome.startsWith('uq_'))
  .map((nome) => ({ indexname: nome, indexdef: `CREATE UNIQUE INDEX ${nome} ON ...` }));

function estadoDepois(): EstadoNotificacoesAgendamentoPublico {
  return {
    migrationNames: [...MIGRATIONS_INICIAIS, ...MIGRATIONS_NOTIFICACOES_AGENDAMENTO_PUBLICO],
    priceCentsIsNullable: true,
    prerequisitesPresent: true,
    tabelasNovasPresentes: [...TABELAS_NOVAS].sort(),
    colunas: colunasEsperadas(),
    constraints: Object.entries(CONSTRAINTS_ESPERADAS).map(([conname, def]) => ({ conname, def })),
    indices: [
      ...Object.entries(INDICES_ESPERADOS).map(([indexname, indexdef]) => ({ indexname, indexdef })),
      ...INDICES_DE_CONSTRAINT,
    ],
  };
}

function estadoAntes(): EstadoNotificacoesAgendamentoPublico {
  return {
    migrationNames: [...MIGRATIONS_INICIAIS],
    priceCentsIsNullable: true,
    prerequisitesPresent: true,
    tabelasNovasPresentes: [],
    // `consumers` existe, mas só com colunas do schema inicial.
    colunas: [
      {
        table_name: 'consumers',
        column_name: 'name',
        data_type: 'character varying',
        is_nullable: 'NO',
        column_default: null,
        tamanho: '120',
      },
    ],
    constraints: [],
    indices: [],
  };
}

describe('objetos esperados', () => {
  it('são os 54 da auditoria: 35 colunas, 15 constraints e 4 índices', () => {
    expect(TOTAL_OBJETOS_ESPERADOS).toBe(54);
    expect(Object.keys(CONSTRAINTS_ESPERADAS)).toHaveLength(15);
    expect(Object.keys(INDICES_ESPERADOS)).toHaveLength(4);
  });
});

describe('descreverFalhasAntes', () => {
  it('aceita exatamente as três migrations iniciais e nenhum objeto novo', () => {
    expect(descreverFalhasAntes(estadoAntes())).toEqual([]);
  });

  it.each([
    ['só a InitialSchema', [MIGRATIONS_INICIAIS[0]]],
    ['as cinco', [...MIGRATIONS_INICIAIS, ...MIGRATIONS_NOTIFICACOES_AGENDAMENTO_PUBLICO]],
    ['as três fora de ordem', [MIGRATIONS_INICIAIS[1], MIGRATIONS_INICIAIS[0], MIGRATIONS_INICIAIS[2]]],
    ['três com um nome desconhecido', [MIGRATIONS_INICIAIS[0], MIGRATIONS_INICIAIS[1], 'Outra1790000000000']],
  ])('recusa histórico com %s', (_caso, nomes) => {
    expect(descreverFalhasAntes({ ...estadoAntes(), migrationNames: nomes })).toContain('migration_history');
  });

  it('recusa quando falta o alvo das FKs compostas', () => {
    expect(descreverFalhasAntes({ ...estadoAntes(), prerequisitesPresent: false })).toContain('prerequisites');
  });

  it('recusa quando uma tabela nova já existe, mesmo vazia de colunas conhecidas', () => {
    expect(descreverFalhasAntes({ ...estadoAntes(), tabelasNovasPresentes: ['public_booking_settings'] })).toContain(
      'new_objects_present',
    );
  });

  it('recusa quando uma coluna nova de consumers já existe', () => {
    const estado = estadoAntes();
    estado.colunas.push({
      table_name: 'consumers',
      column_name: 'whatsapp_opt_in_at',
      data_type: 'timestamp with time zone',
      is_nullable: 'YES',
      column_default: null,
      tamanho: '3',
    });
    expect(descreverFalhasAntes(estado)).toContain('new_objects_present');
  });

  it('recusa o estado já migrado', () => {
    expect(descreverFalhasAntes(estadoDepois())).toEqual(['migration_history', 'new_objects_present']);
  });
});

describe('descreverFalhasDepois', () => {
  it('aceita as cinco migrations e os 54 objetos com definição exata', () => {
    expect(descreverFalhasDepois(estadoDepois())).toEqual([]);
  });

  it('recusa o estado anterior, listando cada objeto ausente', () => {
    const falhas = descreverFalhasDepois(estadoAntes());
    expect(falhas).toContain('migration_history');
    expect(falhas.filter((falha) => falha.startsWith('ausente:'))).toHaveLength(54);
  });

  it('recusa histórico com uma migration a mais, mesmo com todos os objetos', () => {
    const estado = { ...estadoDepois(), migrationNames: [...estadoDepois().migrationNames, 'Outra1799999999999'] };
    expect(descreverFalhasDepois(estado)).toEqual(['migration_history']);
  });

  it('recusa coluna com tamanho diferente', () => {
    const estado = estadoDepois();
    estado.colunas = estado.colunas.map((c) =>
      c.table_name === 'notification_jobs' && c.column_name === 'dedupe_key' ? { ...c, tamanho: '120' } : c,
    );
    expect(descreverFalhasDepois(estado)).toEqual(['diverge:notification_jobs.dedupe_key']);
  });

  it('recusa padrão diferente', () => {
    const estado = estadoDepois();
    estado.colunas = estado.colunas.map((c) =>
      c.table_name === 'public_booking_settings' && c.column_name === 'enabled' ? { ...c, column_default: 'true' } : c,
    );
    expect(descreverFalhasDepois(estado)).toEqual(['diverge:public_booking_settings.enabled']);
  });

  it('recusa CHECK sem um dos status', () => {
    const estado = estadoDepois();
    estado.constraints = estado.constraints.map((c) =>
      c.conname === 'ck_notification_jobs_status' ? { ...c, def: c.def.replace(", 'CANCELED'::character varying", '') } : c,
    );
    expect(descreverFalhasDepois(estado)).toEqual(['diverge:ck_notification_jobs_status']);
  });

  it('recusa FK com ON DELETE diferente', () => {
    const estado = estadoDepois();
    estado.constraints = estado.constraints.map((c) =>
      c.conname === 'fk_public_booking_requests_tenant' ? { ...c, def: c.def.replace('RESTRICT', 'CASCADE') } : c,
    );
    expect(descreverFalhasDepois(estado)).toEqual(['diverge:fk_public_booking_requests_tenant']);
  });

  it('recusa índice parcial sem o WHERE', () => {
    const estado = estadoDepois();
    estado.indices = estado.indices.map((i) =>
      i.indexname === 'uq_notification_jobs_provider_message_id'
        ? { ...i, indexdef: i.indexdef.replace(' WHERE (provider_message_id IS NOT NULL)', '') }
        : i,
    );
    expect(descreverFalhasDepois(estado)).toEqual(['diverge:uq_notification_jobs_provider_message_id']);
  });

  it('recusa coluna, constraint e índice a mais nas tabelas novas', () => {
    const estado = estadoDepois();
    estado.colunas.push({ ...estado.colunas[3]!, table_name: 'notification_jobs', column_name: 'extra_col' });
    estado.constraints.push({ conname: 'ck_extra', def: 'CHECK (true)' });
    estado.indices.push({ indexname: 'idx_extra', indexdef: 'CREATE INDEX idx_extra ON ...' });
    expect(descreverFalhasDepois(estado)).toEqual([
      'extra:notification_jobs.extra_col',
      'extra:ck_extra',
      'extra:idx_extra',
    ]);
  });
});

describe('lerEstadoNotificacoesAgendamentoPublico', () => {
  it('só lê: READ ONLY, nenhum comando de escrita, termina em ROLLBACK', async () => {
    const sql: string[] = [];
    const client: PgClientLike = {
      connect: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockImplementation((texto: string): Promise<PgQueryResult<Record<string, unknown>>> => {
        sql.push(texto);
        if (texto.includes('typeorm_migrations')) {
          return Promise.resolve({ rows: MIGRATIONS_INICIAIS.map((name) => ({ name })) });
        }
        if (texto.includes('AS ok')) return Promise.resolve({ rows: [{ ok: true }] });
        return Promise.resolve({ rows: [] });
      }),
    };

    const estado = await lerEstadoNotificacoesAgendamentoPublico(client);

    expect(estado.migrationNames).toEqual([...MIGRATIONS_INICIAIS]);
    expect(sql[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(sql.at(-1)).toBe('ROLLBACK');
    for (const comando of sql) {
      expect(comando).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMIT)\b/i);
    }
  });

  it('erro no meio: faz ROLLBACK e propaga', async () => {
    const sql: string[] = [];
    const client: PgClientLike = {
      connect: vi.fn(),
      end: vi.fn(),
      query: vi.fn().mockImplementation((texto: string) => {
        sql.push(texto);
        if (texto.includes('typeorm_migrations')) return Promise.reject(new Error('relation does not exist'));
        return Promise.resolve({ rows: [] });
      }),
    };

    await expect(lerEstadoNotificacoesAgendamentoPublico(client)).rejects.toThrow('relation does not exist');
    expect(sql.at(-1)).toBe('ROLLBACK');
  });
});
