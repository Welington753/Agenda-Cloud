// Erro de domínio do login — sempre a MESMA mensagem/status para e-mail
// inexistente, senha errada, credencial ausente, algoritmo desconhecido ou
// usuário inativo (ver auth.service.ts, `login`). Nunca revela qual etapa
// falhou — isso é o que evita enumeração de e-mail. Tenant inativo NUNCA
// entra aqui (ver Lote 6B.6, correção multi-tenant): não invalida a
// identidade, só fica fora da lista de contexts utilizáveis.
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Não foi possível entrar com essas credenciais.');
    this.name = 'InvalidCredentialsError';
  }
}
