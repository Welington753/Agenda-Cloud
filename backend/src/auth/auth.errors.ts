// Erros de domínio do cadastro — o controller mapeia cada um para a resposta
// HTTP correspondente (ver auth.controller.ts), nunca deixando detalhe de
// banco (nome de constraint, SQL, stack) alcançar a resposta.
export class EmailAlreadyInUseError extends Error {
  constructor() {
    super('E-mail já cadastrado.');
    this.name = 'EmailAlreadyInUseError';
  }
}

export class PlanUnavailableError extends Error {
  constructor() {
    super('Plano indisponível no momento.');
    this.name = 'PlanUnavailableError';
  }
}
