// Detecta violação de EXCLUSION CONSTRAINT do Postgres (código `23P01`) numa
// constraint ESPECÍFICA, a partir do `QueryFailedError` do TypeORM — mesma
// disciplina de auth/unique-violation.ts.
//
// O nome da constraint é obrigatório de propósito. Traduzir "qualquer erro de
// banco" para 409 esconderia falha real (coluna faltando, deadlock, conexão
// caída) atrás de uma mensagem de "horário ocupado" que o usuário tentaria
// resolver mudando de horário — para sempre, sem sucesso. Só a constraint
// nomeada significa, de fato, sobreposição de horário.
import { QueryFailedError } from 'typeorm';

const POSTGRES_EXCLUSION_VIOLATION_CODE = '23P01';

export function isExclusionViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { code?: string; constraint?: string };
  return (
    driverError?.code === POSTGRES_EXCLUSION_VIOLATION_CODE &&
    driverError?.constraint === constraintName
  );
}
