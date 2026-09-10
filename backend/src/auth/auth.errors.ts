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

// Erro de domínio do login — sempre a MESMA mensagem/status para e-mail
// inexistente, senha errada, credencial ausente, algoritmo desconhecido,
// usuário inativo ou tenant inativo (ver auth.service.ts, `login`). Nunca
// revela qual etapa falhou — isso é o que evita enumeração de e-mail.
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Não foi possível entrar com essas credenciais.');
    this.name = 'InvalidCredentialsError';
  }
}

// Login/me bem-sucedidos (senha certa, usuário e tenant ativos) mas o
// usuário não tem exatamente UMA Membership — o schema atual não define qual
// tenant escolher nesse caso (ver auditoria do Lote 6B.4/6B.5, seção
// contexto multi-tenant). Nunca inventa uma seleção insegura: propaga como
// erro controlado (o controller mapeia para 500 genérico, nunca 401 — não é
// um problema de credencial, é uma lacuna de modelagem ainda sem solução).
export class AmbiguousSessionContextError extends Error {
  constructor() {
    super('Contexto de sessão ambíguo: mais de um vínculo ativo para este usuário.');
    this.name = 'AmbiguousSessionContextError';
  }
}
