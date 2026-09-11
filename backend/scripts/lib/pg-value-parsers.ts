// Parser fail-closed pra valores numéricos vindos do `pg` (Lote 6B.10) —
// COUNT(*) e BIGINT sempre chegam como string do driver `pg` (nunca como
// number nativo, pra não perder precisão em valores acima de 2^53). Usar
// `Number(x ?? 0)` cru aceita coisa que o baseline nunca deveria aceitar
// como número válido: notação científica, decimal, espaço em volta —
// qualquer uma dessas, se algum dia aparecer (bug de query, driver
// diferente, valor corrompido), precisa VIRAR ERRO, nunca um número que por
// acaso bate com o esperado. Nunca coerção frouxa (`==`, `Number()` sem
// validação de formato antes).
import { GuardedMigrationError } from './sanitize.js';

const CANONICAL_NON_NEGATIVE_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;

/** Aceita só: number inteiro seguro não-negativo, ou string decimal
 * canônica (sem zero à esquerda, sem sinal, sem ponto, sem notação
 * científica, sem espaço). Rejeita tudo mais lançando
 * `GuardedMigrationError` com mensagem estática — nunca ecoa o valor
 * recebido (pode ser controlado por uma query maliciosa ou corrompida). */
export function parseNonNegativeInteger(value: unknown, fieldLabel: string): number {
  const fail = (): never => {
    throw new GuardedMigrationError(
      'ERR_BASELINE_VALUE_MALFORMED',
      `Valor do baseline não é um inteiro não-negativo válido: ${fieldLabel}.`,
    );
  };

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value) || value < 0) {
      fail();
    }
    return value;
  }

  if (typeof value === 'string') {
    if (!CANONICAL_NON_NEGATIVE_INTEGER_PATTERN.test(value)) {
      fail();
    }
    // Já validado pelo regex acima como dígitos puros — Number() aqui só
    // converte, nunca interpreta formato (regex já rejeitou tudo que
    // Number() aceitaria frouxamente: "1e2", " 1", "1.0" etc).
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      fail();
    }
    return parsed;
  }

  return fail();
}
