import { describe, expect, it } from 'vitest';
import { classificarResposta } from './push-dispatcher.js';
import { endpointAceito, hashDoEndpoint, hostParaLog } from './push-endpoint.js';
import { origemPermitida } from './trusted-origin.guard.js';

describe('destino do push (SSRF)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://api.push.apple.com/3/device/abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
  ])('aceita serviço de push conhecido: %s', (url) => {
    expect(endpointAceito(url)).not.toBeNull();
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/x',
    'https://user:senha@fcm.googleapis.com/x',
    'https://169.254.169.254/latest/meta-data',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'https://localhost/x',
    'https://interno.local/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilpush.apple.com/x',
    'https://push.apple.com/x',
    'https://notify.windows.com/x',
    'file:///etc/passwd',
    'nao-e-url',
    `https://fcm.googleapis.com/${'a'.repeat(2100)}`,
  ])('recusa destino fora da lista: %s', (url) => {
    expect(endpointAceito(url)).toBeNull();
  });

  it('log só vê o host; busca usa o hash', () => {
    const url = 'https://fcm.googleapis.com/fcm/send/segredo-do-aparelho';
    expect(hostParaLog(url)).toBe('fcm.googleapis.com');
    expect(hashDoEndpoint(url)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoEndpoint(url)).not.toContain('segredo');
  });
});

describe('origem confiável (CSRF)', () => {
  const FRONT = 'https://agenda.example.test';
  const json = { 'content-type': 'application/json' };

  it('aceita a própria origem e requisição sem Origin (proxy da mesma origem)', () => {
    expect(origemPermitida({ ...json, origin: FRONT }, FRONT)).toBe('ok');
    expect(origemPermitida({ ...json, 'sec-fetch-site': 'same-origin' }, FRONT)).toBe('ok');
    expect(origemPermitida({ 'content-type': 'application/json; charset=utf-8' }, FRONT)).toBe('ok');
  });

  it('recusa outro site e corpo que não é JSON', () => {
    expect(origemPermitida({ ...json, origin: 'https://evil.example' }, FRONT)).toBe('origem');
    expect(origemPermitida({ ...json, origin: 'null' }, FRONT)).toBe('origem');
    expect(origemPermitida({ ...json, 'sec-fetch-site': 'cross-site' }, FRONT)).toBe('origem');
    expect(origemPermitida({ 'content-type': 'text/plain', origin: FRONT }, FRONT)).toBe('tipo');
    expect(origemPermitida({ origin: FRONT }, FRONT)).toBe('tipo');
  });
});

describe('resposta do serviço de push', () => {
  it('201 é aceitação (não exibição); 404/410 expira; 429/5xx/rede repete; resto é definitivo', () => {
    expect(classificarResposta({ tipo: 'http', status: 201 }).status).toBe('ACCEPTED');
    expect(classificarResposta({ tipo: 'http', status: 410 }).status).toBe('GONE');
    expect(classificarResposta({ tipo: 'http', status: 404 }).status).toBe('GONE');
    expect(classificarResposta({ tipo: 'http', status: 429 }).status).toBe('RETRY');
    expect(classificarResposta({ tipo: 'http', status: 503 }).status).toBe('RETRY');
    expect(classificarResposta({ tipo: 'rede' }).status).toBe('RETRY');
    expect(classificarResposta({ tipo: 'http', status: 403 }).status).toBe('FAILED');
    expect(classificarResposta({ tipo: 'http', status: 413 }).status).toBe('FAILED');
    expect(classificarResposta({ tipo: 'http', status: 301 }).status).toBe('FAILED');
  });
});
