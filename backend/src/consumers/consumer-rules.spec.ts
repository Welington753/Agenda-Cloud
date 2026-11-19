// Regras puras do cadastro de clientes (consumer-rules.ts). O comportamento
// com banco (travas, chave de pedido, gatilho) está em
// test/consumers-identity-postgres.db-e2e-spec.ts.
import { describe, expect, it } from 'vitest';
import { QueryFailedError } from 'typeorm';
import {
  clienteUnificado,
  impressaoDoPedido,
  nomeAparado,
  principalDoErroDeUnificado,
  telefoneEmUso,
} from './consumer-rules.js';
import { CONSUMER_MERGED_SQLSTATE } from '../migrations/1794268800000-ConsumerIdentity.js';

const BASE = { name: 'Maria Souza', whatsappNormalized: '+5511987654321', email: 'maria@example.test', outraPessoa: false };

describe('impressaoDoPedido', () => {
  it('é SHA-256 em hex', () => {
    expect(impressaoDoPedido(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignora espaços sobrando no nome e maiúsculas no e-mail (dados normalizados)', () => {
    expect(impressaoDoPedido({ ...BASE, name: '  Maria   Souza ', email: ' MARIA@Example.test ' })).toBe(impressaoDoPedido(BASE));
  });

  it.each([
    ['nome', { name: 'Maria Sousa' }],
    ['telefone', { whatsappNormalized: '+5511987654322' }],
    ['e-mail', { email: 'outra@example.test' }],
    ['sem e-mail', { email: undefined }],
    ['outra pessoa', { outraPessoa: true }],
  ])('muda com %s', (_rotulo, troca) => {
    expect(impressaoDoPedido({ ...BASE, ...troca })).not.toBe(impressaoDoPedido(BASE));
  });

  it('e-mail ausente e nulo são o mesmo pedido', () => {
    expect(impressaoDoPedido({ ...BASE, email: undefined })).toBe(impressaoDoPedido({ ...BASE, email: null }));
  });
});

describe('nomeAparado', () => {
  it('apara e colapsa espaços, sem mudar maiúsculas nem acentos', () => {
    expect(nomeAparado('  João   da  Silva ')).toBe('João da Silva');
  });
});

describe('recusas com code', () => {
  it('TELEFONE_EM_USO e CLIENTE_UNIFICADO levam code, mensagem e (no unificado) o principal', () => {
    expect(telefoneEmUso().getResponse()).toMatchObject({ statusCode: 409, code: 'TELEFONE_EM_USO' });
    expect(clienteUnificado('c_principal').getResponse()).toMatchObject({
      statusCode: 409,
      code: 'CLIENTE_UNIFICADO',
      principalId: 'c_principal',
    });
  });
});

describe('principalDoErroDeUnificado', () => {
  function erroDoBanco(code: string, detail?: string) {
    const driverError = Object.assign(new Error('x'), { code, detail });
    return new QueryFailedError('INSERT', [], driverError);
  }

  it('reconhece o SQLSTATE do gatilho e devolve o principal do DETAIL', () => {
    expect(principalDoErroDeUnificado(erroDoBanco(CONSUMER_MERGED_SQLSTATE, 'c_principal'))).toBe('c_principal');
  });

  it('sem DETAIL devolve null (ainda é o erro do gatilho)', () => {
    expect(principalDoErroDeUnificado(erroDoBanco(CONSUMER_MERGED_SQLSTATE))).toBeNull();
  });

  it('outro erro devolve undefined', () => {
    expect(principalDoErroDeUnificado(erroDoBanco('23505'))).toBeUndefined();
    expect(principalDoErroDeUnificado(new Error('rede'))).toBeUndefined();
  });
});
