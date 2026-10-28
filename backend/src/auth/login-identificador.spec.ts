import { changePasswordSchema, loginSchema, usernameSchema } from './login.dto.js';

describe('login por e-mail ou login interno', () => {
  const senha = 'senha-de-teste-1';

  it('o corpo antigo (`email`) continua aceito', () => {
    expect(loginSchema.parse({ email: ' Dona@Exemplo.Test ', password: senha })).toEqual({
      identifier: 'dona@exemplo.test',
      password: senha,
    });
  });

  it('o corpo antigo (`email`) também leva um login interno com @, como o web anterior envia', () => {
    expect(loginSchema.parse({ email: ' Maria@Salao ', password: senha })).toEqual({ identifier: 'maria@salao', password: senha });
    expect(loginSchema.safeParse({ email: 'bia.salao', password: senha }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'sem-dominio@', password: senha }).success).toBe(false);
  });

  it('`login` vira um identificador único, normalizado, com ou sem @', () => {
    expect(loginSchema.parse({ login: 'Dona@Exemplo.Test', password: senha })).toEqual({
      identifier: 'dona@exemplo.test',
      password: senha,
    });
    expect(loginSchema.parse({ login: '  Bia.Salao ', password: senha })).toEqual({
      identifier: 'bia.salao',
      password: senha,
    });
    // Login interno com aparência de e-mail, sem domínio real.
    expect(loginSchema.parse({ login: 'Recepcao@Salao', password: senha })).toEqual({
      identifier: 'recepcao@salao',
      password: senha,
    });
  });

  it('recusa identificador fora do formato e campos a mais', () => {
    expect(loginSchema.safeParse({ login: 'bi', password: senha }).success).toBe(false);
    expect(loginSchema.safeParse({ login: 'bia salão', password: senha }).success).toBe(false);
    expect(loginSchema.safeParse({ login: 'sem-arroba@', password: senha }).success).toBe(false);
    expect(loginSchema.safeParse({ login: 'bia', email: 'x@y.z', password: senha }).success).toBe(false);
  });

  it('a senha nova precisa ser outra e ter de 10 a 128 caracteres', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: senha, newPassword: 'outra-senha-1' }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: senha, newPassword: senha }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: senha, newPassword: 'curta' }).success).toBe(false);
  });
});

describe('formato do login interno', () => {
  it('aceita todos os logins que o formato anterior aceitava', () => {
    for (const antigo of ['bia', 'bia.salao', 'joao_2', 'ana-maria', 'x9.', 'a__', '0ab']) {
      expect(usernameSchema.safeParse(antigo).success, antigo).toBe(true);
    }
  });

  it('aceita aparência de e-mail, com uma @ e um domínio', () => {
    for (const novo of ['maria@salao', 'recepcao@barbearia.com', 'joao+caixa@studio-1.com.br', 'a@b']) {
      expect(usernameSchema.safeParse(novo).success, novo).toBe(true);
    }
    expect(usernameSchema.parse(' Maria@Salao ')).toBe('maria@salao');
  });

  it('recusa @ solta, duas @, domínio malformado, acento, espaço e tamanho fora da faixa', () => {
    for (const ruim of [
      'maria@',
      '@salao',
      'a@b@c',
      'maria@.salao',
      'maria@salao.',
      'maria@-salao',
      'maria joão',
      'joão',
      '.bia',
      'ab',
      `${'a'.repeat(81)}`,
    ]) {
      expect(usernameSchema.safeParse(ruim).success, ruim).toBe(false);
    }
  });
});
