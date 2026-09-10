import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';
import { generateSessionToken } from './session-token.js';
import { createFakeDataSource, InMemoryStore } from './testing/in-memory-data-source.js';

const NOW = new Date('2026-09-10T12:00:00.000Z');

function buildService(store: InMemoryStore): AuthService {
  return new AuthService(createFakeDataSource(store));
}

describe('AuthService.logout', () => {
  let store: InMemoryStore;
  let service: AuthService;

  beforeEach(() => {
    store = new InMemoryStore();
    service = buildService(store);
  });

  it('sem token: no-op silencioso, nunca lança', async () => {
    await expect(service.logout(undefined)).resolves.toBeUndefined();
  });

  it('token malformado: no-op silencioso, sem consultar sessão nenhuma', async () => {
    await expect(service.logout('token-curto-demais')).resolves.toBeUndefined();
    expect([...store.liveSessions()]).toHaveLength(0);
  });

  it('token bem formado mas desconhecido: no-op silencioso', async () => {
    const { token } = generateSessionToken();
    await expect(service.logout(token)).resolves.toBeUndefined();
  });

  it('sessão válida: define revokedAt', async () => {
    const { token, tokenHash } = generateSessionToken();
    store.seedSession({ tokenHash, expiresAt: new Date(NOW.getTime() + 60_000) });

    await service.logout(token);

    const [session] = [...store.liveSessions()];
    expect(session.revokedAt).toBeInstanceOf(Date);
  });

  it('sessão já revogada: continua no-op, nunca lança e não sobrescreve revokedAt original', async () => {
    const { token, tokenHash } = generateSessionToken();
    const jaRevogadaEm = new Date('2026-09-01T00:00:00.000Z');
    store.seedSession({ tokenHash, revokedAt: jaRevogadaEm });

    await expect(service.logout(token)).resolves.toBeUndefined();

    const [session] = [...store.liveSessions()];
    expect(session.revokedAt).toEqual(jaRevogadaEm);
  });

  it('duas chamadas seguidas continuam idempotentes: a segunda não lança nem altera nada', async () => {
    const { token, tokenHash } = generateSessionToken();
    store.seedSession({ tokenHash, expiresAt: new Date(NOW.getTime() + 60_000) });

    await service.logout(token);
    const [session] = [...store.liveSessions()];
    const revokedAtAposPrimeira = session.revokedAt;

    await expect(service.logout(token)).resolves.toBeUndefined();
    expect(session.revokedAt).toEqual(revokedAtAposPrimeira);
  });

  it('nunca cria AuditLog (pendência documentada: AuditAction não tem LOGIN/LOGOUT, sem migration neste lote)', async () => {
    const { token, tokenHash } = generateSessionToken();
    store.seedSession({ tokenHash, expiresAt: new Date(NOW.getTime() + 60_000) });

    await service.logout(token);

    expect([...store.liveAuditLogs()]).toHaveLength(0);
  });
});
