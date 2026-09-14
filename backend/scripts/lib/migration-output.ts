// Parser da saída de `npm run migration:show:compiled` (TypeORM CLI) — o CLI
// marca cada migration com `[X] <id> <nome>` (aplicada) ou `[ ] <nome>`
// (pendente) no início da linha (ver
// node_modules/typeorm/migration/MigrationExecutor.js, showMigrations()).
//
// `countPendingMigrations` sozinho (Lote 6B.7) tinha um problema comprovado
// na execução real #5: uma saída vazia, incompleta ou com nomes não
// reconhecidos também conta "0 pendentes" — indistinguível de "todas as
// migrations deste lote já foram aplicadas". `validateMigrationShowStatus`
// (Lote 6B.10) fecha essa lacuna: exige que a lista TOTAL (aplicadas +
// pendentes) seja exatamente o conjunto de três migrations deste lote, sem
// faltar, sem sobrar, sem duplicar — só então "0 pendentes" pode ser
// interpretado como "concluído" pelo chamador (ver apply-lote6b2-production.ts).
import { EXPECTED_INITIAL_SCHEMA_MIGRATION_NAME } from './baseline-checks.js';

/** As três migrations deste lote (Lote 6B.2), na ordem em que o TypeORM as
 * lista (por timestamp). Vem de código-fonte, nunca de configuração externa
 * ou de dado lido do banco — é o "gabarito" contra o qual a saída real do
 * CLI é validada. */
export const EXPECTED_LOTE_6B2_MIGRATION_NAMES = [
  EXPECTED_INITIAL_SCHEMA_MIGRATION_NAME,
  'AllowUndefinedPlanPrice1788782450000',
  'InitialPlanCatalog1788782460000',
] as const;

const APPLIED_MARKER_PATTERN = /^\s*\[X\]\s+\S+\s+(\S+)\s*$/;
const PENDING_MARKER_PATTERN = /^\s*\[\s\]\s+(\S+)\s*$/;

// Causa raiz real (execução #6): sob `CI=true` + qualquer variável de
// ambiente com "GITHUB" no nome (sempre presentes no runner do GitHub
// Actions), a detecção de cor do `ansis` — dependência do TypeORM usada por
// `PlatformTools.log()` — ativa cor mesmo com stdout sendo um pipe (nunca é
// TTY aqui), ao contrário do padrão usual "sem TTY = sem cor" (comprovado
// reproduzindo localmente com `CI=true GITHUB_ACTIONS=true`, ver
// migration-output.spec.ts). Isso envolve cada linha de `[X]`/`[ ]` em
// `\x1b[4m...\x1b[24m`, fazendo a linha não começar mais literalmente com
// `[`. A correção primária é `NO_COLOR=1` no ambiente do subprocesso (ver
// apply-lote6b2-production.ts, que neutraliza isso na origem); remover
// qualquer sequência de escape ANSI (CSI) aqui é defesa em profundidade
// contra qualquer dependência futura que ignore `NO_COLOR`.
// `\x1b` (ESC) é o caractere real que abre toda sequência de escape
// ANSI/CSI — é literalmente o que esta regex precisa casar, não um acidente.
// oxlint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsiCodes(line: string): string {
  return line.replace(ANSI_ESCAPE_PATTERN, '');
}

export function countPendingMigrations(showOutput: string): number {
  return showOutput.split('\n').filter((line) => PENDING_MARKER_PATTERN.test(stripAnsiCodes(line).trimEnd())).length;
}

export interface MigrationShowStatus {
  appliedNames: string[];
  pendingNames: string[];
}

/** Extrai só as linhas reconhecíveis (`[X] ...`/`[ ] ...`) — qualquer outra
 * linha (cabeçalho do `npm run`, log de outra categoria) é ignorada aqui;
 * `validateMigrationShowStatus` é quem decide se o que sobrou é aceitável. */
export function parseMigrationShowOutput(showOutput: string): MigrationShowStatus {
  const appliedNames: string[] = [];
  const pendingNames: string[] = [];
  for (const rawLine of showOutput.split('\n')) {
    // `\r` residual (CRLF) nunca deve impedir o reconhecimento da linha —
    // `trimEnd()` remove espaço e `\r` finais antes de testar os padrões.
    // `stripAnsiCodes` remove qualquer código de escape (cor/underline)
    // antes do `[X]`/`[ ]` — ver nota na constante `ANSI_ESCAPE_PATTERN`.
    const line = stripAnsiCodes(rawLine).trimEnd();
    const appliedMatch = APPLIED_MARKER_PATTERN.exec(line);
    if (appliedMatch) {
      appliedNames.push(appliedMatch[1]);
      continue;
    }
    const pendingMatch = PENDING_MARKER_PATTERN.exec(line);
    if (pendingMatch) {
      pendingNames.push(pendingMatch[1]);
    }
  }
  return { appliedNames, pendingNames };
}

export type MigrationShowValidationFailure =
  | { category: 'empty_or_unrecognized' }
  | { category: 'duplicate_names'; names: string[] }
  | { category: 'unexpected_names'; names: string[] }
  | { category: 'missing_names'; names: string[] };

/** Fail-closed: só devolve `null` (válido) quando a lista total bate
 * EXATAMENTE com `EXPECTED_LOTE_6B2_MIGRATION_NAMES` — nem uma a menos, nem
 * uma a mais, nem duplicada. Qualquer outra coisa (inclusive lista vazia) é
 * uma falha de validação, nunca "zero pendentes" tratado como sucesso. */
export function validateMigrationShowStatus(status: MigrationShowStatus): MigrationShowValidationFailure | null {
  const allNames = [...status.appliedNames, ...status.pendingNames];

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of allNames) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  if (duplicates.size > 0) {
    return { category: 'duplicate_names', names: [...duplicates] };
  }

  if (allNames.length === 0) {
    return { category: 'empty_or_unrecognized' };
  }

  const expectedSet = new Set<string>(EXPECTED_LOTE_6B2_MIGRATION_NAMES);
  const unexpected = allNames.filter((name) => !expectedSet.has(name));
  if (unexpected.length > 0) {
    return { category: 'unexpected_names', names: unexpected };
  }

  const foundSet = new Set(allNames);
  const missing = EXPECTED_LOTE_6B2_MIGRATION_NAMES.filter((name) => !foundSet.has(name));
  if (missing.length > 0) {
    return { category: 'missing_names', names: missing };
  }

  return null;
}
