// Normalização do retorno de `manager.query` com o driver `pg`, usada por
// todo serviço que escreve SQL explícito.

/**
 * O driver devolve `[linhas, quantidade]` em UPDATE/DELETE e só `linhas` no
 * resto. Normaliza para sempre receber as linhas.
 */
export function linhasDe<T>(resultado: unknown): T[] {
  if (
    Array.isArray(resultado) &&
    resultado.length === 2 &&
    Array.isArray(resultado[0]) &&
    typeof resultado[1] === 'number'
  ) {
    return resultado[0] as T[];
  }
  return (Array.isArray(resultado) ? resultado : []) as T[];
}
