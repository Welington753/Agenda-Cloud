// Rate limit de login e cadastro contra cabeçalhos forjados pelo cliente
// (ver config/client-ip.ts). Requisições reais por HTTP (supertest): o
// endereço da conexão é sempre o mesmo, o que muda é só o que o cliente
// escreve nos cabeçalhos.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ClientIpSource } from '../config/client-ip.js';
import { LOGIN_RATE_LIMIT_MAX, createLoginRateLimiter } from './login-rate-limit.js';
import { REGISTER_RATE_LIMIT_MAX, createRegisterRateLimiter } from './register-rate-limit.js';

const LIMITERS = [
  { nome: 'login', rota: '/auth/login', criar: createLoginRateLimiter, max: LOGIN_RATE_LIMIT_MAX },
  { nome: 'cadastro', rota: '/auth/register', criar: createRegisterRateLimiter, max: REGISTER_RATE_LIMIT_MAX },
];

function buildApp(rota: string, limiter: express.RequestHandler) {
  const app = express();
  // `trust proxy` fica no padrão (desligado), como em main.ts.
  app.post(rota, limiter, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

async function esgotar(app: express.Express, rota: string, max: number, headers: (i: number) => Record<string, string>) {
  const status: number[] = [];
  for (let i = 0; i <= max; i++) {
    const resposta = await request(app).post(rota).set(headers(i)).send({});
    status.push(resposta.status);
  }
  return status;
}

describe.each(LIMITERS)('rate limit de $nome', ({ rota, criar, max }) => {
  const app = (fonte?: ClientIpSource) => buildApp(rota, fonte ? criar(fonte) : criar());

  it('padrão (socket): trocar X-Forwarded-For a cada tentativa não escapa do limite', async () => {
    const status = await esgotar(app(), rota, max, (i) => ({ 'X-Forwarded-For': `203.0.113.${i + 1}` }));
    expect(status.at(-1)).toBe(429);
  });

  it('padrão (socket): trocar CF-Connecting-IP a cada tentativa não escapa do limite', async () => {
    const status = await esgotar(app('socket'), rota, max, (i) => ({ 'CF-Connecting-IP': `203.0.113.${i + 1}` }));
    expect(status.at(-1)).toBe(429);
  });

  it('cf-connecting-ip: trocar X-Forwarded-For com o mesmo CF-Connecting-IP não escapa do limite', async () => {
    const status = await esgotar(app('cf-connecting-ip'), rota, max, (i) => ({
      'CF-Connecting-IP': '198.51.100.20',
      'X-Forwarded-For': `203.0.113.${i + 1}`,
    }));
    expect(status.at(-1)).toBe(429);
  });

  it('cf-connecting-ip: valor inválido ou em lista cai no endereço da conexão (um balde só)', async () => {
    const valores = ['nao-e-ip', '203.0.113.1, 203.0.113.2', '', '203.0.113.3:80', '999.0.0.1', 'x'];
    const status = await esgotar(app('cf-connecting-ip'), rota, max, (i) => ({
      'CF-Connecting-IP': valores[i % valores.length],
    }));
    expect(status.at(-1)).toBe(429);
  });

  it('cf-connecting-ip: clientes distintos têm limites distintos', async () => {
    const instancia = app('cf-connecting-ip');
    const primeiro = await esgotar(instancia, rota, max, () => ({ 'CF-Connecting-IP': '198.51.100.20' }));
    expect(primeiro.at(-1)).toBe(429);
    const outro = await request(instancia).post(rota).set({ 'CF-Connecting-IP': '198.51.100.21' }).send({});
    expect(outro.status).toBe(200);
  });
});
