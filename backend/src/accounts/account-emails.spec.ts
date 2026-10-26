import { ACCOUNT_LINK_TTL_MS } from './account-token.js';
import {
  descreverValidade,
  emailDeConvite,
  emailDeRedefinicao,
  limparTexto,
  linkDeConvite,
  linkDeRedefinicao,
  type ConviteParaEmail,
} from './account-emails.js';

const TOKEN = 'a'.repeat(64);
const LINK = `https://agenda.example/convite#t=${TOKEN}`;

const convite = (extra: Partial<ConviteParaEmail> = {}): ConviteParaEmail => ({
  targetName: 'Maria da Silva',
  targetEmail: 'maria@example.test',
  tenantName: 'Estúdio Ana & Bia',
  accountExists: false,
  resent: false,
  validityMs: ACCOUNT_LINK_TTL_MS,
  ...extra,
});

/** Texto visível do HTML, sem tags e com as entidades de volta. */
const visivel = (html: string) =>
  html
    .replace(/<div style="display:none[^>]*>.*?<\/div>/s, '')
    .replace(/<title>.*?<\/title>/s, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');

describe('links dos e-mails de conta', () => {
  it('levam o token só no fragmento, no caminho certo', () => {
    expect(linkDeConvite('https://agenda.example', TOKEN)).toBe(LINK);
    expect(linkDeConvite('https://agenda.example///', TOKEN)).toBe(LINK);
    expect(linkDeRedefinicao('http://localhost:3000', TOKEN)).toBe(`http://localhost:3000/redefinir-senha#t=${TOKEN}`);
    expect(linkDeConvite('https://agenda.example/app/', TOKEN)).toBe(`https://agenda.example/app/convite#t=${TOKEN}`);
  });

  it('recusam token fora do formato', () => {
    expect(() => linkDeConvite('https://agenda.example', 'curto')).toThrow();
    expect(() => linkDeConvite('https://agenda.example', `${TOKEN.slice(1)}"`)).toThrow();
    expect(() => linkDeConvite('https://agenda.example', TOKEN.toUpperCase())).toThrow();
  });

  it('recusam endereço de frontend que não seja origem http(s) simples', () => {
    for (const base of [
      'javascript:alert(1)',
      'ftp://agenda.example',
      'https://pessoa:senha@agenda.example',
      'https://agenda.example/?x=1',
      'https://agenda.example/#x',
      'não é url',
    ]) {
      expect(() => linkDeConvite(base, TOKEN), base).toThrow();
    }
  });
});

describe('descreverValidade', () => {
  it('escreve a validade real do link, arredondando para baixo', () => {
    expect(descreverValidade(ACCOUNT_LINK_TTL_MS)).toBe('24 horas');
    expect(descreverValidade(60 * 60_000)).toBe('1 hora');
    expect(descreverValidade(90 * 60_000)).toBe('1 hora');
    expect(descreverValidade(2 * 60 * 60_000)).toBe('2 horas');
    expect(descreverValidade(3 * 24 * 60 * 60_000)).toBe('3 dias');
    expect(descreverValidade(30 * 60_000)).toBe('30 minutos');
    expect(descreverValidade(1_000)).toBe('1 minuto');
  });
});

describe('limparTexto', () => {
  it('tira quebras de linha, controles e marcas de direção; mantém acentos e emoji', () => {
    expect(limparTexto('  Maria\r\nBcc: x\t ')).toBe('Maria Bcc: x');
    expect(limparTexto('Jo\u202eão')).toBe('Jo ão');
    expect(limparTexto('Estúdio Ação 💈')).toBe('Estúdio Ação 💈');
  });
});

describe('e-mail de convite', () => {
  it('conta nova num estabelecimento: cria a senha pelo botão "Ativar meu acesso"', () => {
    const m = emailDeConvite(convite(), LINK);
    expect(m.subject).toBe('Convite para acessar Estúdio Ana & Bia');
    expect(m.to).toEqual({ email: 'maria@example.test', name: 'Maria da Silva' });
    expect(m.text).toContain('Olá, Maria!');
    expect(m.text).toContain('Você recebeu um convite para acessar Estúdio Ana & Bia pelo Agenda Cloud.');
    expect(m.text).toContain('Para começar, crie sua senha pelo link abaixo.');
    expect(m.text).toContain(`Ativar meu acesso:\n${LINK}`);
    expect(visivel(m.html)).toContain('Para começar, crie sua senha pelo botão abaixo.');
    expect(m.html).toContain(`href="${LINK}"`);
    expect(m.html).toMatch(/>Ativar meu acesso<\/a>/);
    expect(m.text).not.toMatch(/senha que você já usa/);
  });

  it('conta existente: aceita com a senha atual, sem criar outra', () => {
    const m = emailDeConvite(convite({ accountExists: true }), LINK);
    expect(m.subject).toBe('Convite para acessar Estúdio Ana & Bia');
    expect(m.text).toContain('não precisa criar outra senha');
    expect(m.text).toContain('Para aceitar, use o link abaixo e confirme com a senha que você já usa.');
    expect(visivel(m.html)).toContain('Para aceitar, use o botão abaixo');
    expect(m.text).toContain(`Aceitar o convite:\n${LINK}`);
    expect(m.text).not.toMatch(/crie sua senha/);
  });

  it('administração da plataforma: nunca cita estabelecimento', () => {
    const nova = emailDeConvite(convite({ tenantName: null }), LINK);
    expect(nova.subject).toBe('Convite para a administração do Agenda Cloud');
    expect(nova.text).toContain('participar da administração da plataforma Agenda Cloud');
    expect(nova.text).toContain('Ativar meu acesso:');
    expect(nova.text).not.toMatch(/Estúdio|estabelecimento/);
    const existente = emailDeConvite(convite({ tenantName: null, accountExists: true }), LINK);
    expect(existente.text).toContain('Aceitar o convite:');
  });

  it('reenvio: assunto e texto dizem que é um link novo e que os anteriores pararam', () => {
    const m = emailDeConvite(convite({ resent: true }), LINK);
    expect(m.subject).toBe('Novo link: convite para acessar Estúdio Ana & Bia');
    expect(m.text).toContain('Este é um novo link para o mesmo convite. Os links enviados antes não funcionam mais.');
    expect(emailDeConvite(convite({ resent: true, tenantName: null }), LINK).subject).toBe(
      'Novo link: convite para a administração do Agenda Cloud',
    );
    expect(emailDeConvite(convite(), LINK).text).not.toContain('novo link');
  });

  it('validade vem do link emitido, com uso único e o aviso para quem não reconhece', () => {
    const m = emailDeConvite(convite({ validityMs: 2 * 60 * 60_000 }), LINK);
    expect(m.text).toContain('O link vale por 2 horas e pode ser usado uma única vez.');
    expect(m.text).toContain('Não reconhece este convite? Ignore este e-mail.');
    expect(emailDeConvite(convite(), LINK).text).toContain('vale por 24 horas');
  });

  it('escapa nomes no HTML e mantém acentos; o token só aparece no link', () => {
    const m = emailDeConvite(
      convite({ targetName: '<script>alert(1)</script> Zé', tenantName: 'Ana & "Bia" <b>Spa</b> Ação' }),
      LINK,
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>Spa');
    expect(m.html).toContain('Ana &amp; &quot;Bia&quot; &lt;b&gt;Spa&lt;/b&gt; Ação');
    expect(m.html).toContain('Olá, &lt;script&gt;alert(1)&lt;/script&gt;!');
    expect(m.subject).toBe('Convite para acessar Ana & "Bia" <b>Spa</b> Ação');
    expect(m.subject).not.toContain(TOKEN);
    // Botão e endereço de reserva; nada além do link leva o token.
    expect(m.html.split(TOKEN)).toHaveLength(4);
    expect(m.text.split(TOKEN)).toHaveLength(2);
  });

  it('quebra de linha em nome ou estabelecimento não entra no assunto nem no texto', () => {
    const m = emailDeConvite(convite({ targetName: 'Maria\r\nBcc: x@y', tenantName: 'Loja\nNova' }), LINK);
    expect(m.subject).toBe('Convite para acessar Loja Nova');
    expect(m.to.name).toBe('Maria Bcc: x@y');
    expect(m.text.split('\n')[0]).toBe('Olá, Maria!');
  });

  it('sem nome, a saudação fica só "Olá!"', () => {
    expect(emailDeConvite(convite({ targetName: '  ' }), LINK).text.split('\n')[0]).toBe('Olá!');
  });

  it('HTML de e-mail para celular: uma coluna de até 560px, viewport e pt-BR', () => {
    const m = emailDeConvite(convite(), LINK);
    expect(m.html).toMatch(/^<!doctype html>\n<html lang="pt-BR">/);
    expect(m.html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(m.html).toContain('max-width:560px');
    expect(m.html).toContain('Mensagem automática do Agenda Cloud, enviada para maria@example.test.');
  });
});

describe('e-mail de redefinição de senha', () => {
  const LINK_RESET = `https://agenda.example/redefinir-senha#t=${TOKEN}`;
  const m = emailDeRedefinicao({ name: 'João Pereira', email: 'joao@example.test', validityMs: ACCOUNT_LINK_TTL_MS }, LINK_RESET);

  it('diz que a administração enviou o link, nunca que a pessoa pediu', () => {
    expect(m.subject).toBe('Crie uma nova senha no Agenda Cloud');
    expect(m.text).toContain('Olá, João!');
    expect(m.text).toContain('A administração do Agenda Cloud enviou este link para você criar uma nova senha');
    expect(m.text).not.toMatch(/você (pediu|solicitou)|seu pedido|sua solicitação/i);
    expect(m.text).toContain(`Criar nova senha:\n${LINK_RESET}`);
  });

  it('avisa da validade, do uso único, das sessões encerradas e que a senha atual continua', () => {
    expect(m.text).toContain('O link vale por 24 horas e pode ser usado uma única vez.');
    expect(m.text).toContain('as sessões abertas com a senha anterior serão encerradas');
    expect(m.text).toContain('Ignore este e-mail: sua senha atual continua valendo.');
  });
});
