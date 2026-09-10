// Parser mínimo da saída de `npm run migration:show` (TypeORM CLI) — o CLI
// marca cada migration com `[X]` (aplicada) ou `[ ]` (pendente) no início da
// linha. Usado só para decidir se `migration:run` precisa rodar (ver
// apply-lote6b2-production.ts, idempotência da segunda execução) — nunca
// para decidir se o baseline está correto (isso são as checagens SQL em
// baseline-checks.ts).
const PENDING_MARKER_PATTERN = /^\s*\[\s\]/;

export function countPendingMigrations(showOutput: string): number {
  return showOutput.split('\n').filter((line) => PENDING_MARKER_PATTERN.test(line)).length;
}
