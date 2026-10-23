import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { EmailSender, type EmailConfig } from './email-sender.js';

const MENSAGEM = {
  to: { email: 'pessoa@example.test', name: 'Pessoa' },
  subject: 'Assunto',
  text: 'link secreto #t=abc',
  html: '<p>link secreto</p>',
};
const BASE: Omit<EmailConfig, 'provider'> = {
  apiKey: 'chave',
  fromEmail: 'nao-responda@example.test',
  fromName: 'Agenda Cloud',
};
const resposta = (status: number) => new Response(status === 204 ? null : '{}', { status });

describe('EmailSender', () => {
  it('sem configuração não chama ninguém e diz NOT_CONFIGURED (nunca finge envio)', async () => {
    const fetchImpl = vi.fn();
    expect(await new EmailSender(null, fetchImpl).send(MENSAGEM)).toEqual({ status: 'NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Brevo: POST /v3/smtp/email com api-key; 201 é aceito pelo provedor', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta(201));
    expect(await new EmailSender({ ...BASE, provider: 'brevo' }, fetchImpl).send(MENSAGEM)).toEqual({ status: 'SENT' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('chave');
    expect(JSON.parse(init.body)).toMatchObject({
      sender: { email: 'nao-responda@example.test', name: 'Agenda Cloud' },
      to: [{ email: 'pessoa@example.test', name: 'Pessoa' }],
      textContent: MENSAGEM.text,
    });
  });

  it('Resend: POST /emails com Bearer; endereço de teste substitui a base', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta(200));
    const sender = new EmailSender({ ...BASE, provider: 'resend', baseUrl: 'http://127.0.0.1:9/' }, fetchImpl);
    expect(await sender.send(MENSAGEM)).toEqual({ status: 'SENT' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9/emails');
    expect(init.headers.authorization).toBe('Bearer chave');
    expect(JSON.parse(init.body)).toMatchObject({ from: 'Agenda Cloud <nao-responda@example.test>', to: ['pessoa@example.test'] });
  });

  it('recusa e falta de resposta viram FAILED com código, sem ecoar o conteúdo', async () => {
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config: EmailConfig = { ...BASE, provider: 'brevo' };
    expect(await new EmailSender(config, vi.fn().mockResolvedValue(resposta(401))).send(MENSAGEM)).toEqual({
      status: 'FAILED',
      failure: 'HTTP_4XX',
    });
    expect(await new EmailSender(config, vi.fn().mockResolvedValue(resposta(503))).send(MENSAGEM)).toEqual({
      status: 'FAILED',
      failure: 'HTTP_5XX',
    });
    expect(await new EmailSender(config, vi.fn().mockRejectedValue(new Error('rede'))).send(MENSAGEM)).toEqual({
      status: 'FAILED',
      failure: 'SEM_RESPOSTA',
    });
    expect(aviso).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(aviso.mock.calls)).not.toContain('secreto');
    aviso.mockRestore();
  });
});
