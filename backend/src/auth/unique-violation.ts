// Detecta violação de UNIQUE CONSTRAINT do Postgres (código `23505`) numa
// constraint específica, a partir do `QueryFailedError` do TypeORM — usado
// para tratar corrida de e-mail/slug (dois requests passam pelo `findOne` de
// verificação antes de o outro commitar) sem depender de mensagem de erro
// formatada, que pode mudar entre versões do driver.
import { QueryFailedError } from 'typeorm';

const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { code?: string; constraint?: string };
  return (
    driverError?.code === POSTGRES_UNIQUE_VIOLATION_CODE &&
    driverError?.constraint === constraintName
  );
}
