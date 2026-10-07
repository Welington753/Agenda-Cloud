import { describe, expect, it } from 'vitest';
import {
  MIN_PROXY_SECRET_LENGTH,
  parseClientIpSource,
  parseProxySecret,
  resolveClientIp,
} from './client-ip.js';

const SOCKET_IP = '10.0.0.7';

function req(headers: Record<string, string | string[] | undefined>) {
  return { ip: SOCKET_IP, headers };
}

describe('parseClientIpSource', () => {
  it('aceita só os valores conhecidos', () => {
    expect(parseClientIpSource('socket')).toBe('socket');
    expect(parseClientIpSource('cf-connecting-ip')).toBe('cf-connecting-ip');
  });

  it('valor ausente ou desconhecido nunca liga a leitura de cabeçalho', () => {
    expect(parseClientIpSource(undefined)).toBe('socket');
    expect(parseClientIpSource('x-forwarded-for')).toBe('socket');
    expect(parseClientIpSource('true')).toBe('socket');
    expect(parseClientIpSource('CF-Connecting-IP')).toBe('socket');
  });
});

describe('resolveClientIp em modo socket (padrão)', () => {
  it('ignora X-Forwarded-For enviado pelo cliente', () => {
    expect(resolveClientIp(req({ 'x-forwarded-for': '203.0.113.9' }), 'socket')).toBe(SOCKET_IP);
  });

  it('ignora CF-Connecting-IP enviado pelo cliente', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '203.0.113.9' }), 'socket')).toBe(SOCKET_IP);
  });
});

describe('resolveClientIp em modo cf-connecting-ip', () => {
  it('usa o cabeçalho quando é um IPv4 ou IPv6 válido', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '203.0.113.9' }), 'cf-connecting-ip')).toBe(
      '203.0.113.9',
    );
    expect(resolveClientIp(req({ 'cf-connecting-ip': ' 2001:db8::1 ' }), 'cf-connecting-ip')).toBe(
      '2001:db8::1',
    );
  });

  it('nunca lê X-Forwarded-For, nem como reserva', () => {
    expect(
      resolveClientIp(req({ 'x-forwarded-for': '203.0.113.9, 198.51.100.1' }), 'cf-connecting-ip'),
    ).toBe(SOCKET_IP);
  });

  it('cabeçalho ausente cai no endereço da conexão', () => {
    expect(resolveClientIp(req({}), 'cf-connecting-ip')).toBe(SOCKET_IP);
  });

  it('cabeçalho repetido (lista) ou malformado cai no endereço da conexão', () => {
    for (const valor of ['203.0.113.9, 198.51.100.1', 'nao-e-ip', '', '203.0.113.9:443', '999.1.1.1']) {
      expect(resolveClientIp(req({ 'cf-connecting-ip': valor }), 'cf-connecting-ip')).toBe(SOCKET_IP);
    }
    expect(
      resolveClientIp(req({ 'cf-connecting-ip': ['203.0.113.9', '198.51.100.1'] }), 'cf-connecting-ip'),
    ).toBe(SOCKET_IP);
  });
});

describe('resolveClientIp com o proxy confiável do frontend (API_PROXY_SECRET)', () => {
  const SEGREDO = 's'.repeat(MIN_PROXY_SECRET_LENGTH);

  it('usa X-Agenda-Client-IP quando o segredo confere', () => {
    const viaProxy = req({
      'x-agenda-proxy-secret': SEGREDO,
      'x-agenda-client-ip': '203.0.113.9',
    });
    expect(resolveClientIp(viaProxy, 'socket', SEGREDO)).toBe('203.0.113.9');
    expect(resolveClientIp(viaProxy, 'cf-connecting-ip', SEGREDO)).toBe(
      '203.0.113.9',
    );
  });

  it('segredo errado, ausente, repetido ou de outro tamanho: o cabeçalho de IP é ignorado', () => {
    for (const segredo of [
      undefined,
      '',
      'errado',
      `${SEGREDO}x`,
      SEGREDO.slice(1),
      `${SEGREDO}, ${SEGREDO}`,
    ]) {
      const headers: Record<string, string | undefined> = {
        'x-agenda-client-ip': '203.0.113.9',
      };
      if (segredo !== undefined) headers['x-agenda-proxy-secret'] = segredo;
      expect(resolveClientIp(req(headers), 'socket', SEGREDO)).toBe(SOCKET_IP);
    }
    expect(
      resolveClientIp(
        req({
          'x-agenda-proxy-secret': [SEGREDO, SEGREDO],
          'x-agenda-client-ip': '203.0.113.9',
        }),
        'socket',
        SEGREDO,
      ),
    ).toBe(SOCKET_IP);
  });

  it('sem API_PROXY_SECRET configurado, nenhum segredo enviado liga a leitura', () => {
    const viaProxy = req({
      'x-agenda-proxy-secret': SEGREDO,
      'x-agenda-client-ip': '203.0.113.9',
    });
    expect(resolveClientIp(viaProxy, 'socket')).toBe(SOCKET_IP);
    expect(
      resolveClientIp(viaProxy, 'socket', parseProxySecret(undefined)),
    ).toBe(SOCKET_IP);
  });

  it('segredo confere mas o IP é inválido, em lista ou ausente: cai na fonte configurada', () => {
    for (const valor of [
      undefined,
      '',
      'nao-e-ip',
      '203.0.113.9, 198.51.100.1',
      '203.0.113.9:443',
    ]) {
      const headers: Record<string, string | undefined> = {
        'x-agenda-proxy-secret': SEGREDO,
      };
      if (valor !== undefined) headers['x-agenda-client-ip'] = valor;
      expect(resolveClientIp(req(headers), 'socket', SEGREDO)).toBe(SOCKET_IP);
      expect(
        resolveClientIp(
          req({ ...headers, 'cf-connecting-ip': '198.51.100.7' }),
          'cf-connecting-ip',
          SEGREDO,
        ),
      ).toBe('198.51.100.7');
    }
  });

  it('nunca lê X-Forwarded-For, nem com o segredo certo', () => {
    expect(
      resolveClientIp(
        req({
          'x-agenda-proxy-secret': SEGREDO,
          'x-forwarded-for': '203.0.113.9',
        }),
        'socket',
        SEGREDO,
      ),
    ).toBe(SOCKET_IP);
  });
});

describe('parseProxySecret', () => {
  it('só aceita texto com o tamanho mínimo', () => {
    const valido = 'a'.repeat(MIN_PROXY_SECRET_LENGTH);
    expect(parseProxySecret(valido)).toBe(valido);
    for (const valor of [
      undefined,
      null,
      42,
      '',
      'a'.repeat(MIN_PROXY_SECRET_LENGTH - 1),
    ]) {
      expect(parseProxySecret(valor)).toBeUndefined();
    }
  });
});
