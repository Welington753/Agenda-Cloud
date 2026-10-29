// Respostas das consultas de validade e de recurso (commercial-gate.ts) para
// os dublês de banco dos testes unitários: estabelecimento sem período
// registrado (opera como antes deste controle) e com todos os recursos. O
// comportamento real é provado contra PostgreSQL em
// test/commercial-access-postgres.db-e2e-spec.ts.
import { ACCESS_PERIODS_SQL, FEATURE_ENABLED_SQL } from '../commercial-gate.js';

/** `undefined`: a consulta não é da validade nem de recurso. */
export function commercialQueryFake(sql: string): unknown[] | undefined {
  if (sql.startsWith(ACCESS_PERIODS_SQL)) return [];
  if (sql === FEATURE_ENABLED_SQL) return [{ enabled: true }];
  return undefined;
}
