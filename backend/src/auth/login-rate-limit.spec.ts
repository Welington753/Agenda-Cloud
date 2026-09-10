import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRegisterRateLimiter } from './register-rate-limit.js';
import {
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  createLoginRateLimiter,
} from './login-rate-limit.js';

function buildApp(onHandlerCalled: () => void) {
  const app = express();
  app.use(express.json());
  app.post('/auth/login', createLoginRateLimiter(), (_req, res) => {
    onHandlerCalled();
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('createLoginRateLimiter', () => {
  it('permite até 5 tentativas', async () => {
    let calls = 0;
    const app = buildApp(() => calls++);

    for (let i = 0; i < 5; i++) {
      const response = await request(app).post('/auth/login').send({});
      expect(response.status).toBe(200);
    }

    expect(calls).toBe(5);
  });

  it('a sexta tentativa retorna 429 e não chama o handler', async () => {
    let calls = 0;
    const app = buildApp(() => calls++);

    for (let i = 0; i < 5; i++) {
      await request(app).post('/auth/login').send({});
    }
    const sixth = await request(app).post('/auth/login').send({});

    expect(sixth.status).toBe(429);
    expect(calls).toBe(5);
  });

  it('habilita standardHeaders e desabilita legacyHeaders', async () => {
    const app = buildApp(() => {});
    const response = await request(app).post('/auth/login').send({});

    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('limite é 5 tentativas em 15 minutos', () => {
    expect(LOGIN_RATE_LIMIT_MAX).toBe(5);
    expect(LOGIN_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it('é uma instância própria, independente do limiter de cadastro (MemoryStore não compartilhado)', async () => {
    let loginCalls = 0;
    let registerCalls = 0;
    const app = express();
    app.use(express.json());
    app.post('/auth/login', createLoginRateLimiter(), (_req, res) => {
      loginCalls++;
      res.status(200).json({ ok: true });
    });
    app.post('/auth/register', createRegisterRateLimiter(), (_req, res) => {
      registerCalls++;
      res.status(201).json({ ok: true });
    });

    for (let i = 0; i < 5; i++) {
      await request(app).post('/auth/register').send({});
    }
    const sixthRegister = await request(app).post('/auth/register').send({});
    expect(sixthRegister.status).toBe(429);

    // Esgotar o limiter de cadastro nunca afeta o limiter de login.
    const firstLogin = await request(app).post('/auth/login').send({});
    expect(firstLogin.status).toBe(200);
    expect(loginCalls).toBe(1);
    expect(registerCalls).toBe(5);
  });
});
