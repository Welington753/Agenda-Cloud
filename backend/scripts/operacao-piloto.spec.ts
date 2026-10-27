// Partes puras dos procedimentos do piloto, sem banco nem rede. URLs e
// Endpoint IDs são fictícios. O fluxo completo foi ensaiado contra um
// PostgreSQL descartável (docs/runbooks/publicacao-contas-piloto.md).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Parada } from './entrada-oculta.mjs';
import {
  ambienteLibpq,
  compararFotografias,
  conferirDestino,
  conferirPendentes,
  pastaForaDoRepositorio,
} from './operacao-piloto.mjs';

const IDS = { endpointPiloto: 'ep-piloto-111111', endpointProibido: 'ep-proibido-222222' };
const SENHA = 'npg_Ab1-x.Y_z~Q9%21';
const HOST = 'ep-piloto-111111.c-2.us-east-1.aws.neon.tech';
const url = (resto = `${HOST}/neondb?sslmode=verify-full`) => `postgresql://neondb_owner:${SENHA}@${resto}`;

function codigo(fn: () => unknown): string {
  try {
    fn();
  } catch (erro) {
    if (erro instanceof Parada) return erro.message;
    throw erro;
  }
  return 'sem erro';
}

describe('conferirDestino', () => {
  it('aceita a URL direta do piloto e decodifica a senha', () => {
    const d = conferirDestino(`  ${url()}  `, IDS);
    expect(d).toMatchObject({ host: HOST, servidorTls: HOST, port: 5432, user: 'neondb_owner', password: 'npg_Ab1-x.Y_z~Q9!', database: 'neondb' });
    expect(d.channelBinding).toBe(false);
    expect(conferirDestino(url(`${HOST}/neondb?sslmode=require&channel_binding=require`), IDS).channelBinding).toBe(true);
  });

  it.each([
    ['vazia', '', 'ERR_URL_VAZIA'],
    ['duas URLs', `${url()}${url()}`, 'ERR_URL_MAIS_DE_UMA'],
    ['com psql', `psql '${url()}'`, 'ERR_URL_COM_TEXTO_EXTRA'],
    ['endpoint proibido em options', url(`${HOST}/neondb?options=endpoint%3Dep-proibido-222222`), 'ERR_ENDPOINT_PROIBIDO'],
    ['pooler', url('ep-piloto-111111-pooler.c-2.us-east-1.aws.neon.tech/neondb'), 'ERR_POOLER'],
    ['outro endpoint', url('ep-outro-333333.c-2.us-east-1.aws.neon.tech/neondb'), 'ERR_ENDPOINT_DIFERENTE_DO_PILOTO'],
    ['fora do Neon', url('ep-piloto-111111.exemplo.invalid/neondb'), 'ERR_HOST_NAO_NEON'],
    ['agenda_dev', url(`${HOST}/agenda_dev`), 'ERR_BANCO_DIFERENTE_DE_NEONDB'],
    ['sslmode=disable', url(`${HOST}/neondb?sslmode=disable`), 'ERR_TLS_AFROUXADO'],
    ['sslmode=no-verify', url(`${HOST}/neondb?sslmode=no-verify`), 'ERR_TLS_AFROUXADO'],
    ['sslmode=prefer', url(`${HOST}/neondb?sslmode=prefer`), 'ERR_TLS_AFROUXADO'],
    ['uselibpqcompat', url(`${HOST}/neondb?uselibpqcompat=true&sslmode=require`), 'ERR_TLS_AFROUXADO'],
    ['ssl=false', url(`${HOST}/neondb?ssl=false`), 'ERR_TLS_AFROUXADO'],
    ['sem senha', `postgresql://neondb_owner@${HOST}/neondb`, 'ERR_URL_SEM_CREDENCIAL'],
    ['outro scheme', `mysql://u:p@${HOST}/neondb`, 'ERR_URL_COM_TEXTO_EXTRA'],
  ])('recusa %s antes de qualquer rede', (_caso, entrada, esperado) => {
    expect(codigo(() => conferirDestino(entrada, IDS))).toBe(esperado);
  });
});

describe('pastaForaDoRepositorio', () => {
  const raiz = path.resolve('/repo');
  it('recusa a raiz e subpastas do repositório', () => {
    expect(pastaForaDoRepositorio(raiz, raiz)).toBe(false);
    expect(pastaForaDoRepositorio(path.join(raiz, 'backend', 'ops'), raiz)).toBe(false);
  });
  it('aceita pastas fora dele, inclusive com nome parecido', () => {
    expect(pastaForaDoRepositorio(path.resolve('/home/ops'), raiz)).toBe(true);
    expect(pastaForaDoRepositorio(path.resolve('/repo-ops'), raiz)).toBe(true);
  });
});

describe('conferirPendentes', () => {
  const antes = ['A1', 'B2', 'C3'];
  it('aceita exatamente o histórico esperado mais a pendente', () => {
    expect(conferirPendentes({ executadas: antes, carregadas: [...antes, 'D4'], esperadasAntes: antes, pendente: 'D4' })).toBeNull();
  });
  it.each([
    ['já aplicada', [...antes, 'D4'], [...antes, 'D4'], 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO'],
    ['histórico incompleto', ['A1', 'B2'], [...antes, 'D4'], 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO'],
    ['ordem diferente', ['B2', 'A1', 'C3'], [...antes, 'D4'], 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO'],
    ['outra pendente compilada', antes, [...antes, 'D4', 'E5'], 'ERR_MIGRATIONS_COMPILADAS_INESPERADAS'],
    ['pendente ausente do build', antes, antes, 'ERR_MIGRATIONS_COMPILADAS_INESPERADAS'],
  ])('recusa %s', (_caso, executadas, carregadas, esperado) => {
    expect(conferirPendentes({ executadas, carregadas, esperadasAntes: antes, pendente: 'D4' })).toBe(esperado);
  });
});

describe('compararFotografias', () => {
  const base = { contagens: { users: 2, invites: 0, typeorm_migrations: 6 }, somas: { users: 'u', invites: '', typeorm_migrations: 'm' } };

  it('iguais quando contagens e md5 batem', () => {
    expect(compararFotografias(base, structuredClone(base)).iguais).toBe(true);
  });

  it('aponta contagem, conteúdo, tabela ausente e tabela nova', () => {
    const depois = { contagens: { users: 3, invites: 0, extra: 1 }, somas: { users: 'x', invites: 'mudou', extra: 'e' } };
    expect(compararFotografias(base, depois)).toEqual({
      iguais: false,
      contagensDiferentes: ['users'],
      somasDiferentes: ['invites'],
      ausentes: ['typeorm_migrations'],
      sobrando: ['extra'],
    });
  });

  it('ignora o que a migration muda de propósito, e só isso', () => {
    const depois = {
      contagens: { users: 2, invites: 0, typeorm_migrations: 7, password_resets: 0 },
      somas: { users: 'u', invites: 'colunas-novas', typeorm_migrations: 'n', password_resets: '' },
    };
    const opcoes = { ignorarSomas: ['invites'], ignorarTabelas: ['typeorm_migrations'], novasPermitidas: ['password_resets'] };
    expect(compararFotografias(base, depois, opcoes).iguais).toBe(true);
    expect(compararFotografias(base, { ...depois, somas: { ...depois.somas, users: 'outro' } }, opcoes).somasDiferentes).toEqual(['users']);
  });
});

describe('ambienteLibpq', () => {
  it('sempre verify-full; PGHOSTADDR só quando o nome do certificado difere do endereço', () => {
    const neon = conferirDestino(url(`${HOST}/neondb?sslmode=require&channel_binding=require`), IDS);
    const env = ambienteLibpq(neon, 'raizes.pem', 'teste');
    expect(env).toMatchObject({ PGHOST: HOST, PGSSLMODE: 'verify-full', PGSSLROOTCERT: 'raizes.pem', PGCHANNELBINDING: 'require' });
    expect(env).not.toHaveProperty('PGHOSTADDR');
    const local = ambienteLibpq({ ...neon, host: '127.0.0.1', servidorTls: 'localhost', channelBinding: false }, 'ca.pem', 'teste');
    expect(local).toMatchObject({ PGHOST: 'localhost', PGHOSTADDR: '127.0.0.1', PGCHANNELBINDING: 'prefer' });
  });
});

describe('conferirPendentes com várias pendentes (lote numa transação)', () => {
  const antes = ['A1', 'B2', 'C3'];
  const conferir = (executadas: string[], carregadas: string[], pendentes?: string[]) =>
    conferirPendentes({ executadas, carregadas, esperadasAntes: antes, pendentes });

  it('aceita o histórico esperado mais as pendentes, na ordem', () => {
    expect(conferir(antes, [...antes, 'D4', 'E5'], ['D4', 'E5'])).toBeNull();
  });
  it.each([
    ['uma das pendentes já aplicada', [...antes, 'D4'], [...antes, 'D4', 'E5'], 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO'],
    ['pendentes em outra ordem no build', antes, [...antes, 'E5', 'D4'], 'ERR_MIGRATIONS_COMPILADAS_INESPERADAS'],
    ['só uma das pendentes no build', antes, [...antes, 'D4'], 'ERR_MIGRATIONS_COMPILADAS_INESPERADAS'],
    ['migration a mais no build', antes, [...antes, 'D4', 'E5', 'F6'], 'ERR_MIGRATIONS_COMPILADAS_INESPERADAS'],
  ])('recusa %s', (_caso, executadas, carregadas, esperado) => {
    expect(conferir(executadas, carregadas, ['D4', 'E5'])).toBe(esperado);
  });
  it('recusa lista vazia ou sem nenhuma pendente informada', () => {
    expect(conferir(antes, antes, [])).toBe('ERR_PENDENTES_INVALIDAS');
    expect(conferir(antes, [...antes, 'D4'])).toBe('ERR_PENDENTES_INVALIDAS');
  });
});
