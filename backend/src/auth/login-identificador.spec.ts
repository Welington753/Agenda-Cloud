import { changePasswordSchema, loginSchema } from './login.dto.js';

describe('login por e-mail ou usuário', () => {
  const senha = 'senha-de-teste-1';

  it('o corpo antigo (`email`) continua aceito', () => {
    expect(loginSchema.parse({ email: ' Dona@Exemplo.Test ', password: senha })).toEqual({
      email: 'dona@exemplo.test',
      password: senha,
    });
  });

  it('`login` com @ é e-mail; sem @ é nome de usuário, normalizado', () => {
    expect(loginSchema.parse({ login: 'Dona@Exemplo.Test', password: senha })).toEqual({
      email: 'dona@exemplo.test',
      password: senha,
    });
    expect(loginSchema.parse({ login: '  Bia.Salao ', password: senha })).toEqual({ username: 'bia.salao', password: senha });
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
