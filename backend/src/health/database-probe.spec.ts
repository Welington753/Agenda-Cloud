// Sonda do health check, sem banco: prazo, reaproveitamento do sucesso e
// proteção contra consultas acumuladas.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { DatabaseProbe, PROBE_SUCCESS_TTL_MS, PROBE_TIMEOUT_MS } from './database-probe.js';

function sonda(query: (sql: string) => Promise<unknown>) {
  const consulta = vi.fn(query);
  let agora = 1_000_000;
  const probe = new DatabaseProbe({ query: consulta } as unknown as DataSource, () => agora);
  return { probe, consulta, avancar: (ms: number) => (agora += ms) };
}

describe('DatabaseProbe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('banco responde: disponível, com um SELECT 1 e nada além', async () => {
    const { probe, consulta } = sonda(async () => [{ '?column?': 1 }]);

    await expect(probe.isAvailable()).resolves.toBe(true);
    expect(consulta.mock.calls).toEqual([['SELECT 1']]);
  });

  it('reaproveita o sucesso por 5 s e consulta de novo depois', async () => {
    const { probe, consulta, avancar } = sonda(async () => []);

    await probe.isAvailable();
    avancar(PROBE_SUCCESS_TTL_MS - 1);
    await expect(probe.isAvailable()).resolves.toBe(true);
    expect(consulta).toHaveBeenCalledTimes(1);

    avancar(1);
    await probe.isAvailable();
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it('erro do banco: indisponível, sem guardar a falha', async () => {
    let falhar = true;
    const { probe, consulta } = sonda(async () => {
      if (falhar) throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' });
      return [];
    });

    await expect(probe.isAvailable()).resolves.toBe(false);
    falhar = false;
    await expect(probe.isAvailable()).resolves.toBe(true);
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it('uma falha depois de um sucesso derruba o sucesso guardado', async () => {
    let falhar = false;
    const { probe, avancar } = sonda(async () => {
      if (falhar) throw new Error('x');
      return [];
    });

    await probe.isAvailable();
    avancar(PROBE_SUCCESS_TTL_MS);
    falhar = true;
    await expect(probe.isAvailable()).resolves.toBe(false);
    await expect(probe.isAvailable()).resolves.toBe(false);
  });

  it('chamadas simultâneas dividem a mesma consulta', async () => {
    let liberar!: () => void;
    const { probe, consulta } = sonda(() => new Promise((resolve) => (liberar = () => resolve([]))));

    const chamadas = [probe.isAvailable(), probe.isAvailable(), probe.isAvailable()];
    await vi.advanceTimersByTimeAsync(0);
    liberar();
    await expect(Promise.all(chamadas)).resolves.toEqual([true, true, true]);
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it('banco que não responde: indisponível no prazo, e nenhuma consulta nova enquanto a antiga não volta', async () => {
    let liberar!: () => void;
    let bancoVoltou = false;
    const { probe, consulta } = sonda(() =>
      bancoVoltou ? Promise.resolve([]) : new Promise((resolve) => (liberar = () => resolve([]))),
    );

    const primeira = probe.isAvailable();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    await expect(primeira).resolves.toBe(false);

    // A consulta antiga continua pendurada: responde na hora, sem abrir outra.
    await expect(probe.isAvailable()).resolves.toBe(false);
    await expect(probe.isAvailable()).resolves.toBe(false);
    expect(consulta).toHaveBeenCalledTimes(1);

    // Quando ela volta, a próxima chamada sonda de novo.
    bancoVoltou = true;
    liberar();
    await vi.advanceTimersByTimeAsync(0);
    await expect(probe.isAvailable()).resolves.toBe(true);
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it('o prazo da sonda fica abaixo dos 5 s do health check do Render', () => {
    expect(PROBE_TIMEOUT_MS).toBeLessThan(5_000);
  });
});
