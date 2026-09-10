import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  REGISTER_RATE_LIMIT_MAX,
  REGISTER_RATE_LIMIT_WINDOW_MS,
  createRegisterRateLimiter,
} from './register-rate-limit.js';

function buildApp(onHandlerCalled: () => void) {
  const app = express();
  app.use(express.json());
  app.post('/auth/register', createRegisterRateLimiter(), (_req, res) => {
    onHandlerCalled();
    res.status(201).json({ ok: true });
  });
  return app;
}

describe('createRegisterRateLimiter', () => {
  it('permite até 5 tentativas', async () => {
    let calls = 0;
    const app = buildApp(() => calls++);

    for (let i = 0; i < 5; i++) {
      const response = await request(app).post('/auth/register').send({});
      expect(response.status).toBe(201);
    }

    expect(calls).toBe(5);
  });

  it('a sexta tentativa retorna 429 e não chama o handler', async () => {
    let calls = 0;
    const app = buildApp(() => calls++);

    for (let i = 0; i < 5; i++) {
      await request(app).post('/auth/register').send({});
    }
    const sixth = await request(app).post('/auth/register').send({});

    expect(sixth.status).toBe(429);
    expect(calls).toBe(5);
  });

  it('habilita standardHeaders e desabilita legacyHeaders', async () => {
    const app = buildApp(() => {});
    const response = await request(app).post('/auth/register').send({});

    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('limite é 5 tentativas em 15 minutos', () => {
    expect(REGISTER_RATE_LIMIT_MAX).toBe(5);
    expect(REGISTER_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});
