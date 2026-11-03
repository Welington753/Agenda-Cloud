// Regras puras da publicação de PlatformPortal e AppointmentServiceSnapshots,
// sem banco nem rede. Endpoint IDs, commits e hashes são fictícios. As regras
// comuns (modo, destino, servidores, falhas, registros) são as de TeamAccess
// e estão cobertas em equipe-piloto.spec.ts; aqui, o que é desta operação. O
// fluxo completo foi ensaiado contra PostgreSQL descartável
// (docs/runbooks/publicacao-portal-multisservicos-piloto.md).
import { describe, expect, it } from 'vitest';
import { Parada } from './entrada-oculta.mjs';
import * as equipe from './equipe-piloto.mjs';
import * as gerente from './gerente-piloto.mjs';
import * as comercial from './comercial-piloto.mjs';
import {
  APLICACOES_DAS_MIGRATIONS,
  CODIGOS_DE_DESFECHO,
  ESTADOS,
  ETAPAS,
  OPERACAO_CONFERIR,
  avaliarBackupConferido,
  classificarFalha,
  conferirContas,
  decidirAplicacao,
  desfechoDoErro,
  escolherEtapa,
  execucaoPendente,
  identificarEstado,
} from './portal-multisservicos-piloto.mjs';
import { PlatformPortal1793318400000 } from '../src/migrations/1793318400000-PlatformPortal.js';
import { AppointmentServiceSnapshots1793404800000 } from '../src/migrations/1793404800000-AppointmentServiceSnapshots.js';

const PILOTO = 'ep-piloto-111111';
const { portal, multisservicos } = ETAPAS;

const codigoDe = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(Parada);
    return (e as Parada).message;
  }
};

describe('identidade das etapas', () => {
  it('migrations, frases e estados encadeados: antes, intermediário, final', () => {
    expect(portal.migration).toBe(new PlatformPortal1793318400000().name);
    expect(multisservicos.migration).toBe(new AppointmentServiceSnapshots1793404800000().name);
    expect(portal.frase).toBe('APLICAR PlatformPortal1793318400000');
    expect(multisservicos.frase).toBe('APLICAR AppointmentServiceSnapshots1793404800000');
    expect(ESTADOS).toEqual(['before-platform-portal', 'after-platform-portal', 'after-appointment-snapshots']);
    expect([portal.esperadoAntes, portal.esperadoDepois]).toEqual(ESTADOS.slice(0, 2));
    expect([multisservicos.esperadoAntes, multisservicos.esperadoDepois]).toEqual(ESTADOS.slice(1, 3));
  });

  it('operações, pastas e sessões próprias, diferentes entre si e das publicações anteriores', () => {
    const operacoes = [portal.operacao, multisservicos.operacao, OPERACAO_CONFERIR];
    const pastas = [portal.prefixoDasPastas, multisservicos.prefixoDasPastas];
    for (const outro of [equipe, gerente, comercial]) {
      expect(operacoes).not.toContain(outro.OPERACAO);
      expect(pastas).not.toContain(outro.PREFIXO_DAS_PASTAS);
      expect(APLICACOES_DAS_MIGRATIONS).not.toContain(outro.APLICACAO_DA_MIGRATION);
    }
    expect(new Set(operacoes).size).toBe(3);
    expect(new Set(pastas).size).toBe(2);
    expect(APLICACOES_DAS_MIGRATIONS).toEqual([portal.aplicacao, multisservicos.aplicacao]);
  });

  it('a etapa do portal deixa a migration seguinte de fora; a última não deixa nada', () => {
    expect(portal.posteriores).toEqual([multisservicos.migration]);
    expect(multisservicos.posteriores).toEqual([]);
  });

  it('o que muda de propósito vem das migrations', () => {
    expect(portal.colunasNovas).toEqual({ tenant_access_periods: ['amount_source'] });
    expect(portal.tabelasNovas).toEqual(['plan_prices', 'tenant_contract_prices', 'tenant_no_expiry_grants']);
    expect(multisservicos.colunasNovas).toEqual({ appointment_items: ['service_name_snapshot'] });
    expect(multisservicos.tabelasNovas).toEqual([]);
  });

  it('etapa desconhecida para antes de qualquer coisa', () => {
    expect(escolherEtapa('portal')).toBe(portal);
    for (const nome of [undefined, '', 'tudo', 'constructor', '__proto__']) {
      expect(codigoDe(() => escolherEtapa(nome))).toBe('ERR_ETAPA_INVALIDA');
    }
  });

  it('reaproveita as regras comuns de TeamAccess, sem cópia', () => {
    expect(classificarFalha).toBe(equipe.classificarFalha);
  });
});

describe('identificarEstado e decidirAplicacao', () => {
  const resultados = (passa: string[]) => Object.fromEntries(ESTADOS.map((e) => [e, passa.includes(e)]));
  const falha = 'ERR_POST_MIGRATION_BASELINE_MISMATCH';

  it('exatamente uma conferência passa: é o estado; nenhuma ou duas: divergente', () => {
    for (const e of ESTADOS) expect(identificarEstado({ resultados: resultados([e]), codigos: [falha, falha] })).toBe(e);
    expect(identificarEstado({ resultados: resultados([]), codigos: [falha, falha, falha] })).toBe('divergente');
    expect(identificarEstado({ resultados: resultados(ESTADOS.slice(0, 2)) })).toBe('divergente');
  });

  it('conferência sem leitura (conexão, TLS) não identifica estado', () => {
    expect(identificarEstado({ resultados: resultados([ESTADOS[0]!]), codigos: [undefined, 'ERR_CONNECTION_FAILED'] })).toBe(
      'nao_identificado',
    );
  });

  it('cada etapa só aplica no seu "antes"; nada é repetido nem pulado', () => {
    const [antes, intermediario, final] = ESTADOS;
    expect(decidirAplicacao(portal, antes)).toBe('aplicar');
    expect(decidirAplicacao(portal, intermediario)).toBe('ERR_ETAPA_JA_APLICADA');
    expect(decidirAplicacao(portal, final)).toBe('ERR_ETAPA_JA_APLICADA');
    expect(decidirAplicacao(multisservicos, antes)).toBe('ERR_ETAPA_ANTERIOR_PENDENTE');
    expect(decidirAplicacao(multisservicos, intermediario)).toBe('aplicar');
    expect(decidirAplicacao(multisservicos, final)).toBe('ERR_ETAPA_JA_APLICADA');
    for (const etapa of [portal, multisservicos]) {
      expect(decidirAplicacao(etapa, 'divergente')).toBe('ERR_ESTADO_ANTES_DIVERGENTE');
      expect(decidirAplicacao(etapa, 'nao_identificado')).toBe('ERR_CONFERENCIA_SEM_LEITURA');
    }
  });
});

describe('avaliarBackupConferido', () => {
  const agora = Date.parse('2026-11-03T12:00:00Z');
  const manifesto = {
    operacao: multisservicos.operacao,
    esperado: 'after-platform-portal',
    modo: 'piloto',
    endpoint: PILOTO,
    commit: 'c'.repeat(40),
    pontoDeRecuperacao: '2026-11-03T10:00:00Z',
    backup: { arquivo: 'piloto-neondb.dump', sha256: 'a'.repeat(64) },
  };
  const conferencia = {
    operacao: multisservicos.operacao,
    resultado: 'restauracao_e_ensaio_ok',
    ensaioMigration: 'ok',
    sha256: 'a'.repeat(64),
    manifestoSha256: 'f'.repeat(64),
    commit: 'c'.repeat(40),
  };
  const avaliar = (m = {}, c = {}, extra = {}) =>
    avaliarBackupConferido(multisservicos, {
      manifesto: { ...manifesto, ...m },
      conferencia: { ...conferencia, ...c },
      sha256DoDump: 'a'.repeat(64),
      sha256DoManifesto: 'f'.repeat(64),
      commit: 'c'.repeat(40),
      endpoint: PILOTO,
      modo: 'piloto',
      agora,
      ...extra,
    });

  it('aceita backup e ensaio desta etapa, do mesmo destino, modo e commit, de até 24 h', () => {
    expect(avaliar()).toEqual([]);
  });

  it.each([
    ['backup da etapa do portal', { operacao: portal.operacao, esperado: 'before-platform-portal' }, {}, {}, 'outra operação'],
    ['restauração conferida da etapa do portal', {}, { operacao: portal.operacao }, {}, 'conferência de outra operação'],
    ['backup de CommercialAccess', { operacao: comercial.OPERACAO }, {}, {}, 'outra operação'],
    ['backup do estado antes (12)', { esperado: 'before-platform-portal' }, {}, {}, 'backup fora do estado after-platform-portal'],
    ['backup do estado final', { esperado: 'after-appointment-snapshots' }, {}, {}, 'backup fora do estado after-platform-portal'],
    ['backup do ensaio no piloto', { modo: 'ensaio' }, {}, {}, 'backup do modo ensaio'],
    ['outro endpoint', { endpoint: 'ep-outro-333333' }, {}, {}, 'outro endpoint'],
    ['outro commit no backup', { commit: 'd'.repeat(40) }, {}, {}, 'backup de outro commit'],
    ['dump alterado', {}, {}, { sha256DoDump: 'b'.repeat(64) }, 'dump alterado'],
    ['manifesto editado', {}, {}, { sha256DoManifesto: 'e'.repeat(64) }, 'manifesto alterado depois da conferência'],
    ['restauração sem sucesso', {}, { resultado: 'falhou' }, {}, 'conferência sem sucesso'],
    ['sem ensaio da migration', {}, { ensaioMigration: 'nao_se_aplica' }, {}, 'migration não ensaiada na cópia'],
    ['conferência de outro dump', {}, { sha256: 'b'.repeat(64) }, {}, 'conferência de outro dump'],
    ['restauração com outro commit', {}, { commit: 'd'.repeat(40) }, {}, 'restauração conferida com outro commit'],
    ['mais de 24 h', { pontoDeRecuperacao: '2026-11-02T11:00:00Z' }, {}, {}, 'mais de 24 h'],
    ['ponto de recuperação no futuro', { pontoDeRecuperacao: '2026-11-03T13:00:00Z' }, {}, {}, 'mais de 24 h'],
  ])('recusa %s', (_caso, m, c, extra, motivo) => {
    expect(avaliar(m, c, extra)).toContain(motivo);
  });
});

describe('execucaoPendente', () => {
  const r = (fase: string, resultado: string | undefined, extra: Record<string, unknown> = {}) => ({
    operacao: portal.operacao,
    endpoint: PILOTO,
    modo: 'piloto',
    fase,
    resultado,
    execucao: 'e1',
    iniciadaEm: 't1',
    ...extra,
  });
  const conferir = (estado: string, sessoesDaMigration: number) =>
    r('conferir', undefined, { operacao: OPERACAO_CONFERIR, execucao: 'e2', estado, sessoesDaMigration });
  const filtro = { endpoint: PILOTO, modo: 'piloto' };

  it('execução incerta de uma etapa bloqueia as duas até uma conferir identificar um dos três estados', () => {
    const incerta = [r('aplicar', 'migration_iniciada'), r('aplicar', 'resultado_incerto')];
    expect(execucaoPendente(incerta, filtro)).toEqual({ operacao: portal.operacao, execucao: 'e1', iniciadaEm: 't1' });
    expect(execucaoPendente([...incerta, conferir('after-platform-portal', 1)], filtro)).not.toBeNull();
    expect(execucaoPendente([...incerta, conferir('divergente', 0)], filtro)).not.toBeNull();
    for (const estado of ESTADOS) expect(execucaoPendente([...incerta, conferir(estado, 0)], filtro)).toBeNull();
  });

  it('janela fechada depois de migration_iniciada (sem registro final) também bloqueia', () => {
    const iniciada = r('aplicar', 'migration_iniciada', { operacao: multisservicos.operacao });
    expect(execucaoPendente([iniciada], filtro)).not.toBeNull();
    expect(execucaoPendente([iniciada, r('aplicar', 'aplicada_e_conferida', { operacao: multisservicos.operacao })], filtro)).toBeNull();
    // O desfecho de outra etapa não resolve esta.
    expect(execucaoPendente([iniciada, r('aplicar', 'aplicada_e_conferida')], filtro)).not.toBeNull();
  });

  it('execução incerta de CommercialAccess não bloqueia esta; outro modo ou endpoint também não', () => {
    expect(execucaoPendente([r('aplicar', 'migration_iniciada', { operacao: comercial.OPERACAO })], filtro)).toBeNull();
    expect(execucaoPendente([r('aplicar', 'migration_iniciada', { modo: 'ensaio' })], filtro)).toBeNull();
    expect(execucaoPendente([r('aplicar', 'migration_iniciada', { endpoint: 'ep-outro-1' })], filtro)).toBeNull();
    // A conferir de CommercialAccess não libera uma execução desta.
    const deOutra = r('conferir', undefined, { operacao: comercial.OPERACAO, estado: 'before-platform-portal', sessoesDaMigration: 0 });
    expect(execucaoPendente([r('aplicar', 'migration_iniciada'), deOutra], filtro)).not.toBeNull();
  });
});

describe('conferirContas', () => {
  it('a etapa do portal para sem nenhum MASTER_OWNER ativo, sem alterar papel', () => {
    expect(codigoDe(() => conferirContas(portal, { proprietariosAtivos: 0 }))).toBe('ERR_SEM_PROPRIETARIO_ATIVO');
    expect(codigoDe(() => conferirContas(portal, { proprietariosAtivos: 1 }))).toBeNull();
    expect(codigoDe(() => conferirContas(multisservicos, { proprietariosAtivos: 0 }))).toBeNull();
  });
  it('decide pela contagem completa, nunca pela listagem cortada', () => {
    const dono = { id: 'd1', papel: 'MASTER_OWNER', situacao: 'ACTIVE', vinculosDeDono: 0, criadaEm: '2026-01-01' };
    // Listagem sem nenhum proprietário (cortada) e contagem com um: segue.
    const cortada = { proprietariosAtivos: 1, contas: [] };
    expect(codigoDe(() => conferirContas(portal, cortada))).toBeNull();
    // Proprietário só na listagem e contagem zero: para.
    const soNaListagem = { proprietariosAtivos: 0, contas: [dono] };
    expect(codigoDe(() => conferirContas(portal, soNaListagem))).toBe('ERR_SEM_PROPRIETARIO_ATIVO');
  });
});

describe('desfecho', () => {
  it('sucesso, parada sem gravação, aplicada sem conferência e incerto têm códigos de saída distintos', () => {
    expect(CODIGOS_DE_DESFECHO).toEqual({
      preparado_sem_gravacao: 0,
      aplicada_e_conferida: 0,
      estado_identificado: 0,
      abortado_sem_gravacao: 1,
      parado_sem_gravacao: 1,
      conferencia_sem_estado_valido: 1,
      aplicada_conferencia_falhou: 2,
      resultado_incerto: 3,
    });
  });

  it.each([
    ['ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA', null, 'parado_sem_gravacao'],
    ['ERR_ESTADO_ANTES_DIVERGENTE', null, 'parado_sem_gravacao'],
    ['ERR_MIGRATION_NAO_INICIADA', null, 'parado_sem_gravacao'],
    ['ERR_MIGRATION_FALHOU', null, 'parado_sem_gravacao'],
    ['ERR_RESULTADO_INCERTO', 'iniciada', 'resultado_incerto'],
    ['ERR_RESULTADO_INCERTO', null, 'resultado_incerto'],
    // Erro inesperado depois do início (disco cheio ao registrar, por exemplo).
    ['ERR_INESPERADO', 'iniciada', 'resultado_incerto'],
    ['ENOSPC', 'aplicada', 'aplicada_conferencia_falhou'],
  ] as const)('%s com a execução em %s: %s', (codigo, execucao, esperado) => {
    expect(desfechoDoErro(codigo, execucao)).toBe(esperado);
  });
});
