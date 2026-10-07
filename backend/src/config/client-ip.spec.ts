import { describe, expect, it } from 'vitest';
import { parseClientIpSource, resolveClientIp } from './client-ip.js';

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
